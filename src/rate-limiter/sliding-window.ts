/**
 * throttled-nodejs 滑动窗口限流算法实现
 *
 * 算法原理：
 * 滑动窗口通过结合"当前窗口计数"和"上一窗口的加权比例"来近似一个真正的滑动窗口。
 * 它不像固定窗口那样有清晰的边界，而是每个时刻都计算"过去一个周期内"的请求总量。
 *
 * 核心公式：
 *   total = previousCount × (1 - currentProgress) + currentCount
 * 其中 currentProgress = (当前时间 % 窗口周期毫秒数) / 窗口周期毫秒数
 *
 * 优点：平滑地解决了固定窗口的边界突刺问题。
 * 缺点：
 * - 结果是一个近似值（因为假设上一窗口的请求均匀分布）
 * - 需要维护两个 Key
 * - Redis 端必须用 Lua 脚本保证原子性
 *
 * 对应 Python 原版: throttled/rate_limiter/sliding_window.py
 */

import { ATOMIC_ACTION_TYPE_LIMIT, RateLimiterType, StoreType } from '../constants';
import { MemoryStoreBackend } from '../store/memory';
import { RedisStoreBackend } from '../store/redis';
import {
  AtomicActionP,
  AtomicActionTypeT,
  KeyT,
  RateLimiterTypeT,
  StoreBackendP,
  StoreValueT,
} from '../types';
import { nowMs, nowSec } from '../utils';
import {
  BaseRateLimiter,
  RateLimitResult,
  RateLimitState,
  registerRateLimiter,
  Quota,
  StoreP,
} from './base';

// ============================================================
// Redis 原子操作 —— 滑动窗口限流
// ============================================================

/**
 * RedisLimitAtomicAction 的核心逻辑混入
 */
class RedisLimitAtomicActionCoreMixin {
  static TYPE: AtomicActionTypeT = ATOMIC_ACTION_TYPE_LIMIT;
  static STORE_TYPE: string = StoreType.REDIS;

  protected _backend: RedisStoreBackend;

  constructor(backend: StoreBackendP) {
    this._backend = backend as RedisStoreBackend;
  }
}

/**
 * Redis 滑动窗口限流的原子操作 Lua 脚本
 *
 * 使用两个 Key：
 * - KEYS[1]：当前窗口计数器
 * - KEYS[2]：上一个窗口计数器
 *
 * 通过计算当前窗口的进度比例，对上一窗口的计数进行加权折算，
 * 从而近似计算出过去一个完整周期内的请求总量。
 */
const SLIDING_WINDOW_LUA = `
  -- 解析参数
  local period = tonumber(ARGV[1])        -- 窗口周期（秒）
  local limit = tonumber(ARGV[2])         -- 配额上限
  local cost = tonumber(ARGV[3])          -- 本次消耗
  local now_ms = tonumber(ARGV[4])        -- 当前时间（毫秒）

  -- 读取当前窗口计数
  local exists = true
  local current = redis.call("GET", KEYS[1])
  if current == false then
    current = 0
    exists = false
  end

  -- 读取上一窗口计数
  local previous = redis.call("GET", KEYS[2])
  if previous == false then
    previous = 0
  end

  -- 计算窗口进度比例
  local period_ms = period * 1000
  local current_proportion = (now_ms % period_ms) / period_ms
  local previous_proportion = 1 - current_proportion
  previous = math.floor(previous_proportion * previous)

  -- 计算总使用量 = 折算后的上一窗口 + 当前窗口 + 本次请求
  local retry_after = 0
  local used = previous + current + cost
  local limited = used > limit and cost ~= 0

  if limited then
    -- 被限流：计算 retry_after
    -- 如果 cost <= previous，说明上一窗口剩余配额足够，按比例缩短等待时间
    if cost <= previous then
      retry_after = previous_proportion * period * cost / previous
    else
      retry_after = previous_proportion * period
    end
  else
    -- 允许：递增当前窗口计数
    if exists then
      redis.call("INCRBY", KEYS[1], cost)
    else
      redis.call("SET", KEYS[1], cost, "EX", 3 * period)
    end
  end

  return {limited, used, tostring(retry_after)}
`;

/**
 * Redis 滑动窗口限流的原子操作
 *
 * 使用 Lua 脚本保证两个 Key 的读取和写入原子性。
 */
class RedisLimitAtomicAction extends RedisLimitAtomicActionCoreMixin {
  do(keys: KeyT[], args?: StoreValueT[]): number[] {
    const client = this._backend.getClient() as import('ioredis').Redis;
    const result = client.eval(SLIDING_WINDOW_LUA, keys.length, ...keys, ...(args?.map(String) ?? []));
    // ioredis 的 eval 返回数组
    return result as unknown as number[];
  }
}

// ============================================================
// Memory 原子操作 —— 滑动窗口限流
// ============================================================

/**
 * MemoryLimitAtomicAction 的核心逻辑混入
 */
class MemoryLimitAtomicActionCoreMixin {
  static TYPE: AtomicActionTypeT = ATOMIC_ACTION_TYPE_LIMIT;
  static STORE_TYPE: string = StoreType.MEMORY;

  protected _backend: MemoryStoreBackend;

  constructor(backend: StoreBackendP) {
    this._backend = backend as MemoryStoreBackend;
  }
}

/**
 * Memory 滑动窗口限流的核心逻辑
 *
 * @param backend - 内存存储后端
 * @param keys - [currentKey, previousKey]
 * @param args - [period, limit, cost, nowMs]
 * @returns [是否限流, 总使用量, retryAfter]
 */
function memoryDo(
  backend: MemoryStoreBackend,
  keys: KeyT[],
  args?: StoreValueT[],
): number[] {
  const [currentKey, previousKey] = keys;
  const [period, limit, cost] = args as number[];
  const timestampMs = args![3]; // 毫秒时间戳

  // 读取当前窗口计数
  let current: number | null = backend.get(currentKey) as number | null;
  if (current === null) {
    current = 0;
    // 首次创建时设置过期时间（3 倍窗口大小，确保窗口结束后数据仍可用于下一窗口的折算）
    backend.set(currentKey, cost, 3 * period);
  }

  // 计算窗口进度比例
  const periodMs = period * 1000;
  const currentProportion = (timestampMs % periodMs) / periodMs;
  const previousProportion = 1 - currentProportion;

  // 上一窗口按比例折算
  const previous = Math.floor(
    previousProportion * ((backend.get(previousKey) as number) || 0),
  );

  // 计算总使用量和限流判断
  let retryAfter = 0;
  const used = previous + current + cost;
  const limited = used > limit && cost !== 0 ? 1 : 0;

  if (limited) {
    // 被限流：估算需要等待的时间
    if (cost <= previous) {
      retryAfter = previousProportion * period * cost / previous;
    } else {
      retryAfter = previousProportion * period;
    }
  } else {
    // 允许请求：递增当前窗口计数
    (backend.getClient() as Map<string, number>).set(currentKey, current + cost);
  }

  return [limited, used, retryAfter];
}

/**
 * Memory 滑动窗口限流的原子操作
 */
class MemoryLimitAtomicAction extends MemoryLimitAtomicActionCoreMixin {
  do(keys: KeyT[], args?: StoreValueT[]): number[] {
    return memoryDo(this._backend, keys, args);
  }
}

// ============================================================
// SlidingWindowRateLimiter —— 滑动窗口限流器
// ============================================================

/**
 * 滑动窗口限流器
 *
 * 通过折算上一窗口的计数来近似滑动窗口的效果，
 * 解决了固定窗口的边界突刺问题。
 */
class SlidingWindowRateLimiter extends BaseRateLimiter {
  static Meta = { type: RateLimiterType.SLIDING_WINDOW };

  static _defaultAtomicActionClasses(): Array<new (backend: StoreBackendP) => AtomicActionP> {
    return [RedisLimitAtomicAction, MemoryLimitAtomicAction];
  }

  static _supportedAtomicActionTypes(): AtomicActionTypeT[] {
    return [ATOMIC_ACTION_TYPE_LIMIT];
  }

  /**
   * 准备滑动窗口的 Key
   *
   * 生成两个 Key：
   * - currentKey：当前窗口计数器（throttled:v1:sliding_window:{key}:period:{currentIdx}）
   * - previousKey：上一窗口计数器（throttled:v1:sliding_window:{key}:period:{currentIdx - 1}）
   *
   * @param key - 原始键
   * @returns [currentKey, previousKey, period, limit]
   */
  _prepare(key: string): [string, string, number, number] {
    const period = this.quota.getPeriodSec();
    const currentIdx = Math.floor(nowSec() / period);
    const currentKey = this._prepareKey(`${key}:period:${currentIdx}`);
    const previousKey = this._prepareKey(`${key}:period:${currentIdx - 1}`);
    return [currentKey, previousKey, period, this.quota.getLimit()];
  }
  constructor(quota: Quota, store: StoreP) {
    super(quota, store);
    this._registerAtomicActions(store);
  }

  _limit(key: string, cost: number = 1): RateLimitResult {
    const [currentKey, previousKey, period, limit] = this._prepare(key);

    const opResult = this._atomicActions.get(ATOMIC_ACTION_TYPE_LIMIT)!.do(
      [currentKey, previousKey],
      [period, limit, cost, nowMs()],
    );
    const [limited, used, retryAfter] = opResult as unknown as number[];

    return new RateLimitResult(
      limited === 1,
      [limit, Math.max(0, limit - used), period, retryAfter as number],
    );
  }

  _peek(key: string): RateLimitState {
    const [currentKey, previousKey, period, limit] = this._prepare(key);
    const periodMs = period * 1000;
    const currentProportion = (nowMs() % periodMs) / periodMs;

    // 上一窗口折算
    const previous = Math.floor(
      (1 - currentProportion) * ((this._store.get(previousKey) as number) || 0),
    );

    // 当前窗口 + 折算后的上一窗口 = 近似当前滑动窗口总量
    const used = previous + ((this._store.get(currentKey) as number) || 0);

    return new RateLimitState(limit, Math.max(0, limit - used), period);
  }
}

// 注册到限流器注册表
registerRateLimiter(SlidingWindowRateLimiter);

export { SlidingWindowRateLimiter };

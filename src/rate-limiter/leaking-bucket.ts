/**
 * throttled-nodejs 漏桶限流算法实现
 *
 * 算法原理：
 * 漏桶算法将请求比作水，请求到达时注入桶中，桶以恒定速率漏水。
 * - 如果桶未满（当前积压 + 新增 <= 容量）→ 允许请求，水加入桶中
 * - 如果桶已满（当前积压 + 新增 > 容量）→ 拒绝请求（溢出）
 *
 * 与令牌桶的区别：
 * ┌──────────────┬──────────────────────┬────────────────────────┐
 * │ 维度         │ 令牌桶                │ 漏桶                    │
 * ├──────────────┼──────────────────────┼────────────────────────┤
 * │ 核心思想     │ 累加可用令牌           │ 累加积压请求             │
 * │ 初值         │ tokens = capacity     │ tokens = 0             │
 * │ 时间演化     │ + timeElapsed × rate   │ - timeElapsed × rate   │
 * │ 判断条件     │ cost > tokens         │ tokens + cost > capacity│
 * │ 操作         │ 消耗令牌（减少）        │ 加入桶中（增加）         │
 * │ 返回剩余     │ 剩余令牌数              │ 剩余可用容量            │
 * └──────────────┴──────────────────────┴────────────────────────┘
 *
 * 适用场景：需要严格恒定的输出速率，不希望有任何流量突发。
 *
 * 对应 Python 原版: throttled/rate_limiter/leaking_bucket.py
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
  StoreDictValueT,
  StoreValueT,
} from '../types';
import { nowSec } from '../utils';
import {
  BaseRateLimiter,
  RateLimitResult,
  RateLimitState,
  registerRateLimiter,
  Quota,
  StoreP,
} from './base';

// ============================================================
// Redis 原子操作 —— 漏桶限流
// ============================================================

class RedisLimitAtomicActionCoreMixin {
  static TYPE: AtomicActionTypeT = ATOMIC_ACTION_TYPE_LIMIT;
  static STORE_TYPE: string = StoreType.REDIS;

  protected _backend: RedisStoreBackend;

  constructor(backend: StoreBackendP) {
    this._backend = backend as RedisStoreBackend;
  }
}

/**
 * Redis 漏桶限流的 Lua 脚本
 *
 * 漏桶逻辑与令牌桶对称：
 * - 令牌桶：tokens = min(capacity, last_tokens + timeElapsed × rate)，消耗令牌
 * - 漏桶：  tokens = max(0, last_tokens - timeElapsed × rate)，增加积压
 */
const LEAKING_BUCKET_LUA = `
  local rate = tonumber(ARGV[1])          -- 漏水速率（请求/秒）
  local capacity = tonumber(ARGV[2])      -- 桶容量
  local cost = tonumber(ARGV[3])          -- 本次请求量
  local now = tonumber(redis.call("TIME")[1])

  -- 读取桶状态（初始积压为 0）
  local last_tokens = 0
  local last_refreshed = now
  local bucket = redis.call("HMGET", KEYS[1], "tokens", "last_refreshed")

  if bucket[1] ~= false then
    last_tokens = tonumber(bucket[1])
    last_refreshed = tonumber(bucket[2])
  end

  -- 按时间差漏水：积压的请求随时间减少
  local time_elapsed = math.max(0, now - last_refreshed)
  local tokens = math.max(0, last_tokens - (math.floor(time_elapsed * rate)))

  -- 判断桶是否会溢出
  local limited = tokens + cost > capacity
  if limited then
    return {limited, capacity - tokens}
  end

  -- 允许请求：水注入桶中
  local fill_time = capacity / rate
  redis.call("EXPIRE", KEYS[1], math.floor(2 * fill_time))
  redis.call("HSET", KEYS[1], "tokens", tokens + cost, "last_refreshed", now)
  return {limited, capacity - (tokens + cost)}
`;

class RedisLimitAtomicAction extends RedisLimitAtomicActionCoreMixin {
  do(keys: KeyT[], args?: StoreValueT[]): number[] {
    const client = this._backend.getClient() as import('ioredis').Redis;
    return client.eval(LEAKING_BUCKET_LUA, keys.length, ...keys, ...(args?.map(String) ?? [])) as unknown as number[];
  }
}

// ============================================================
// Memory 原子操作 —— 漏桶限流
// ============================================================

class MemoryLimitAtomicActionCoreMixin {
  static TYPE: AtomicActionTypeT = ATOMIC_ACTION_TYPE_LIMIT;
  static STORE_TYPE: string = StoreType.MEMORY;

  protected _backend: MemoryStoreBackend;

  constructor(backend: StoreBackendP) {
    this._backend = backend as MemoryStoreBackend;
  }
}

/**
 * Memory 漏桶限流的核心逻辑
 *
 * @param backend - 内存存储后端
 * @param keys - [key]
 * @param args - [rate, capacity, cost]
 * @returns [是否限流, 剩余容量]
 */
function memoryDo(
  backend: MemoryStoreBackend,
  keys: KeyT[],
  args?: StoreValueT[],
): number[] {
  const key = keys[0];
  const [rate, capacity, cost] = args as number[];
  const now = nowSec();

  // 读取桶状态
  const bucket: StoreDictValueT = backend.hgetall(key);
  const lastTokens = (bucket['tokens'] as number) ?? 0;
  const lastRefreshed = (bucket['last_refreshed'] as number) ?? now;

  // 按时间差漏水
  const timeElapsed = Math.max(0, now - lastRefreshed);
  const tokens = Math.max(0, lastTokens - Math.floor(timeElapsed * rate));

  // 判断是否溢出
  const limited = tokens + cost > capacity ? 1 : 0;
  if (limited) {
    return [limited, capacity - tokens];
  }

  // 允许：注入请求
  const fillTime = capacity / rate;
  backend.expire(key, Math.ceil(2 * fillTime));
  backend.hset(key, null, null, { tokens: tokens + cost, last_refreshed: now });

  return [limited, capacity - (tokens + cost)];
}

class MemoryLimitAtomicAction extends MemoryLimitAtomicActionCoreMixin {
  do(keys: KeyT[], args?: StoreValueT[]): number[] {
    return memoryDo(this._backend, keys, args);
  }
}

// ============================================================
// LeakingBucketRateLimiter —— 漏桶限流器
// ============================================================

/**
 * 漏桶限流器
 *
 * 严格恒定输出速率的限流算法，请求速率不会超过配置的 rate。
 * 适合需要严格控制出口流量的场景。
 */
class LeakingBucketRateLimiter extends BaseRateLimiter {
  static Meta = { type: RateLimiterType.LEAKING_BUCKET };

  static _defaultAtomicActionClasses(): Array<new (backend: StoreBackendP) => AtomicActionP> {
    return [RedisLimitAtomicAction, MemoryLimitAtomicAction];
  }

  static _supportedAtomicActionTypes(): AtomicActionTypeT[] {
    return [ATOMIC_ACTION_TYPE_LIMIT];
  }

  _prepare(key: string): [string, number, number] {
    return [this._prepareKey(key), this.quota.fillRate, this.quota.burst];
  }

  /**
   * 计算桶中积压减少到目标量所需的时间
   *
   * @param upper - 目标积压上限
   * @param remaining - 当前剩余容量（capacity - tokens）
   * @returns 需要多少秒
   */
  _refillSec(upper: number, remaining: number): number {
    if (remaining >= upper) return 0;
    const tokens = this.quota.burst - remaining; // 当前桶中积压
    return Math.ceil((upper - remaining) / this.quota.fillRate);
  }

  _toResult(limited: number, cost: number, tokens: number, capacity: number): RateLimitResult {
    const resetAfter = this._refillSec(capacity, tokens);
    const retryAfter = limited ? this._refillSec(cost, tokens) : 0;
    return new RateLimitResult(
      limited === 1,
      [capacity, tokens, resetAfter, retryAfter],
    );
  }
  constructor(quota: Quota, store: StoreP) {
    super(quota, store);
    this._registerAtomicActions(store);
  }

  _limit(key: string, cost: number = 1): RateLimitResult {
    const [formattedKey, rate, capacity] = this._prepare(key);
    const opResult = this._atomicActions.get(ATOMIC_ACTION_TYPE_LIMIT)!.do(
      [formattedKey],
      [rate, capacity, cost],
    ) as unknown as number[];
    const [limited, tokens] = opResult;
    return this._toResult(limited as number, cost, tokens as number, capacity);
  }

  _peek(key: string): RateLimitState {
    const now = nowSec();
    const [formattedKey, rate, capacity] = this._prepare(key);

    const bucket: StoreDictValueT = this._store.hgetall(formattedKey) as StoreDictValueT;
    const lastTokens = (bucket['tokens'] as number) ?? 0;
    const lastRefreshed = (bucket['last_refreshed'] as number) ?? now;

    // 按时间差漏水
    const tokens = Math.max(0, lastTokens - Math.floor(Math.max(0, now - lastRefreshed) * rate));

    return new RateLimitState(
      capacity,
      capacity - tokens,          // remaining = 剩余可用容量
      Math.ceil(tokens / rate),   // resetAfter = 积压全部漏完需要的时间
    );
  }
}

registerRateLimiter(LeakingBucketRateLimiter);

export { LeakingBucketRateLimiter };

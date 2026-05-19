/**
 * throttled-nodejs 令牌桶限流算法实现
 *
 * 算法原理：
 * 令牌桶以恒定速率向桶中填充令牌，桶有最大容量限制。
 * 每个请求到达时消耗一定数量的令牌：
 * - 桶中令牌足够 → 允许请求并消耗令牌
 * - 桶中令牌不足 → 拒绝请求
 *
 * 核心特性：
 * - 支持突发流量（burst）：短时间内可消耗桶中积累的所有令牌
 * - 令牌补充是"惰性计算"的：不在后台定时填充，
 *   而是在每次请求时根据时间差计算应补充的令牌数
 * - 突发之后速率会回归到平均水平
 *
 * 适用场景：允许一定程度的流量突发，关注平均速率。
 *
 * 存储结构（Redis Hash）：
 * - tokens: 当前桶中令牌数
 * - last_refreshed: 上次刷新时间戳
 *
 * 对应 Python 原版: throttled/rate_limiter/token_bucket.py
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
// Redis 原子操作 —— 令牌桶限流
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
 * Redis 令牌桶限流的 Lua 脚本
 *
 * 使用 Redis Hash 存储桶状态，Lua 脚本保证原子性。
 *
 * 逻辑步骤：
 * 1. 读取 Hash 中的 tokens 和 last_refreshed
 * 2. 计算时间差，按 rate 补充令牌（不超过 capacity）
 * 3. 判断令牌是否足够（cost > tokens → 拒绝）
 * 4. 允许则消耗令牌并更新 Hash
 */
const TOKEN_BUCKET_LUA = `
  local rate = tonumber(ARGV[1])          -- 填充速率（令牌/秒）
  local capacity = tonumber(ARGV[2])      -- 桶容量（最大令牌数）
  local cost = tonumber(ARGV[3])          -- 本次消耗令牌数
  local now = tonumber(redis.call("TIME")[1])  -- Redis 服务器当前时间

  -- 读取桶状态（初始化时桶为空）
  local last_tokens = capacity
  local last_refreshed = now
  local bucket = redis.call("HMGET", KEYS[1], "tokens", "last_refreshed")

  if bucket[1] ~= false then
    last_tokens = tonumber(bucket[1])
    last_refreshed = tonumber(bucket[2])
  end

  -- 惰性补充：根据时间差计算应补充的令牌数
  local time_elapsed = math.max(0, now - last_refreshed)
  local tokens = math.min(capacity, last_tokens + (math.floor(time_elapsed * rate)))

  -- 判断是否允许请求
  local limited = cost > tokens
  if limited then
    return {limited, tokens}
  end

  -- 允许请求：消耗令牌，更新桶状态
  tokens = tokens - cost
  local fill_time = capacity / rate
  redis.call("HSET", KEYS[1], "tokens", tokens, "last_refreshed", now)
  redis.call("EXPIRE", KEYS[1], math.floor(2 * fill_time))

  return {limited, tokens}
`;

/**
 * Redis 令牌桶限流的原子操作
 */
class RedisLimitAtomicAction extends RedisLimitAtomicActionCoreMixin {
  do(keys: KeyT[], args?: StoreValueT[]): number[] {
    const client = this._backend.getClient() as import('ioredis').Redis;
    return client.eval(TOKEN_BUCKET_LUA, keys.length, ...keys, ...(args?.map(String) ?? [])) as unknown as number[];
  }
}

// ============================================================
// Memory 原子操作 —— 令牌桶限流
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
 * Memory 令牌桶限流的核心逻辑
 *
 * @param backend - 内存存储后端
 * @param keys - [key]
 * @param args - [rate, capacity, cost]
 * @returns [是否限流, 当前令牌数]
 */
function memoryDo(
  backend: MemoryStoreBackend,
  keys: KeyT[],
  args?: StoreValueT[],
): number[] {
  const key = keys[0];
  const now = nowSec();
  const [rate, capacity, cost] = args as number[];

  // 读取桶状态
  const bucket: StoreDictValueT = backend.hgetall(key);
  const lastTokens = (bucket['tokens'] as number) ?? capacity;
  const lastRefreshed = (bucket['last_refreshed'] as number) ?? now;

  // 惰性补充令牌
  const timeElapsed = Math.max(0, now - lastRefreshed);
  const tokens = Math.min(capacity, lastTokens + Math.floor(timeElapsed * rate));

  // 判断是否允许
  const limited = tokens >= cost ? 0 : 1;
  if (limited) {
    return [limited, tokens];
  }

  // 消耗令牌并更新桶状态
  const newTokens = tokens - cost;
  backend.hset(key, null, null, { tokens: newTokens, last_refreshed: now });

  // 设置过期时间（2 倍的桶填满时间）
  const fillTime = capacity / rate;
  backend.expire(key, Math.ceil(2 * fillTime));

  return [limited, newTokens];
}

/**
 * Memory 令牌桶限流的原子操作
 */
class MemoryLimitAtomicAction extends MemoryLimitAtomicActionCoreMixin {
  do(keys: KeyT[], args?: StoreValueT[]): number[] {
    return memoryDo(this._backend, keys, args);
  }
}

// ============================================================
// TokenBucketRateLimiter —— 令牌桶限流器
// ============================================================

/**
 * 令牌桶限流器
 *
 * 最常用的限流算法之一，通过令牌的积累和消耗实现平滑限流。
 *
 * 使用示例：
 * ```
 * // 每秒 100 个令牌，桶容量 200（允许突发 200）
 * const limiter = new TokenBucketRateLimiter(perSec(100, 200), new MemoryStore());
 * const result = limiter.limit("api:key");
 * ```
 */
class TokenBucketRateLimiter extends BaseRateLimiter {
  static Meta = { type: RateLimiterType.TOKEN_BUCKET };

  static _defaultAtomicActionClasses(): Array<new (backend: StoreBackendP) => AtomicActionP> {
    return [RedisLimitAtomicAction, MemoryLimitAtomicAction];
  }

  static _supportedAtomicActionTypes(): AtomicActionTypeT[] {
    return [ATOMIC_ACTION_TYPE_LIMIT];
  }

  /**
   * 准备限流参数
   *
   * @param key - 原始键
   * @returns [格式化键, fillRate, burst容量]
   */
  _prepare(key: string): [string, number, number] {
    return [this._prepareKey(key), this.quota.fillRate, this.quota.burst];
  }

  /**
   * 计算填充到指定量所需的时间（秒）
   *
   * @param upper - 目标令牌数
   * @param remaining - 当前令牌数
   * @returns 需要多少秒才能填充到 upper
   */
  _refillSec(upper: number, remaining: number): number {
    if (remaining >= upper) return 0;
    return Math.ceil((upper - remaining) / this.quota.fillRate);
  }

  /**
   * 将原子操作结果转换为 RateLimitResult
   *
   * @param limited - 是否限流
   * @param cost - 本次消耗
   * @param tokens - 当前令牌数
   * @param capacity - 桶容量
   * @returns 格式化的限流结果
   */
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
    );
    const [limited, tokens] = opResult as unknown as number[];
    return this._toResult(limited as number, cost, tokens as number, capacity);
  }

  _peek(key: string): RateLimitState {
    const now = nowSec();
    const [formattedKey, rate, capacity] = this._prepare(key);

    // 读取桶状态并计算当前令牌数（不修改状态）
    const bucket: StoreDictValueT = this._store.hgetall(formattedKey) as StoreDictValueT;
    const lastTokens = (bucket['tokens'] as number) ?? capacity;
    const lastRefreshed = (bucket['last_refreshed'] as number) ?? now;

    const timeElapsed = Math.max(0, now - lastRefreshed);
    const tokens = Math.min(capacity, lastTokens + Math.floor(timeElapsed * rate));
    const resetAfter = Math.ceil((capacity - tokens) / rate);

    return new RateLimitState(capacity, tokens, resetAfter);
  }
}

// 注册到限流器注册表
registerRateLimiter(TokenBucketRateLimiter);

export { TokenBucketRateLimiter };

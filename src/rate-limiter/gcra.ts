/**
 * throttled-nodejs GCRA (Generic Cell Rate Algorithm) 限流算法实现
 *
 * 算法原理：
 * GCRA 基于"理论到达时间"（Theoretical Arrival Time, TAT）的数学模型，
 * 最初用于 ATM（异步传输模式）网络的信元速率控制，
 * 由 Brandur Leach 推广到 HTTP 限流场景。
 *
 * 核心公式：
 *   TAT = max(now, lastTAT) + cost × emissionInterval
 *   allowAt = TAT - capacity × emissionInterval
 *   timeElapsed = now - allowAt
 *   remaining = floor(timeElapsed / emissionInterval)
 *
 * 物理意义：
 * - TAT：理论上"下一个请求应有的到达时间"
 * - allowAt：当前积累的"信用"允许的最早到达时间
 * - 如果 now < allowAt → 信用不足 → 拒绝请求
 * - 如果 now >= allowAt → 信用充足 → 允许请求
 *
 * 与令牌桶的关系：
 * GCRA 在数学上等价于令牌桶，但通过 TAT 实现了更精确的
 * 时间控制，且只需要存储一个值（TAT）。
 *
 * 参考：
 * - Rate Limiting, Cells, and GCRA (https://brandur.org/rate-limiting)
 *
 * 对应 Python 原版: throttled/rate_limiter/gcra.py
 */

import { ATOMIC_ACTION_TYPE_LIMIT, ATOMIC_ACTION_TYPE_PEEK, RateLimiterType, StoreType } from '../constants';
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
import { nowMonoF } from '../utils';
import {
  BaseRateLimiter,
  RateLimitResult,
  RateLimitState,
  registerRateLimiter,
  Quota,
  StoreP,
} from './base';

// ============================================================
// Redis 原子操作 —— GCRA 限流 (limit)
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
 * GCRA 限流的 Lua 脚本（limit 操作）
 *
 * 使用 Redis TIME 命令获取精确时间，减去固定偏移量（2025-01-01）
 * 避免 Lua 数字类型精度溢出。
 */
const GCRA_LIMIT_LUA = `
  local emission_interval = tonumber(ARGV[1])     -- 发射间隔
  local capacity = tonumber(ARGV[2])              -- 突发容量
  local cost = tonumber(ARGV[3])                  -- 本次消耗

  -- 获取精确时间，减去固定偏移避免浮点精度问题
  local jan_1_2025 = 1735660800
  local now = redis.call("TIME")
  now = (now[1] - jan_1_2025) + (now[2] / 1000000)

  -- 读取上次 TAT
  local last_tat = redis.call("GET", KEYS[1])
  if not last_tat then
    last_tat = now
  else
    last_tat = tonumber(last_tat)
  end

  -- 计算新 TAT 和允许时间
  local fill_time_for_cost = cost * emission_interval
  local fill_time_for_capacity = capacity * emission_interval
  local tat = math.max(now, last_tat) + fill_time_for_cost
  local allow_at = tat - fill_time_for_capacity
  local time_elapsed = now - allow_at

  local limited = 0
  local retry_after = 0
  local reset_after = tat - now
  local remaining = math.floor(time_elapsed / emission_interval)

  if remaining < 0 then
    -- 拒绝：当前时间早于 allow_at，信用不足
    limited = 1
    retry_after = time_elapsed * -1
    reset_after = math.max(0, last_tat - now)
    remaining = math.min(capacity, cost + remaining)
  else
    -- 允许：更新 TAT
    if reset_after > 0 then
      redis.call("SET", KEYS[1], tat, "EX", math.ceil(reset_after))
    end
  end

  return {limited, remaining, tostring(reset_after), tostring(retry_after)}
`;

class RedisLimitAtomicAction extends RedisLimitAtomicActionCoreMixin {
  do(keys: KeyT[], args?: StoreValueT[]): number[] {
    const client = this._backend.getClient() as import('ioredis').Redis;
    return client.eval(GCRA_LIMIT_LUA, keys.length, ...keys, ...(args?.map(String) ?? [])) as unknown as number[];
  }
}

// ============================================================
// Redis 原子操作 —— GCRA 限流 (peek)
// ============================================================

/**
 * GCRA 的 peek 操作需要独立的 Lua 脚本
 *
 * peek 与 limit 不同：只读取不写入，且需要完整的 TAT 计算。
 * 这是 GCRA 算法独有的 —— 其他算法的 peek 可以直接读存储。
 */
const GCRA_PEEK_LUA = `
  local emission_interval = tonumber(ARGV[1])
  local capacity = tonumber(ARGV[2])

  local jan_1_2025 = 1735660800
  local now = redis.call("TIME")
  now = (now[1] - jan_1_2025) + (now[2] / 1000000)

  local tat = redis.call("GET", KEYS[1])
  if not tat then
    tat = now
  else
    tat = tonumber(tat)
  end

  local fill_time_for_capacity = capacity * emission_interval
  local allow_at = math.max(tat, now) - fill_time_for_capacity
  local time_elapsed = now - allow_at

  local limited = 0
  local retry_after = 0
  local reset_after = math.max(0, tat - now)
  local remaining = math.floor(time_elapsed / emission_interval)

  if remaining < 1 then
    limited = 1
    remaining = 0
    retry_after = math.abs(time_elapsed)
  end

  return {limited, remaining, tostring(reset_after), tostring(retry_after)}
`;

class RedisPeekAtomicActionCoreMixin {
  static TYPE: AtomicActionTypeT = ATOMIC_ACTION_TYPE_PEEK;
  static STORE_TYPE: string = StoreType.REDIS;

  protected _backend: RedisStoreBackend;

  constructor(backend: StoreBackendP) {
    this._backend = backend as RedisStoreBackend;
  }
}

class RedisPeekAtomicAction extends RedisPeekAtomicActionCoreMixin {
  do(keys: KeyT[], args?: StoreValueT[]): number[] {
    const client = this._backend.getClient() as import('ioredis').Redis;
    return client.eval(GCRA_PEEK_LUA, keys.length, ...keys, ...(args?.map(String) ?? [])) as unknown as number[];
  }
}

// ============================================================
// Memory 原子操作 —— GCRA 限流 (limit)
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
 * Memory GCRA limit 的核心逻辑
 *
 * Memory 版本使用 process.hrtime() 作为单调时钟源，
 * 比 Redis 的 TIME 命令更快且不受系统时间调整影响。
 */
function memoryLimitDo(
  backend: MemoryStoreBackend,
  keys: KeyT[],
  args?: StoreValueT[],
): number[] {
  const key = keys[0];
  const [emissionInterval, capacity, cost] = args as number[];
  const now = nowMonoF();  // 使用单调时钟（对应 Python 的 time.monotonic()）

  // 读取上次 TAT
  const lastTat = (backend.get(key) as number) || now;

  // GCRA 核心公式
  const fillTimeForCost = cost * emissionInterval;
  const fillTimeForCapacity = capacity * emissionInterval;
  const tat = Math.max(now, lastTat) + fillTimeForCost;
  const allowAt = tat - fillTimeForCapacity;
  const timeElapsed = now - allowAt;

  let limited: number;
  let retryAfter: number;
  let resetAfter: number;
  let remaining: number;

  const remDiv = (x: number) => Math.floor(x / emissionInterval + 1e-7);
  if (remDiv(timeElapsed) < 0) {
    limited = 1;
    retryAfter = -timeElapsed;
    resetAfter = Math.max(0, lastTat - now);
    remaining = Math.min(capacity, cost + remDiv(timeElapsed));
  } else {
    limited = 0;
    retryAfter = 0;
    resetAfter = tat - now;
    if (resetAfter > 0) {
      backend.set(key, tat, Math.ceil(resetAfter));
    }
    remaining = remDiv(timeElapsed);
  }

  return [limited, remaining, resetAfter, retryAfter];
}

class MemoryLimitAtomicAction extends MemoryLimitAtomicActionCoreMixin {
  do(keys: KeyT[], args?: StoreValueT[]): number[] {
    return memoryLimitDo(this._backend, keys, args);
  }
}

// ============================================================
// Memory 原子操作 —— GCRA 限流 (peek)
// ============================================================

class MemoryPeekAtomicActionCoreMixin {
  static TYPE: AtomicActionTypeT = ATOMIC_ACTION_TYPE_PEEK;
  static STORE_TYPE: string = StoreType.MEMORY;

  protected _backend: MemoryStoreBackend;

  constructor(backend: StoreBackendP) {
    this._backend = backend as MemoryStoreBackend;
  }
}

function memoryPeekDo(
  backend: MemoryStoreBackend,
  keys: KeyT[],
  args?: StoreValueT[],
): number[] {
  const key = keys[0];
  const [emissionInterval, capacity] = args as number[];
  const now = nowMonoF();

  const tat = (backend.get(key) as number) || now;

  const fillTimeForCapacity = capacity * emissionInterval;
  const allowAt = Math.max(now, tat) - fillTimeForCapacity;
  const timeElapsed = now - allowAt;

  const resetAfter = Math.max(0, tat - now);
  const remaining = Math.floor(timeElapsed / emissionInterval + 1e-7);

  if (remaining < 1) {
    return [1, 0, resetAfter, Math.abs(timeElapsed)];
  }

  return [0, remaining, resetAfter, 0];
}

class MemoryPeekAtomicAction extends MemoryPeekAtomicActionCoreMixin {
  do(keys: KeyT[], args?: StoreValueT[]): number[] {
    return memoryPeekDo(this._backend, keys, args);
  }
}

// ============================================================
// GCRARateLimiter —— GCRA 限流器
// ============================================================

/**
 * GCRA (Generic Cell Rate Algorithm) 限流器
 *
 * 基于 TAT（理论到达时间）的高精度限流算法。
 * 在数学上等价于令牌桶，但只需要一个存储值（TAT）。
 * 提供毫秒级精度的速率控制。
 *
 * 使用示例：
 * ```
 * const limiter = new GCRARateLimiter(
 *   perSec(100, 100),  // 每秒 100 个请求，突发 100
 *   new MemoryStore(),
 * );
 * const result = limiter.limit("api:key");
 * ```
 */
class GCRARateLimiter extends BaseRateLimiter {
  static Meta = { type: RateLimiterType.GCRA };

  static _defaultAtomicActionClasses(): Array<new (backend: StoreBackendP) => AtomicActionP> {
    return [
      RedisLimitAtomicAction, RedisPeekAtomicAction,
      MemoryLimitAtomicAction, MemoryPeekAtomicAction,
    ];
  }

  static _supportedAtomicActionTypes(): AtomicActionTypeT[] {
    return [ATOMIC_ACTION_TYPE_LIMIT, ATOMIC_ACTION_TYPE_PEEK];
  }

  _prepare(key: string): [string, number, number] {
    return [this._prepareKey(key), this.quota.emissionInterval, this.quota.burst];
  }
  constructor(quota: Quota, store: StoreP) {
    super(quota, store);
    this._registerAtomicActions(store);
  }

  _limit(key: string, cost: number = 1): RateLimitResult {
    const [formattedKey, emissionInterval, capacity] = this._prepare(key);
    const result = this._atomicActions.get(ATOMIC_ACTION_TYPE_LIMIT)!.do(
      [formattedKey],
      [emissionInterval, capacity, cost],
    ) as unknown as number[];
    const [limited, remaining, resetAfter, retryAfter] = result;
    return new RateLimitResult(
      limited === 1,
      [capacity, remaining as number, resetAfter as number, retryAfter as number],
    );
  }

  _peek(key: string): RateLimitState {
    const [formattedKey, emissionInterval, capacity] = this._prepare(key);
    const peekResult = this._atomicActions.get(ATOMIC_ACTION_TYPE_PEEK)!.do(
      [formattedKey],
      [emissionInterval, capacity],
    ) as unknown as number[];
    const [limited, remaining, resetAfter, retryAfter] = peekResult;
    return new RateLimitState(
      capacity,
      remaining as number,
      resetAfter as number,
      retryAfter as number,
    );
  }
}

registerRateLimiter(GCRARateLimiter);

export { GCRARateLimiter };

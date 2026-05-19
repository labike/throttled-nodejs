/**
 * throttled-nodejs 固定窗口限流算法实现
 *
 * 算法原理：
 * 将时间划分为固定长度的窗口，在每个窗口内维护一个计数器。
 * 每次请求到达时，计数器递增并与上限比较：
 * - 计数器 <= 上限 → 允许请求
 * - 计数器 > 上限 → 拒绝请求
 * 窗口切换时，计数器自动归零（通过 key 的窗口编号变化实现）。
 *
 * 优点：实现简单，性能高。
 * 缺点：存在"边界突刺"问题——窗口切换瞬间可能涌入 2 倍流量。
 *       例如限制 60 req/min，在 00:59 和 01:01 各发 60 请求，
 *       实际 2 秒内处理了 120 请求。
 *
 * Redis 实现不使用 Lua 脚本：
 * 测试显示单命令（INCRBY + EXPIRE）比 Lua 性能更高，
 * 因为固定窗口逻辑简单，Lua 脚本的传输开销占主导。
 * - 单命令：15040 req/s
 * - Lua 脚本：12319 req/s
 *
 * 对应 Python 原版: throttled/rate_limiter/fixed_window.py
 */

import { ATOMIC_ACTION_TYPE_LIMIT, RateLimiterType, StoreType } from '../constants';
import { BaseAtomicAction } from '../store/base';
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
// Redis 原子操作 —— 固定窗口限流
// ============================================================

/**
 * RedisLimitAtomicAction 的核心逻辑混入
 *
 * 虽然定义了 Lua 脚本，但实际使用单命令 INCRBY + EXPIRE 实现，
 * 因为固定窗口的简单逻辑不需要 Lua 的原子性保证。
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
 * Redis 固定窗口限流的原子操作实现
 *
 * 使用 Redis 的 INCRBY 命令进行原子递增，
 * 如果是首次请求（current === cost）同时设置过期时间。
 * 不使用 Lua 脚本以获取更好的单命令性能。
 */
class RedisLimitAtomicAction extends RedisLimitAtomicActionCoreMixin {
  do(keys: KeyT[], args?: StoreValueT[]): number[] {
    const client = this._backend.getClient() as import('ioredis').Redis;
    const [period, limit, cost] = args as number[];

    const current = client.incrby(keys[0], cost) as unknown as number;
    if ((current as number) === cost) {
      client.expire(keys[0], period);
    }

    return [(current as number) > limit && cost !== 0 ? 1 : 0, current as number];
  }
}

// ============================================================
// Memory 原子操作 —— 固定窗口限流
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
 * Memory 固定窗口限流的原子操作实现
 *
 * 使用 MemoryStoreBackend 的 get/set 方法操作计数器。
 *
 * @param backend - 内存存储后端
 * @param keys - [key]
 * @param args - [period, limit, cost]
 * @returns [是否限流, 当前计数]
 */
function memoryDo(
  backend: MemoryStoreBackend,
  keys: KeyT[],
  args?: StoreValueT[],
): number[] {
  const key = keys[0];
  const [period, limit, cost] = args as number[];

  // 读取当前计数
  let current: number | null = backend.get(key) as number | null;

  if (current === null) {
    // 首次请求：设置初始值并设定过期时间
    current = cost;
    backend.set(key, current, period);
  } else {
    // 后续请求：累加
    current += cost;
    backend.getClient().set(key, current);
  }

  // 判断是否超限
  return [current > limit && cost !== 0 ? 1 : 0, current];
}

/**
 * Memory 固定窗口限流的原子操作
 */
class MemoryLimitAtomicAction extends MemoryLimitAtomicActionCoreMixin {
  do(keys: KeyT[], args?: StoreValueT[]): number[] {
    return memoryDo(this._backend, keys, args);
  }
}

// ============================================================
// FixedWindowRateLimiter —— 固定窗口限流器
// ============================================================

/**
 * 固定窗口限流器
 *
 * 最简单的限流算法实现。将时间划分为固定窗口，窗口内计数。
 *
 * 使用示例：
 * ```
 * const limiter = new FixedWindowRateLimiter(perSec(5), new MemoryStore());
 * const result = limiter.limit("user:123");
 * // result.limited = false (允许)
 * // result.state.remaining = 4 (剩余 4 次)
 * ```
 */
class FixedWindowRateLimiter extends BaseRateLimiter {
  static Meta = { type: RateLimiterType.FIXED_WINDOW };

  static _defaultAtomicActionClasses(): Array<new (backend: StoreBackendP) => AtomicActionP> {
    return [RedisLimitAtomicAction, MemoryLimitAtomicAction];
  }

  static _supportedAtomicActionTypes(): AtomicActionTypeT[] {
    return [ATOMIC_ACTION_TYPE_LIMIT];
  }

  constructor(quota: Quota, store: StoreP) {
    super(quota, store);
    // 构造函数中注册原子操作（因为 JS 构造函数无法自动调用子类静态方法）
    this._registerAtomicActions(store);
  }

  /**
   * 准备限流操作的 Key 和参数
   *
   * Key 格式：throttled:v1:fixed_window:{original_key}:period:{window_index}
   * 其中 window_index = now // period，每秒更新一次窗口编号。
   *
   * @param key - 原始键
   * @returns [格式化后的窗口键, 窗口大小（秒）, 配额上限, 当前时间戳]
   */
  _prepare(key: string): [string, number, number, number] {
    const now = nowSec();
    const period = this.quota.getPeriodSec();
    // 窗口编号计算：当前时间戳 // 窗口秒数
    // 例如 period=60 时，时间戳 1700000000 // 60 = 28333333
    const periodKey = `${key}:period:${Math.floor(now / period)}`;
    return [this._prepareKey(periodKey), period, this.quota.getLimit(), now];
  }

  _limit(key: string, cost: number = 1): RateLimitResult {
    const [periodKey, period, limit, now] = this._prepare(key);

    // 执行原子操作：递增计数器并检查是否超限
    const opResult = this._atomicActions.get(ATOMIC_ACTION_TYPE_LIMIT)!.do(
      [periodKey],
      [period, limit, cost],
    );
    const result = opResult as unknown as number[];
    const limited = result[0];
    const current = result[1];

    // 计算复位时间：当前窗口剩余秒数
    // 时间轴：|-- now % period --|-- reset_after --|----- next period -----|
    //         |------------------- period --------------------|
    const resetAfter = period - (now % period);

    return new RateLimitResult(
      limited === 1,
      [limit, Math.max(0, limit - current), resetAfter, limited === 1 ? resetAfter : 0],
    );
  }

  _peek(key: string): RateLimitState {
    const [periodKey, period, limit, now] = this._prepare(key);
    const current = (this._store.get(periodKey) as number) || 0;
    return new RateLimitState(limit, Math.max(0, limit - current), period - (now % period));
  }
}

// 注册到限流器注册表
registerRateLimiter(FixedWindowRateLimiter);

export { FixedWindowRateLimiter };

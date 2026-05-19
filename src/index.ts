/**
 * throttled-nodejs 主入口模块
 *
 * 导出库的所有公开 API，包括：
 * - Throttled 门面类（同步版）
 * - AsyncThrottled 门面类（异步版）
 * - 五种限流算法实现
 * - 两种存储后端（MemoryStore / RedisStore）
 * - 数据模型（Quota / Rate / RateLimitState / RateLimitResult）
 * - 枚举常量（RateLimiterType / StoreType）
 * - Hook 系统（Hook / HookContext）
 * - 异常类
 * - 工具函数
 *
 * 与 Python 原版 throttled/__init__.py 对应的导出。
 */

// ============================================================
// 核心门面类
// ============================================================
export { Throttled } from './throttled';
export { AsyncThrottled, AsyncHook } from './async/throttled';

// ============================================================
// 限流器数据模型与基类
// ============================================================
export {
  Rate,
  Quota,
  RateLimitState,
  RateLimitResult,
  RateLimiterRegistry,
  BaseRateLimiterMixin,
  BaseRateLimiter,
  perSec,
  perMin,
  perHour,
  perDay,
  perWeek,
  perDuration,
  registerRateLimiter,
} from './rate-limiter/base';

// ============================================================
// 各限流算法实现
// ============================================================
export { FixedWindowRateLimiter } from './rate-limiter/fixed-window';
export { SlidingWindowRateLimiter } from './rate-limiter/sliding-window';
export { TokenBucketRateLimiter } from './rate-limiter/token-bucket';
export { LeakingBucketRateLimiter } from './rate-limiter/leaking-bucket';
export { GCRARateLimiter } from './rate-limiter/gcra';

// ============================================================
// 存储后端
// ============================================================
export {
  BaseStore,
  BaseStoreBackend,
  BaseAtomicAction,
  BaseAtomicActionMixin,
  BaseStoreMixin,
} from './store/base';
export { MemoryStore, MemoryStoreBackend } from './store/memory';
export { RedisStore, RedisStoreBackend } from './store/redis';

// ============================================================
// Hook 系统
// ============================================================
export { Hook, HookContext, buildHookChain } from './hooks';

// ============================================================
// 枚举常量
// ============================================================
export {
  RateLimiterType,
  StoreType,
  ATOMIC_ACTION_TYPE_LIMIT,
  ATOMIC_ACTION_TYPE_PEEK,
  STORE_TTL_STATE_NOT_TTL,
  STORE_TTL_STATE_NOT_EXIST,
} from './constants';

// ============================================================
// 异常类
// ============================================================
export {
  BaseThrottledError,
  SetUpError,
  DataError,
  StoreUnavailableError,
  LimitedError,
} from './exceptions';

// ============================================================
// 工具函数与类型
// ============================================================
export { nowSec, nowMonoF, nowMs, formatValue, formatKey, formatKv, Timer, Benchmark } from './utils';

// ============================================================
// OpenTelemetry Hook（可选）
// ============================================================
export { OTelHook } from './contrib/otel';
export { AsyncOTelHook } from './async/contrib/otel';
export type {
  KeyT,
  StoreValueT,
  StoreDictValueT,
  StoreBucketValueT,
  AtomicActionTypeT,
  RateLimiterTypeT,
  TimeLikeValueT,
  SyncLockP,
  AsyncLockP,
  LockP,
  StoreBackendP,
  SyncAtomicActionP,
  AsyncAtomicActionP,
  AtomicActionP,
  SyncStoreP,
  AsyncStoreP,
  StoreP,
} from './types';

/** 库版本号 */
export const VERSION = '3.2.0';

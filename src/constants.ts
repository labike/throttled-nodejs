/**
 * throttled-nodejs 常量定义模块
 *
 * 定义库中使用的所有枚举常量，包括：
 * - 存储后端类型（Redis / Memory）
 * - TTL 状态常量
 * - 原子操作类型
 * - 限流算法类型枚举
 *
 * 对应 Python 原版: throttled/constants.py
 */

import { AtomicActionTypeT, RateLimiterTypeT } from './types';

// ============================================================
// 存储后端类型枚举
// ============================================================

/** 存储后端类型的字符串常量 */
export const StoreType = {
  REDIS: 'redis',
  MEMORY: 'memory',
} as const;

// ============================================================
// TTL 状态常量
// ============================================================

/** TTL 状态：未设置 TTL（永不过期） */
export const STORE_TTL_STATE_NOT_TTL: number = -1;

/** TTL 状态：键不存在 */
export const STORE_TTL_STATE_NOT_EXIST: number = -2;

// ============================================================
// 原子操作类型常量
// ============================================================

/** 限流操作类型标识 */
export const ATOMIC_ACTION_TYPE_LIMIT: AtomicActionTypeT = 'limit';

/** 查询操作类型标识 */
export const ATOMIC_ACTION_TYPE_PEEK: AtomicActionTypeT = 'peek';

// ============================================================
// 限流算法类型枚举
// ============================================================

/** 限流算法类型的字符串常量 */
export const RateLimiterType = {
  /** 固定窗口计数器算法 */
  FIXED_WINDOW: 'fixed_window' as RateLimiterTypeT,
  /** 滑动窗口日志算法 */
  SLIDING_WINDOW: 'sliding_window' as RateLimiterTypeT,
  /** 漏桶算法 */
  LEAKING_BUCKET: 'leaking_bucket' as RateLimiterTypeT,
  /** 令牌桶算法 */
  TOKEN_BUCKET: 'token_bucket' as RateLimiterTypeT,
  /** 通用信元速率算法（Generic Cell Rate Algorithm） */
  GCRA: 'gcra' as RateLimiterTypeT,
} as const;

/** 所有算法类型的列表 */
export const RATE_LIMITER_TYPES: RateLimiterTypeT[] = Object.values(RateLimiterType);

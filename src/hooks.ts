/**
 * throttled-nodejs Hook 中间件系统
 *
 * 采用"中间件模式"（Middleware Pattern）为限流操作提供切面能力。
 * 与 Express/Koa 的中间件类似，Hook 可以：
 * - 在限流操作前执行逻辑（如记录开始时间）
 * - 在限流操作后执行逻辑（如记录耗时、上报指标）
 * - 异常处理
 *
 * Hook 链的执行顺序：
 *   hooks = [A, B]  →  A.on_limit → B.on_limit → do_limit
 *   执行顺序: A_before → B_before → do_limit → B_after → A_after
 *
 * 对应 Python 原版: throttled/hooks.py
 */

import { RateLimitResult } from './rate-limiter/base';

// ============================================================
// HookContext —— 钩子上下文
// ============================================================

/**
 * 传递给 Hook 的上下文信息
 *
 * 在限流检查前创建，包含当前请求的限流上下文信息。
 * 注意：不包含限流结果，结果通过调用 callNext() 获得。
 */
export class HookContext {
  constructor(
    /** 被限流的标识符（如用户 ID、IP 地址） */
    public readonly key: string,
    /** 本次请求的消耗量 */
    public readonly cost: number,
    /** 使用的限流算法（如 "token_bucket"） */
    public readonly algorithm: string,
    /** 存储后端类型（如 "memory"、"redis"） */
    public readonly storeType: string,
  ) {}
}

// ============================================================
// Hook —— 钩子抽象基类
// ============================================================

/**
 * Hook 抽象基类
 *
 * 自定义 Hook 需继承此类并实现 onLimit() 方法。
 *
 * 示例 —— 日志记录 Hook：
 * ```
 * class LoggingHook extends Hook {
 *   onLimit(callNext, context) {
 *     console.log(`[${context.key}] 开始限流检查`);
 *     const result = callNext();
 *     console.log(`[${context.key}] limit=${result.limited}`);
 *     return result;
 *   }
 * }
 * ```
 */
export abstract class Hook {
  /**
   * 中间件处理函数
   *
   * @param callNext - 调用链中下一个 Hook 或实际限流器
   * @param context - 限流上下文信息
   * @returns 限流结果（必须返回 callNext() 的结果或等效值）
   */
  abstract onLimit(
    callNext: () => RateLimitResult,
    context: HookContext,
  ): RateLimitResult;
}

// ============================================================
// buildHookChain —— 构建 Hook 执行链
// ============================================================

/**
 * 构建 Hook 链
 *
 * 将多个 Hook 按中间件模式串联起来。
 * 最终的执行链类似洋葱模型：
 *   ┌─ Hook[0] ─┐
 *   │ ┌─ Hook[1] ─┐
 *   │ │ ┌─ doLimit ─┐ │ │
 *   │ │ └───────────┘ │ │
 *   │ └───────────────┘ │
 *   └───────────────────┘
 *
 * 异常安全：
 * - 如果 Hook 在调用 callNext() 前抛出异常，跳过该 Hook 继续执行链条
 * - 如果 Hook 在调用 callNext() 后抛出异常，返回已缓存的结果
 * - 防止因 Hook 异常导致限流器被重复执行（配额多扣）
 *
 * @param hooks - Hook 列表
 * @param doLimit - 实际的限流函数
 * @param context - Hook 上下文
 * @returns 包装后的限流函数
 */
export function buildHookChain(
  hooks: Hook[],
  doLimit: () => RateLimitResult,
  context: HookContext,
): () => RateLimitResult {
  if (hooks.length === 0) {
    return doLimit;
  }

  // 从内到外构建链（最后一个 Hook 最靠近 doLimit）
  let chain = doLimit;

  for (let i = hooks.length - 1; i >= 0; i--) {
    const hook = hooks[i];
    const nextFn = chain;

    chain = () => {
      // 标记 callNext 是否已被调用过
      let nextCalled = false;
      let nextResult: RateLimitResult | null = null;

      // 包装的 callNext 函数
      const trackedNext = () => {
        nextResult = nextFn();
        nextCalled = true;
        return nextResult;
      };

      try {
        return hook.onLimit(trackedNext, context);
      } catch {
        // Hook 抛异常时的安全处理：
        // - 如果 callNext 已经执行过，返回缓存的结果
        // - 如果 callNext 还没执行，跳过当前 Hook 继续执行
        if (nextCalled && nextResult) {
          return nextResult;
        }
        return nextFn();
      }
    };
  }

  return chain;
}

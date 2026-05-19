/**
 * throttled-nodejs 异常定义模块
 *
 * 定义了库中所有可能抛出的异常类型，形成一个统一的异常体系。
 * 所有异常都继承自 BaseThrottledError。
 *
 * 对应 Python 原版: throttled/exceptions.py
 */

import { RateLimitResult } from './rate-limiter/base';

// 延迟导入避免循环依赖
let RateLimitResultType: typeof RateLimitResult | null = null;
export function _setRateLimitResultType(cls: typeof RateLimitResult): void {
  RateLimitResultType = cls;
}

// ============================================================
// 异常基类
// ============================================================

/**
 * 所有限流相关异常的基类
 *
 * 库中所有自定义异常都应继承此类，便于上层统一捕获处理。
 */
export class BaseThrottledError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

// ============================================================
// 具体异常类
// ============================================================

/**
 * 初始化/配置错误
 *
 * 当限流器配置不正确时抛出，例如注册表中找不到指定的算法。
 */
export class SetUpError extends BaseThrottledError {
  constructor(message?: string) {
    super(message);
  }
}

/**
 * 参数数据错误
 *
 * 当传入的参数字段无效时抛出，例如：
 * - key 为空或 null
 * - cost 为负数
 * - timeout 格式不正确
 * - quota 字符串格式无法解析
 */
export class DataError extends BaseThrottledError {
  constructor(message?: string) {
    super(message);
  }
}

/**
 * 存储不可用错误
 *
 * 当存储后端（如 Redis）连接失败或不可用时抛出。
 */
export class StoreUnavailableError extends BaseThrottledError {
  constructor(message?: string) {
    super(message);
  }
}

/**
 * 限流拒绝错误
 *
 * 当请求被限流器拒绝时抛出。通常用于装饰器模式和上下文管理器模式，
 * 在这些模式下，被限流时会抛出异常而不是返回结果。
 *
 * 示例消息：
 * "Rate limit exceeded: remaining=0, reset_after=60, retry_after=60"
 */
export class LimitedError extends BaseThrottledError {
  /** 限流检查的结果对象，包含详细的限流状态信息 */
  public rateLimitResult: RateLimitResult | null;

  constructor(rateLimitResult?: RateLimitResult | null) {
    const result = rateLimitResult ?? null;
    let message: string;

    if (!result || !result.state) {
      message = 'Rate limit exceeded.';
    } else {
      message = [
        'Rate limit exceeded:',
        `remaining=${result.state.remaining},`,
        `reset_after=${result.state.resetAfter},`,
        `retry_after=${result.state.retryAfter}.`,
      ].join(' ');
    }

    super(message);
    this.rateLimitResult = result;
    this.name = 'LimitedError';
  }
}

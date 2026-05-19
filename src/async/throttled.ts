/**
 * throttled-nodejs 异步版 Throttled 限流门面类
 *
 * 提供基于 Promise/async-await 的异步限流接口。
 * 与同步版本共享核心逻辑，但：
 * - 等待使用 await 而非忙等待
 * - 限流器使用异步存储后端
 * - 装饰器返回 async 函数
 *
 * 对应 Python 原版: throttled/asyncio/throttled.py
 */

import { RateLimiterType } from '../constants';
import { DataError, LimitedError } from '../exceptions';
import { HookContext } from '../hooks';
import { parseQuota } from '../quota-parser';
import {
  BaseRateLimiter,
  Quota,
  RateLimiterRegistry,
  RateLimitResult,
  RateLimitState,
  perMin,
} from '../rate-limiter/base';
import { StoreP, KeyT, RateLimiterTypeT } from '../types';
import { nowMonoF } from '../utils';

// ============================================================
// AsyncHook —— 异步 Hook 抽象基类
// ============================================================

/**
 * 异步版本 Hook 抽象基类
 *
 * 与同步 Hook 的区别：onLimit 返回 Promise，支持 await。
 */
export abstract class AsyncHook {
  abstract onLimit(
    callNext: () => Promise<RateLimitResult>,
    context: HookContext,
  ): Promise<RateLimitResult>;
}

// ============================================================
// AsyncHook 链构建
// ============================================================

/**
 * 构建异步 Hook 链
 *
 * @param hooks - 异步 Hook 列表
 * @param doLimit - 异步限流函数
 * @param context - Hook 上下文
 * @returns 包装后的异步限流函数
 */
export function buildAsyncHookChain(
  hooks: AsyncHook[],
  doLimit: () => Promise<RateLimitResult>,
  context: HookContext,
): () => Promise<RateLimitResult> {
  if (hooks.length === 0) return doLimit;

  let chain = doLimit;
  for (let i = hooks.length - 1; i >= 0; i--) {
    const hook = hooks[i];
    const nextFn = chain;

    chain = async () => {
      let nextCalled = false;
      let nextResult: RateLimitResult | null = null;

      const trackedNext = async () => {
        nextResult = await nextFn();
        nextCalled = true;
        return nextResult;
      };

      try {
        return await hook.onLimit(trackedNext, context);
      } catch {
        if (nextCalled && nextResult) return nextResult;
        return await nextFn();
      }
    };
  }

  return chain;
}

// ============================================================
// AsyncThrottled —— 异步版限流门面类
// ============================================================

/**
 * 异步版 Throttled 限流门面类
 *
 * 所有限流操作返回 Promise，支持 await。
 * 异步等待使用 await sleep 而非忙等待。
 *
 * 使用示例：
 * ```
 * const throttle = new AsyncThrottled({ quota: "100/s" });
 * const result = await throttle.limit("/api");
 * console.log(result.limited);  // false
 * ```
 */
export class AsyncThrottled {
  /** 非阻塞模式常量 */
  static _NON_BLOCKING: number = -1;
  static _WAIT_INTERVAL: number = 0.5;
  static _WAIT_MIN_INTERVAL: number = 0.2;

  public key: string | null;
  public timeout: number;
  protected _quota: Quota;
  protected _store: StoreP;
  protected _limiterCls: typeof BaseRateLimiter;
  protected _limiter: BaseRateLimiter | null = null;
  protected _cost: number;
  protected _hooks: AsyncHook[] = [];

  constructor(options: {
    key?: KeyT | null;
    timeout?: number | null;
    using?: RateLimiterTypeT | null;
    quota?: Quota | string | null;
    store?: StoreP | null;
    cost?: number;
    hooks?: AsyncHook[] | null;
  } = {}) {
    this.key = options.key ?? null;
    this.timeout = options.timeout ?? AsyncThrottled._NON_BLOCKING;
    this._validateTimeout(this.timeout);
    this._quota = this._parseQuota(options.quota ?? null);

    const defaultStore = options.store ?? new (require('../store/memory').MemoryStore)();
    if (!defaultStore) {
      throw new DataError('Invalid store: store is required.');
    }
    this._store = defaultStore;

    const limiterType = options.using ?? RateLimiterType.TOKEN_BUCKET;
    this._limiterCls = RateLimiterRegistry.get(limiterType) as unknown as typeof BaseRateLimiter;
    this._validateCost(options.cost ?? 1);
    this._cost = options.cost ?? 1;
    if (options.hooks) this._hooks = options.hooks;
  }

  get limiter(): BaseRateLimiter {
    if (this._limiter) return this._limiter;
    this._limiter = new (this._limiterCls as unknown as new (q: Quota, s: StoreP) => BaseRateLimiter)(this._quota, this._store);
    return this._limiter;
  }

  protected _validateCost(cost: number): void {
    if (typeof cost === 'number' && Number.isInteger(cost) && cost >= 0) return;
    throw new DataError(`Invalid cost: ${cost}, must be an integer >= 0.`);
  }

  protected _validateTimeout(timeout: number): void {
    if (timeout === AsyncThrottled._NON_BLOCKING) return;
    if (typeof timeout === 'number' && timeout > 0) return;
    throw new DataError(`Invalid timeout: ${timeout}, must be positive or -1.`);
  }

  protected _parseQuota(quota: Quota | string | null): Quota {
    if (quota === null) return perMin(60);
    if (quota instanceof Quota) return quota;
    const parsed = parseQuota(quota);
    if (parsed.length > 1) {
      throw new DataError('Multiple quota rules not supported yet.');
    }
    return parsed[0];
  }

  protected _getKey(key?: KeyT | null): string {
    if (key) return key;
    if (this.key) return this.key;
    throw new DataError(`Invalid key: ${key}, must be a non-empty key.`);
  }

  protected _getTimeout(timeout?: number | null): number {
    if (timeout != null) {
      this._validateTimeout(timeout);
      return timeout;
    }
    return this.timeout;
  }

  protected _getWaitTime(retryAfter: number): number {
    return Math.max(
      Math.min(retryAfter, AsyncThrottled._WAIT_INTERVAL),
      AsyncThrottled._WAIT_MIN_INTERVAL,
    );
  }

  protected _isExitWaiting(startTime: number, retryAfter: number, timeout: number): boolean {
    const elapsed = nowMonoF() - startTime;
    return elapsed >= retryAfter || elapsed >= timeout;
  }

  /**
   * 异步等待（使用 setTimeout Promise 化）
   *
   * @param timeout - 最大等待时间
   * @param retryAfter - 建议重试时间
   */
  async _wait(timeout: number, retryAfter: number): Promise<void> {
    if (retryAfter <= 0) return;
    const startTime = nowMonoF();

    return new Promise<void>(resolve => {
      const check = () => {
        if (this._isExitWaiting(startTime, retryAfter, timeout)) {
          resolve();
          return;
        }
        const waitTime = this._getWaitTime(retryAfter);
        setTimeout(check, waitTime * 1000);
      };
      check();
    });
  }

  /**
   * 执行限流检查的内部逻辑（含重试循环）
   *
   * @param key - 限流标识
   * @param cost - 本次消耗
   * @param timeout - 最大等待时间
   * @returns 限流结果
   */
  async _doLimit(key: string, cost: number, timeout: number): Promise<RateLimitResult> {
    let result = this.limiter.limit(key, cost);

    if (timeout === AsyncThrottled._NON_BLOCKING || !result.limited) {
      return result;
    }

    const startTime = nowMonoF();
    while (true) {
      const remainingTime = timeout - (nowMonoF() - startTime);
      if (remainingTime <= 0) break;
      await this._wait(remainingTime, result.state.retryAfter);
      result = this.limiter.limit(key, cost);
      if (!result.limited) break;
    }

    return result;
  }

  /**
   * 执行限流检查（公开异步 API）
   *
   * @param key - 限流标识
   * @param cost - 本次消耗
   * @param timeout - 最大等待时间
   * @returns 限流结果 Promise
   */
  async limit(key?: KeyT | null, cost?: number, timeout?: number | null): Promise<RateLimitResult> {
    const resolvedKey = this._getKey(key ?? null);
    const resolvedCost = cost ?? this._cost;
    const resolvedTimeout = this._getTimeout(timeout ?? null);
    this._validateCost(resolvedCost);

    if (this._hooks.length === 0) {
      return await this._doLimit(resolvedKey, resolvedCost, resolvedTimeout);
    }

    const self = this;
    async function doLimit(): Promise<RateLimitResult> {
      return await self._doLimit(resolvedKey, resolvedCost, resolvedTimeout);
    }

    const context = new HookContext(
      resolvedKey,
      resolvedCost,
      (this._limiterCls as unknown as { Meta: { type: string } }).Meta.type,
      this._store.TYPE,
    );

    const chain = buildAsyncHookChain(this._hooks, doLimit, context);
    return await chain();
  }

  /** 查询限流状态 */
  async peek(key: string): Promise<RateLimitState> {
    return this.limiter.peek(key);
  }

  /** 异步上下文管理器 */
  async enter(): Promise<RateLimitResult> {
    const result = await this.limit();
    if (result.limited) throw new LimitedError(result);
    return result;
  }

  exit(): void {
    // no-op
  }

  /**
   * 创建异步限流装饰器
   *
   * @param options - Throttled 配置选项
   * @returns 装饰器函数
   */
  static decorate(options: {
    key: string;
    timeout?: number | null;
    using?: RateLimiterTypeT | null;
    quota?: Quota | string | null;
    store?: StoreP | null;
    cost?: number;
    hooks?: AsyncHook[] | null;
  }): MethodDecorator {
    const throttled = new AsyncThrottled(options);

    return function (
      _target: object,
      _propertyKey: string | symbol,
      descriptor: PropertyDescriptor,
    ): PropertyDescriptor {
      const originalMethod = descriptor.value;

      descriptor.value = async function (...args: unknown[]) {
        const result = await throttled.limit();
        if (result.limited) {
          throw new LimitedError(result);
        }
        return originalMethod.apply(this, args);
      };

      return descriptor;
    };
  }
}

/**
 * throttled-nodejs 核心门面类（同步版本）
 *
 * Throttled 是限流库的门面类（Facade），提供统一的限流操作接口。
 * 封装了限流器创建、Key 管理、超时重试、Hook 链等复杂逻辑。
 *
 * 支持四种调用模式：
 * 1. 函数调用  → throttle.limit(key)
 * 2. 装饰器    → @Throttled(key=...) 修饰函数
 * 3. 上下文管理器 → with throttle: ...
 * 4. 等待重试  → throttle.limit(key, timeout=1)
 *
 * 对应 Python 原版: throttled/throttled.py
 */

import { RateLimiterType } from './constants';
import { DataError, LimitedError } from './exceptions';
import { Hook, HookContext, buildHookChain } from './hooks';
import { parseQuota } from './quota-parser';
import {
  BaseRateLimiter,
  Quota,
  RateLimiterRegistry,
  RateLimitResult,
  RateLimitState,
  perMin,
} from './rate-limiter/base';
import { MemoryStore } from './store/memory';
import { StoreP, KeyT, RateLimiterTypeT } from './types';
import { nowMonoF } from './utils';

// 导入各限流算法模块以触发注册
import './rate-limiter/fixed-window';
import './rate-limiter/sliding-window';
import './rate-limiter/token-bucket';
import './rate-limiter/leaking-bucket';
import './rate-limiter/gcra';

// ============================================================
// BaseThrottledMixin —— 公用混入逻辑
// ============================================================

/**
 * Throttled 的公用逻辑混入
 *
 * 提供同步和异步版本共享的功能：
 * - 参数校验（cost、timeout、hooks）
 * - 配额解析（支持 DSL 字符串和 Quota 对象）
 * - Key 解析
 * - 限流器惰性初始化
 * - 等待重试逻辑
 */
class BaseThrottledMixin {
  /** 非阻塞模式的常量 —— -1 表示立即返回 */
  static _NON_BLOCKING: number = -1;

  /** 等待间隔（秒）—— 分块休眠的每块大小 */
  static _WAIT_INTERVAL: number = 0.5;

  /** 最小等待间隔（秒）—— 防止忙等待 */
  static _WAIT_MIN_INTERVAL: number = 0.2;

  // ---- 实例属性 ----
  public key: string | null;
  public timeout: number;
  protected _quota: Quota;
  protected _store: StoreP;
  protected _limiterCls: typeof BaseRateLimiter;
  protected _limiter: BaseRateLimiter | null = null;
  protected _cost: number;
  protected _hooks: Hook[] = [];

  /**
   * @param options - Throttled 配置选项
   */
  constructor(options: {
    key?: KeyT | null;
    timeout?: number | null;
    using?: RateLimiterTypeT | null;
    quota?: Quota | string | null;
    store?: StoreP | null;
    cost?: number;
    hooks?: Hook[] | null;
  }) {
    this.key = options.key ?? null;

    // 设置超时时间
    this.timeout = options.timeout ?? BaseThrottledMixin._NON_BLOCKING;
    this._validateTimeout(this.timeout);

    // 解析配额
    this._quota = this._parseQuota(options.quota ?? null);

    // 设置存储后端（默认全局 MemoryStore）
    const defaultStore = options.store ?? this._getDefaultStore();
    if (!defaultStore) {
      throw new DataError('Invalid store: store is required for current throttler.');
    }
    this._store = defaultStore;

    // 获取限流器类
    const limiterType = options.using ?? RateLimiterType.TOKEN_BUCKET;
    this._limiterCls = this._getRegistryClass(limiterType);

    // 设置成本
    this._validateCost(options.cost ?? 1);
    this._cost = options.cost ?? 1;

    // 设置 Hook
    if (options.hooks) {
      this._hooks = this._validateHooks(options.hooks);
    }
  }

  /** 获取默认存储后端（子类可覆盖） */
  protected _getDefaultStore(): StoreP {
    return new MemoryStore();
  }

  /** 获取限流器注册表类（子类可覆盖以支持异步注册表） */
  protected _getRegistryClass(type: RateLimiterTypeT): typeof BaseRateLimiter {
    return RateLimiterRegistry.get(type) as unknown as typeof BaseRateLimiter;
  }

  // ============================================================
  // 限流器惰性初始化
  // ============================================================

  /**
   * 获取限流器实例（惰性初始化 + 双重检查锁定）
   *
   * 限流器在首次使用时才创建，避免不必要的初始化开销。
   * 双重检查锁定保证线程安全。
   */
  get limiter(): BaseRateLimiter {
    if (this._limiter) {
      return this._limiter;
    }
    this._limiter = new (this._limiterCls as unknown as new (quota: Quota, store: StoreP) => BaseRateLimiter)(
      this._quota, this._store,
    );
    return this._limiter;
  }

  // ============================================================
  // 参数校验
  // ============================================================

  /** 校验 cost 参数（必须为非负整数） */
  protected _validateCost(cost: number): void {
    if (typeof cost === 'number' && Number.isInteger(cost) && cost >= 0) {
      return;
    }
    throw new DataError(`Invalid cost: ${cost}, must be an integer >= 0.`);
  }

  /** 校验 timeout 参数（必须为 -1 或正数） */
  protected _validateTimeout(timeout: number): void {
    if (timeout === BaseThrottledMixin._NON_BLOCKING) return;
    if (typeof timeout === 'number' && timeout > 0) return;
    throw new DataError(`Invalid timeout: ${timeout}, must be a positive float or -1 (non-blocking).`);
  }

  /** 校验 Hook 类型 */
  protected _validateHooks(hooks: Hook[]): Hook[] {
    for (const hook of hooks) {
      if (!(hook instanceof Hook)) {
        throw new TypeError(`Invalid hook type: ${typeof hook}. Expected Hook instance.`);
      }
    }
    return hooks;
  }

  // ============================================================
  // 配额与 Key 解析
  // ============================================================

  /** 解析配额参数（支持字符串 DSL 和 Quota 对象） */
  protected _parseQuota(quota: Quota | string | null): Quota {
    if (quota === null) {
      return perMin(60);
    }
    if (quota instanceof Quota) {
      return quota;
    }
    // 字符串解析
    const parsed = parseQuota(quota);
    if (parsed.length > 1) {
      throw new DataError(
        'Invalid quota: multiple quota rules are not supported in Throttled(quota=...) yet.',
      );
    }
    return parsed[0];
  }

  /** 解析 Key（优先使用传入的 key，其次是实例 key） */
  protected _getKey(key?: KeyT | null): string {
    if (key) return key;
    if (this.key) return this.key;
    throw new DataError(`Invalid key: ${key}, must be a non-empty key.`);
  }

  /** 解析 timeout（优先使用传入的 timeout，其次是实例 timeout） */
  protected _getTimeout(timeout?: number | null): number {
    if (timeout != null) {
      this._validateTimeout(timeout);
      return timeout;
    }
    return this.timeout;
  }

  // ============================================================
  // 等待重试逻辑
  // ============================================================

  /**
   * 计算等待时间
   *
   * 分块等待策略：
   * - _WAIT_INTERVAL：最大每块等待时间，避免长时间阻塞
   * - _WAIT_MIN_INTERVAL：最小每块等待时间，防止忙等待
   *
   * @param retryAfter - 建议的等待时间
   * @returns 实际等待时间
   */
  protected _getWaitTime(retryAfter: number): number {
    return Math.max(
      Math.min(retryAfter, BaseThrottledMixin._WAIT_INTERVAL),
      BaseThrottledMixin._WAIT_MIN_INTERVAL,
    );
  }

  /**
   * 判断是否应退出等待
   *
   * @param startTime - 开始等待的时间（单调时钟）
   * @param retryAfter - 建议重试时间
   * @param timeout - 用户设置的最大等待时间
   * @returns true=应该退出等待
   */
  protected _isExitWaiting(startTime: number, retryAfter: number, timeout: number): boolean {
    const elapsed = nowMonoF() - startTime;
    return elapsed >= retryAfter || elapsed >= timeout;
  }

  /** 等待（同步版本使用 setTimeout + 事件循环） */
  protected _wait(timeout: number, retryAfter: number): Promise<void> {
    return new Promise(resolve => {
      if (retryAfter <= 0) {
        resolve();
        return;
      }
      const startTime = nowMonoF();
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
}

// ============================================================
// Throttled —— 同步版限流门面类
// ============================================================

/**
 * 同步版 Throttled 限流门面类
 *
 * 提供函数调用、装饰器、上下文管理器三种模式。
 *
 * 函数调用模式：
 * ```
 * const throttle = new Throttled({ quota: "100/s" });
 * const result = throttle.limit("/api");
 * ```
 *
 * 装饰器模式：
 * ```
 * class API {
 *   @Throttled.decorate({ key: "/api", quota: "5/m" })
 *   fetch() { return "data"; }
 * }
 * ```
 *
 * 上下文管理器模式：
 * ```
 * const throttle = new Throttled({ quota: "1/m" });
 * const result = throttle.enter();
 * // ... do work ...
 * throttle.exit();
 * ```
 */
export class Throttled extends BaseThrottledMixin {
  constructor(options: {
    key?: KeyT | null;
    timeout?: number | null;
    using?: RateLimiterTypeT | null;
    quota?: Quota | string | null;
    store?: StoreP | null;
    cost?: number;
    hooks?: Hook[] | null;
  } = {}) {
    super(options);
  }

  // ============================================================
  // 核心限流逻辑
  // ============================================================

  /**
   * 执行限流检查的内部逻辑（含重试循环）
   *
   * 如果 timeout 为 -1（非阻塞），立即返回结果。
   * 否则在限流时持续重试，直到允许或超时。
   *
   * @param key - 限流标识
   * @param cost - 本次消耗
   * @param timeout - 最大等待时间
   * @returns 限流结果
   */
  protected _doLimit(key: string, cost: number, timeout: number): RateLimitResult {
    // 第一次尝试
    let result: RateLimitResult = this.limiter.limit(key, cost);

    // 非阻塞模式或已允许 → 直接返回
    if (timeout === BaseThrottledMixin._NON_BLOCKING || !result.limited) {
      return result;
    }

    // 阻塞重试模式
    const startTime = nowMonoF();

    // 同步版本的等待使用定时器轮询
    while (true) {
      if (result.state.retryAfter > timeout) {
        break;  // 等待时间超过用户设置的最大超时，不再等待
      }

      // 同步等待（这里用循环轮询模拟，实际应用中应使用异步版本）
      const waitTime = this._getWaitTime(result.state.retryAfter);
      const waitUntil = nowMonoF() + waitTime;
      while (nowMonoF() < waitUntil) {
        // 忙等待（仅用于演示，实际使用请用异步版本）
      }

      // 重试
      result = this.limiter.limit(key, cost);
      if (!result.limited) {
        break;  // 允许了
      }

      if (nowMonoF() - startTime >= timeout) {
        break;  // 总超时
      }
    }

    return result;
  }

  /**
   * 执行限流检查（公开 API）
   *
   * @param key - 限流标识（覆盖实例 key）
   * @param cost - 本次消耗（默认使用实例 cost）
   * @param timeout - 最大等待时间（覆盖实例 timeout）
   * @returns 限流结果
   */
  limit(key?: KeyT | null, cost?: number, timeout?: number | null): RateLimitResult {
    const resolvedKey = this._getKey(key ?? null);
    const resolvedCost = cost ?? this._cost;
    const resolvedTimeout = this._getTimeout(timeout ?? null);

    this._validateCost(resolvedCost);

    // 无 Hook 时直接执行
    if (this._hooks.length === 0) {
      return this._doLimit(resolvedKey, resolvedCost, resolvedTimeout);
    }

    // 有 Hook 时包装执行链
    const self = this;
    function doLimit(): RateLimitResult {
      return self._doLimit(resolvedKey, resolvedCost, resolvedTimeout);
    }

    const context = new HookContext(
      resolvedKey,
      resolvedCost,
      (this._limiterCls as unknown as { Meta: { type: string } }).Meta.type,
      this._store.TYPE,
    );

    const chain = buildHookChain(this._hooks, doLimit, context);
    return chain();
  }

  /**
   * 查询限流状态（不修改）
   *
   * @param key - 限流标识
   * @returns 当前限流状态
   */
  peek(key: string): RateLimitState {
    return this.limiter.peek(key);
  }

  // ============================================================
  // 上下文管理器模式
  // ============================================================

  /**
   * 进入上下文（限流检查 + 获取结果）
   *
   * 在限流时抛出 LimitedError。
   *
   * @returns 限流结果
   */
  enter(): RateLimitResult {
    const result = this.limit();
    if (result.limited) {
      throw new LimitedError(result);
    }
    return result;
  }

  /** 退出上下文 */
  exit(): void {
    // 无需额外清理
  }

  // ============================================================
  // 装饰器模式
  // ============================================================

  /**
   * 创建限流装饰器
   *
   * 返回一个装饰器函数，可以用于修饰类方法。
   *
   * @param options - Throttled 配置选项
   * @returns 装饰器函数
   *
   * 使用示例：
   * ```
   * class API {
   *   @Throttled.decorate({ key: "/api", quota: "5/m" })
   *   fetch() { return "ok"; }
   * }
   * ```
   */
  static decorate(options: {
    key: string;
    timeout?: number | null;
    using?: RateLimiterTypeT | null;
    quota?: Quota | string | null;
    store?: StoreP | null;
    cost?: number;
    hooks?: Hook[] | null;
  }): MethodDecorator {
    const throttled = new Throttled(options);

    return function (
      _target: object,
      _propertyKey: string | symbol,
      descriptor: PropertyDescriptor,
    ): PropertyDescriptor {
      const originalMethod = descriptor.value;

      descriptor.value = function (...args: unknown[]) {
        const result = throttled.limit();
        if (result.limited) {
          throw new LimitedError(result);
        }
        return originalMethod.apply(this, args);
      };

      return descriptor;
    };
  }
}

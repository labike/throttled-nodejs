/**
 * throttled-nodejs 限流器基类模块
 *
 * 本模块定义了所有限流算法的核心基础设施，包括：
 * - Rate：速率配置（周期 + 请求上限）
 * - Quota：配额配置（速率 + 突发容量），自动推导出 periodSec / emissionInterval / fillRate
 * - perSec / perMin / perHour / perDay / perWeek：便捷的配额工厂函数
 * - RateLimitState：查询限流器当前状态的数据类
 * - RateLimitResult：执行限流操作后返回的结果类
 * - RateLimiterRegistry：限流器注册表（元类自动注册）
 * - BaseRateLimiterMixin：限流器混入基类（Key 前缀、原子操作注册）
 * - BaseRateLimiter：限流器抽象基类
 *
 * 对应 Python 原版: throttled/rate_limiter/base.py
 */

import { AtomicActionP, AtomicActionTypeT, RateLimiterTypeT, StoreBackendP } from '../types';
import type { StoreP } from '../types';
import { SetUpError } from '../exceptions';

export type { StoreP };

// ============================================================
// Rate 与 Quota —— 速率/配额数据模型
// ============================================================

/**
 * 速率配置 —— 定义在指定时间周期内允许的最大请求数
 *
 * 例如：Rate(period=1秒, limit=100) 表示每秒最多 100 个请求。
 */
export class Rate {
  /** 时间周期（秒） */
  public readonly period: number;

  /** 周期内最大请求数 */
  public readonly limit: number;

  /**
   * @param periodSeconds - 时间周期（秒），例如 1、60、3600
   * @param limit - 周期内允许的最大请求数
   */
  constructor(periodSeconds: number, limit: number) {
    this.period = periodSeconds;
    this.limit = limit;
  }
}

/**
 * 配额配置 —— 完整的限流规则定义
 *
 * 包含基础速率和突发容量（burst）。创建时会自动计算出：
 * - periodSec：周期秒数
 * - emissionInterval：每次请求的发射间隔（periodSec / limit）
 * - fillRate：每秒填充速率（limit / periodSec）
 *
 * 配额可以通过可读性强的 DSL 字符串创建，例如 "100/s burst 200"，
 * 也可以通过 Quota 类和 perSec/perMin 等工厂函数创建。
 */
export class Quota {
  /** 基础速率配置 */
  public readonly rate: Rate;

  /** 突发容量 —— 允许瞬时超过基础速率的额外容量 */
  public readonly burst: number;

  /** 周期秒数（整数） */
  public readonly periodSec: number;

  /** 每次请求的发射间隔（秒）—— 用于 GCRA 等算法 */
  public readonly emissionInterval: number;

  /** 每秒填充速率（令牌/秒）—— 用于令牌桶、漏桶等算法 */
  public readonly fillRate: number;

  /**
   * @param rate - 速率配置
   * @param burst - 突发容量（默认为 rate.limit）
   */
  constructor(rate: Rate, burst?: number) {
    this.rate = rate;
    this.burst = burst ?? rate.limit;
    this.periodSec = Math.floor(rate.period);
    this.emissionInterval = this.periodSec / rate.limit;
    this.fillRate = rate.limit / this.periodSec;
  }

  /** 获取周期秒数 */
  getPeriodSec(): number {
    return this.periodSec;
  }

  /** 获取周期内请求上限 */
  getLimit(): number {
    return this.rate.limit;
  }
}

// ============================================================
// 配额工厂函数
// ============================================================

/** 创建指定时长、上限和突发容量的配额 */
export function perDuration(durationSec: number, limit: number, burst?: number): Quota {
  return new Quota(new Rate(durationSec, limit), burst);
}

/** 每秒配额 —— 如 perSec(100) 表示每秒 100 次 */
export function perSec(limit: number, burst?: number): Quota {
  return perDuration(1, limit, burst);
}

/** 每分钟配额 —— 如 perMin(60) 表示每分钟 60 次 */
export function perMin(limit: number, burst?: number): Quota {
  return perDuration(60, limit, burst);
}

/** 每小时配额 */
export function perHour(limit: number, burst?: number): Quota {
  return perDuration(3600, limit, burst);
}

/** 每天配额 */
export function perDay(limit: number, burst?: number): Quota {
  return perDuration(86400, limit, burst);
}

/** 每周配额 */
export function perWeek(limit: number, burst?: number): Quota {
  return perDuration(604800, limit, burst);
}

// ============================================================
// RateLimitState —— 限流器当前状态
// ============================================================

/**
 * 限流器当前状态
 *
 * 表示针对某个 Key，限流器的当前快照状态。
 * 在执行 limit() 或 peek() 操作后返回。
 *
 * 各字段含义：
 * - limit：初始状态下允许的最大请求数（配额上限）
 * - remaining：当前状态下还剩下多少请求可用
 * - resetAfter：经过此秒数后，限流器将回到初始状态（limit === remaining）
 * - retryAfter：当前请求需要等待的秒数（0 表示请求已被允许）
 */
export class RateLimitState {
  constructor(
    /** 配额上限 —— 初始状态下的最大允许请求数 */
    public readonly limit: number,
    /** 当前剩余可用请求数 */
    public readonly remaining: number,
    /** 距复位到初始状态的秒数 */
    public readonly resetAfter: number,
    /** 建议重试等待秒数（0 表示无需等待） */
    public readonly retryAfter: number = 0,
  ) {}
}

// ============================================================
// RateLimitResult —— 限流操作结果
// ============================================================

/**
 * 限流操作结果
 *
 * 在执行 limit() 操作后返回，包含：
 * - limited：是否被限流（true=拒绝，false=允许）
 * - state：限流器当前状态（RateLimitState 实例）
 *
 * 延迟创建 state 属性以优化性能（rateState 在首次访问时才构建）。
 */
export class RateLimitResult {
  /** 是否被限流 —— true=请求被拒绝，false=请求被允许 */
  public readonly limited: boolean;

  /** 原始状态值元组 [limit, remaining, resetAfter, retryAfter] */
  private readonly _stateValues: [number, number, number, number];

  /** 缓存的 RateLimitState 实例（惰性初始化） */
  private _state: RateLimitState | null = null;

  constructor(limited: boolean, stateValues: [number, number, number, number]) {
    this.limited = limited;
    this._stateValues = stateValues;
  }

  /** 获取 RateLimitState（惰性创建） */
  get state(): RateLimitState {
    if (!this._state) {
      this._state = new RateLimitState(...this._stateValues);
    }
    return this._state;
  }
}

// ============================================================
// RateLimiterRegistry —— 限流器注册表
// ============================================================

/**
 * 限流器注册表
 *
 * 管理所有已注册的限流器实现类。
 * 通过命名空间（sync/asyncio）隔离同步和异步版本的限流器。
 * 限流器类通过 RateLimiterMeta 元类自动注册，无需手动维护注册表。
 */
export class RateLimiterRegistry {
  /** 命名空间前缀 —— 同步版本使用 "sync" */
  protected static _NAMESPACE: string = 'sync';

  /** 注册表存储 —— 以 "namespace:type" 为键存储限流器类 */
  protected static _RATE_LIMITERS: Map<string, new (quota: Quota, store: StoreP) => BaseRateLimiter> = new Map();

  /**
   * 获取注册用的复合键
   *
   * @param type - 算法类型字符串
   * @returns "namespace:type" 格式的复合键
   */
  static getRegisterKey(type: string): string {
    return `${this._NAMESPACE}:${type}`;
  }

  /**
   * 注册一个限流器类到注册表
   *
   * @param newCls - 要注册的限流器类（必须包含 Meta.type 属性）
   * @throws SetUpError 当限流器类缺少 Meta.type 时抛出
   */
  static register(newCls: new (quota: Quota, store: StoreP) => BaseRateLimiter): void {
    try {
      const metaType = (newCls as unknown as { Meta: { type: string } }).Meta.type;
      this._RATE_LIMITERS.set(this.getRegisterKey(metaType), newCls);
    } catch (e) {
      throw new SetUpError(`Failed to register RateLimiter: ${e}`);
    }
  }

  /**
   * 根据算法类型获取对应的限流器类
   *
   * @param type - 算法类型字符串
   * @returns 限流器类（构造函数）
   * @throws SetUpError 当未找到匹配的限流器时抛出
   */
  static get(type: RateLimiterTypeT): new (quota: Quota, store: StoreP) => BaseRateLimiter {
    const key = this.getRegisterKey(type);
    const cls = this._RATE_LIMITERS.get(key);
    if (!cls) {
      throw new SetUpError(`RateLimier type "${type}" not found in registry`);
    }
    return cls;
  }
}

// ============================================================
// RateLimiterMeta —— 限流器元类（替代 Python 元类实现）
// ============================================================

/**
 * 限流器元类辅助函数
 *
 * 在 Python 中通过 metaclass=RateLimiterMeta 在类定义时自动注册。
 * 在 JavaScript/TypeScript 中，通过在文件末尾显式调用 register() 来实现相同的效果。
 *
 * 每个 RateLimiter 实现类在定义后应调用此函数完成注册。
 */
/**
 * RateLimiter 构造函数类型
 * 包含限流器类的构造函数签名和必须的静态 Meta 属性
 */
export function registerRateLimiter(
  cls: new (quota: Quota, store: StoreP) => BaseRateLimiter,
  registryClass: typeof RateLimiterRegistry = RateLimiterRegistry,
): void {
  registryClass.register(cls);
}

// ============================================================
// BaseRateLimiterMixin —— 限流器混入基类
// ============================================================

/**
 * 限流器公用逻辑混入
 *
 * 提供所有限流器实现共享的功能：
 * - Key 前缀格式化（所有存储键统一前缀 "throttled:v1:{type}:{key}"）
 * - 原子操作注册和管理
 * - 配额存储
 *
 * 对应 Python 的 BaseRateLimiterMixin。
 */
export class BaseRateLimiterMixin {
  /** 存储键的统一前缀 */
  static KEY_PREFIX: string = 'throttled:v1:';

  /** 配额配置 */
  public quota: Quota;

  /** 存储后端 */
  protected _store: StoreP;

  /** 已注册的原子操作实例 */
  protected _atomicActions: Map<AtomicActionTypeT, AtomicActionP> = new Map();

  /** 算法的元信息（子类需覆盖 Meta.type） */
  static Meta: { type: RateLimiterTypeT } = { type: '' };

  constructor(quota: Quota, store: StoreP) {
    this.quota = quota;
    this._store = store;
  }

  /**
   * 获取默认的原子操作类列表
   * 子类需覆盖此方法返回该算法支持的原子操作类
   */
  static _defaultAtomicActionClasses(): Array<new (backend: StoreBackendP) => AtomicActionP> {
    return [];
  }

  /**
   * 获取支持的原子操作类型列表
   * 子类需覆盖此方法返回该算法需要的操作类型
   */
  static _supportedAtomicActionTypes(): AtomicActionTypeT[] {
    return [];
  }

  /**
   * 为指定存储类型注册原子操作
   *
   * 遍历默认原子操作类列表，筛选出与当前存储类型匹配的类并实例化。
   *
   * @param store - 存储后端实例（用于创建原子操作和筛选类型）
   */
  _registerAtomicActions(store: StoreP): void {
    const cls = this.constructor as typeof BaseRateLimiterMixin;
    const actionClasses = cls._defaultAtomicActionClasses();

    for (const ActionCls of actionClasses) {
      // 只注册与当前存储类型匹配的原子操作
      if ((ActionCls as unknown as { STORE_TYPE: string }).STORE_TYPE !== store.TYPE) {
        continue;
      }
      const instance = store.makeAtomic(ActionCls as unknown as new (backend: StoreBackendP) => AtomicActionP);
      this._atomicActions.set(
        (ActionCls as unknown as { TYPE: AtomicActionTypeT }).TYPE,
        instance,
      );
    }

    // 验证所有必须的操作类型都已注册
    this._validateRegisteredAtomicActions(cls);
  }

  /**
   * 验证必须的原子操作类型是否全部注册
   *
   * @param cls - 当前的限流器类
   * @throws SetUpError 当缺少必须的原子操作时抛出
   */
  private _validateRegisteredAtomicActions(cls: typeof BaseRateLimiterMixin): void {
    const supportedTypes = new Set(cls._supportedAtomicActionTypes());
    const registeredTypes = new Set(this._atomicActions.keys());

    for (const type of supportedTypes) {
      if (!registeredTypes.has(type)) {
        throw new SetUpError(
          `Missing AtomicAction: expected "${type}" but it was not registered for store type "${this._store.TYPE}".`,
        );
      }
    }
  }

  /**
   * 格式化存储键 —— 添加统一前缀
   *
   * 最终的存储键格式：throttled:v1:{algorithm_type}:{original_key}
   *
   * @param key - 原始键
   * @returns 格式化后的完整键
   */
  _prepareKey(key: string): string {
    const cls = this.constructor as typeof BaseRateLimiterMixin;
    return `${cls.KEY_PREFIX}${cls.Meta.type}:${key}`;
  }
}

// ============================================================
// BaseRateLimiter —— 限流器抽象基类
// ============================================================

/**
 * 限流器抽象基类
 *
 * 定义了所有限流器实现必须提供的接口：
 * - limit(key, cost)：执行限流检查，返回限流结果
 * - peek(key)：查询当前限流状态，但不修改状态
 *
 * 子类需实现 _limit() 和 _peek() 两个抽象方法。
 */
export class BaseRateLimiter extends BaseRateLimiterMixin {
  constructor(quota: Quota, store: StoreP) {
    super(quota, store);
    // 在子类构造函数执行完后，由子类手动调用 _registerAtomicActions
    // 因为 JavaScript 构造函数中无法访问子类的静态属性
  }

  /**
   * 执行限流检查
   *
   * @param key - 限流标识（如用户 ID、IP 地址）
   * @param cost - 本次请求消耗的配额数（默认为 1）
   * @returns 限流操作结果
   */
  limit(key: string, cost: number = 1): RateLimitResult {
    return this._limit(key, cost);
  }

  /**
   * 查询限流状态（不修改状态）
   *
   * @param key - 限流标识
   * @returns 当前限流状态
   */
  peek(key: string): RateLimitState {
    return this._peek(key);
  }

  /** 子类实现的限流逻辑 */
  protected _limit(key: string, cost: number): RateLimitResult {
    throw new Error('Not implemented');
  }

  /** 子类实现的查询逻辑 */
  protected _peek(key: string): RateLimitState {
    throw new Error('Not implemented');
  }
}

/**
 * throttled-nodejs 存储后端基类模块
 *
 * 定义存储后端的抽象接口和基础组件：
 * - BaseStoreBackend：存储后端的抽象基类
 * - BaseAtomicAction：原子操作的抽象基类
 * - BaseStore：存储的抽象基类（定义所有存储必须实现的操作）
 *
 * 存储后端的类层次结构：
 * BaseStoreBackend (底层连接管理)
 *   ├── MemoryStoreBackend (内存 OrderedDict + LRU + TTL)
 *   └── RedisStoreBackend (Redis 连接池)
 *
 * BaseStore (高层操作接口，对接限流器)
 *   ├── MemoryStore
 *   └── RedisStore
 *
 * 对应 Python 原版: throttled/store/base.py
 */

import { AtomicActionP, AtomicActionTypeT, KeyT, StoreBackendP, StoreDictValueT, StoreValueT } from '../types';
import { DataError } from '../exceptions';

// ============================================================
// BaseStoreBackend —— 存储后端抽象基类
// ============================================================

/**
 * 存储后端的抽象基类
 *
 * 管理底层存储连接的相关配置。
 * 每个具体的存储后端实现（如内存、Redis）都需继承此类。
 */
export abstract class BaseStoreBackend {
  /** 服务器连接地址 */
  public server: string | null;

  /** 连接选项 */
  public options: Record<string, unknown>;

  constructor(server?: string | null, options?: Record<string, unknown> | null) {
    this.server = server ?? null;
    this.options = options ?? {};
  }

  /** 获取底层存储客户端实例 */
  abstract getClient(): unknown;
}

// ============================================================
// BaseAtomicAction —— 原子操作基类
// ============================================================

/**
 * 原子操作混入基类
 *
 * 定义原子操作的元信息：
 * - TYPE：操作的唯一标识（如 "limit"、"peek"）
 * - STORE_TYPE：该操作适用的存储类型（如 "memory"、"redis"）
 */
export class BaseAtomicActionMixin {
  /** 操作类型标识 */
  static TYPE: AtomicActionTypeT = '';

  /** 适用的存储类型 */
  static STORE_TYPE: string = '';
}

/**
 * 原子操作抽象基类
 *
 * 原子操作封装了限流算法在特定存储后端上的核心操作逻辑，
 * 保证操作的原子性和线程安全性。
 *
 * 每种限流算法 + 每种存储后端的组合都有一个独立的原子操作实现类。
 * 例如：
 * - TokenBucket + Redis = TokenBucketRedisLimitAtomicAction
 * - TokenBucket + Memory = TokenBucketMemoryLimitAtomicAction
 */
export abstract class BaseAtomicAction extends BaseAtomicActionMixin {
  /** 后端实例引用 */
  protected _backend: StoreBackendP;

  constructor(backend: StoreBackendP) {
    super();
    this._backend = backend;
  }

  /**
   * 执行原子操作
   *
   * @param keys - 操作的键列表
   * @param args - 操作的参数列表
   * @returns 执行结果（数值数组）
   */
  abstract do(keys: KeyT[], args?: StoreValueT[]): number[] | Promise<number[]>;
}

// ============================================================
// BaseStoreMixin —— 存储混入基类
// ============================================================

/**
 * 存储公用逻辑混入
 *
 * 提供所有存储实现共享的功能：
 * - TYPE：存储类型标识
 * - 超时参数校验
 */
export class BaseStoreMixin {
  /** 存储类型标识（如 "memory"、"redis"） */
  static TYPE: string = '';

  /**
   * 验证超时参数
   *
   * @param timeout - 超时秒数（必须为正整数）
   * @throws DataError 当超时参数无效时抛出
   */
  static _validateTimeout(timeout: number): void {
    if (typeof timeout === 'number' && Number.isInteger(timeout) && timeout > 0) {
      return;
    }
    throw new DataError(`Invalid timeout: ${timeout}, must be a positive integer.`);
  }
}

// ============================================================
// BaseStore —— 存储抽象基类
// ============================================================

/**
 * 存储的抽象基类
 *
 * 定义了所有存储实现必须提供的操作接口：
 * - exists(key)：检查键是否存在
 * - ttl(key)：获取键的剩余生存时间
 * - expire(key, timeout)：设置键的过期时间
 * - set(key, value, timeout)：设置键值对及过期时间
 * - get(key)：获取键的值
 * - hset(name, key, value, mapping)：设置哈希表中的字段
 * - hgetall(name)：获取哈希表中所有字段
 * - makeAtomic(actionCls)：创建原子操作实例
 */
export abstract class BaseStore extends BaseStoreMixin {
  constructor(server?: string | null, options?: Record<string, unknown> | null) {
    super();
  }

  abstract exists(key: KeyT): boolean | Promise<boolean>;
  abstract ttl(key: KeyT): number | Promise<number>;
  abstract expire(key: KeyT, timeout: number): void | Promise<void>;
  abstract set(key: KeyT, value: StoreValueT, timeout: number): void | Promise<void>;
  abstract get(key: KeyT): StoreValueT | null | Promise<StoreValueT | null>;
  abstract hset(
    name: KeyT,
    key?: KeyT | null,
    value?: StoreValueT | null,
    mapping?: StoreDictValueT | null,
  ): void | Promise<void>;
  abstract hgetall(name: KeyT): StoreDictValueT | Promise<StoreDictValueT>;
  abstract makeAtomic(actionCls: new (backend: StoreBackendP) => AtomicActionP): AtomicActionP;
}

/**
 * throttled-nodejs MemoryStore 实现
 *
 * 基于内存的存储后端，本质上是一个具有 TTL（生存时间）和
 * LRU（最近最少使用）淘汰策略的键值缓存。
 *
 * 核心特性：
 * 1. 基于 OrderedDict 思想（使用 Map + 手动维护顺序）
 * 2. 惰性过期检查 —— 在读取时检查是否过期
 * 3. LRU 淘汰 —— 容量超限时淘汰最久未访问的条目
 * 4. 线程安全 —— 使用锁保护并发访问
 *
 * 性能基准（Python 原版测试数据）：
 * - LRU with Lock and Expiry -> 265 ms, 76.8 MB
 * - LRU only                  -> 103 ms, 76.8 MB
 *
 * 对应 Python 原版: throttled/store/memory.py
 */

import { StoreType, STORE_TTL_STATE_NOT_EXIST, STORE_TTL_STATE_NOT_TTL } from '../constants';
import { DataError, SetUpError } from '../exceptions';
import {
  AtomicActionP,
  AtomicActionTypeT,
  KeyT,
  LockP,
  StoreBackendP,
  StoreBucketValueT,
  StoreDictValueT,
  StoreValueT,
} from '../types';
import { nowMonoF } from '../utils';
import { BaseAtomicAction, BaseStore, BaseStoreBackend } from './base';

// ============================================================
// MemoryStoreBackend —— 内存存储后端
// ============================================================

/**
 * 内存存储后端
 *
 * 使用 Map + 手动维护的 LRU 顺序实现。
 * 当容量超出 MAX_SIZE 时，淘汰最久未访问的条目。
 * 过期检查采用惰性策略 —— 仅在访问时检查。
 */
export class MemoryStoreBackend extends BaseStoreBackend {
  /** 最大容量 */
  public maxSize: number;

  /** 过期时间信息映射（key -> 过期时间戳） */
  public expireInfo: Map<string, number> = new Map();

  /** 线程锁（Node.js 中是单线程，这里提供接口兼容） */
  public lock: LockP;

  /** 底层存储 —— 使用 Map 保存键值对 */
  private _client: Map<KeyT, StoreBucketValueT>;

  /** LRU 顺序链表 —— 保存键的访问顺序 */
  private _lruOrder: KeyT[] = [];

  constructor(server?: string | null | Record<string, unknown>, options?: Record<string, unknown> | null) {
    // 兼容 call signatures:
    //   new MemoryStoreBackend()                    -> server=null, options=null
    //   new MemoryStoreBackend("server")            -> server="server", options=null
    //   new MemoryStoreBackend({ MAX_SIZE: 2048 })  -> server=null, options={MAX_SIZE:2048}
    if (typeof server === 'object' && server !== null && !Array.isArray(server)) {
      options = server as Record<string, unknown>;
      server = null;
    }
    super(server as string | null | undefined, options);

    // 读取配置中的 MAX_SIZE，默认 1024
    const maxSize = (this.options['MAX_SIZE'] as number) ?? 1024;
    if (typeof maxSize !== 'number' || maxSize <= 0) {
      throw new SetUpError('MAX_SIZE must be a positive integer');
    }
    this.maxSize = maxSize;
    this._client = new Map();
    this.lock = this._getLock();
  }

  /** 创建锁实例（Node.js 中可通过简单互斥模拟） */
  protected _getLock(): LockP {
    // Node.js 是单线程事件循环，此处用简易锁保持接口兼容
    return {
      acquire(): boolean { return true; },
      release(): void { /* no-op */ },
    };
  }

  /** 获取底层 Map 实例 */
  getClient(): Map<KeyT, StoreBucketValueT> {
    return this._client;
  }

  /** 检查键是否存在 */
  exists(key: KeyT): boolean {
    return this._client.has(key);
  }

  // ============================================================
  // 过期管理
  // ============================================================

  /**
   * 检查键是否已过期
   *
   * @param key - 要检查的键
   * @returns true 表示已过期
   */
  hasExpired(key: KeyT): boolean {
    return this.ttl(key) === STORE_TTL_STATE_NOT_EXIST;
  }

  /**
   * 获取键的剩余生存时间
   *
   * @param key - 要检查的键
   * @returns 剩余秒数（-1=无过期，-2=键不存在）
   */
  ttl(key: KeyT): number {

    const exp = this.expireInfo.get(key);

    // 无过期信息
    if (exp === undefined) {
      if (!this.exists(key)) {
        return STORE_TTL_STATE_NOT_EXIST;
      }
      return STORE_TTL_STATE_NOT_TTL;
    }

    // 计算剩余时间
    const remaining = exp - nowMonoF();
    if (remaining <= 0) {
      return STORE_TTL_STATE_NOT_EXIST;
    }
    return Math.ceil(remaining);
  }

  // ============================================================
  // LRU 淘汰管理
  // ============================================================

  /**
   * 检查并执行 LRU 淘汰
   *
   * 当存储已满且键不存在时，淘汰最久未访问的条目。
   *
   * @param key - 即将插入的键
   */
  checkAndEvict(key: KeyT): void {
    const isFull = this._client.size >= this.maxSize;
    if (isFull && !this.exists(key)) {
      // 淘汰 LRU 顺序链表中的第一个（最久未访问）
      const evictKey = this._lruOrder.shift();
      if (evictKey !== undefined) {
        this._client.delete(evictKey);
        this.expireInfo.delete(evictKey);
      }
    }
  }

  // ============================================================
  // LRU 顺序维护
  // ============================================================

  /**
   * 将键移动到 LRU 链表末尾（标记为最近使用）
   *
   * @param key - 被访问的键
   */
  private _moveToEnd(key: KeyT): void {
    const idx = this._lruOrder.indexOf(key);
    if (idx !== -1) {
      this._lruOrder.splice(idx, 1);
    }
    this._lruOrder.push(key);
  }

  // ============================================================
  // 核心操作
  // ============================================================

  /**
   * 设置键的过期时间
   *
   * @param key - 要设置的键
   * @param timeout - 过期秒数
   */
  expire(key: KeyT, timeout: number): void {
    this.expireInfo.set(key, nowMonoF() + timeout);
  }

  /**
   * 获取键的值
   *
   * 惰性过期检查：如果键已过期，则删除并返回 null。
   * 同时将该键移到 LRU 链表末尾。
   *
   * @param key - 要获取的键
   * @returns 值或 null
   */
  get(key: KeyT): StoreValueT | null {
    if (this.hasExpired(key)) {
      this.delete(key);
      return null;
    }

    const value = this._client.get(key) as StoreValueT | undefined;
    if (value !== undefined) {
      this._moveToEnd(key);
    }
    return value ?? null;
  }

  /**
   * 设置键值对
   *
   * @param key - 要设置的键
   * @param value - 要设置的值
   * @param timeout - 过期秒数
   */
  set(key: KeyT, value: StoreValueT, timeout: number): void {
    this.checkAndEvict(key);
    this._client.set(key, value);
    this._moveToEnd(key);
    this.expire(key, timeout);
  }

  /**
   * 设置哈希表中的字段
   *
   * @param name - 哈希表名
   * @param key - 字段名（可选，与 mapping 二选一）
   * @param value - 字段值（与 key 配对使用）
   * @param mapping - 字段映射（可选，与 key/value 二选一）
   */
  hset(
    name: KeyT,
    key?: KeyT | null,
    value?: StoreValueT | null,
    mapping?: StoreDictValueT | null,
  ): void {
    if (!key && !mapping) {
      throw new DataError('hset must be called with key/value or mapping');
    }

    // 构建要写入的字段集合
    const kv: StoreDictValueT = {};
    if (key != null) {
      kv[key] = value ?? 0;
    }
    if (mapping) {
      Object.assign(kv, mapping);
    }

    // 获取或创建哈希表
    let origin = this._client.get(name);
    if (origin !== undefined && !(origin instanceof Object)) {
      throw new DataError('origin value is not a dict, cannot hset');
    }

    if (origin === undefined) {
      this.checkAndEvict(name);
      origin = {};
      this._client.set(name, origin);
    }

    Object.assign(origin as StoreDictValueT, kv);
    this._moveToEnd(name);
  }

  /**
   * 获取哈希表中所有字段
   *
   * @param name - 哈希表名
   * @returns 字段映射（空对象表示不存在或已过期）
   */
  hgetall(name: KeyT): StoreDictValueT {
    if (this.hasExpired(name)) {
      this.delete(name);
      return {};
    }

    const kv = this._client.get(name);
    if (kv === undefined) {
      return {};
    }
    if (typeof kv !== 'object') {
      throw new DataError('Numeric value does not support hgetall');
    }

    this._moveToEnd(name);
    return { ...kv as StoreDictValueT };
  }

  /**
   * 删除键
   *
   * @param key - 要删除的键
   * @returns true 表示删除成功
   */
  delete(key: KeyT): boolean {
    this.expireInfo.delete(key);
    const idx = this._lruOrder.indexOf(key);
    if (idx !== -1) {
      this._lruOrder.splice(idx, 1);
    }
    return this._client.delete(key);
  }
}

// ============================================================
// MemoryStore —— 内存存储外观
// ============================================================

/**
 * 内存存储
 *
 * 基于 MemoryStoreBackend 的高层封装，对外提供线程安全的存储操作。
 * 本质上是一个具有 TTL 和 LRU 淘汰策略的缓存。
 *
 * 当未指定存储后端时，Throttled 默认使用一个全局共享的 MemoryStore 实例。
 */
export class MemoryStore extends BaseStore {
  TYPE: string = StoreType.MEMORY;

  /** 后端实例 */
  private _backend: MemoryStoreBackend;

  constructor(server?: string | null | Record<string, unknown>, options?: Record<string, unknown> | null) {
    if (typeof server === 'object' && server !== null && !Array.isArray(server)) {
      options = server as Record<string, unknown>;
      server = null;
    }
    super(server as string | null | undefined, options);
    this._backend = new MemoryStoreBackend(server, options);
  }

  exists(key: KeyT): boolean {
    return this._backend.exists(key);
  }

  ttl(key: KeyT): number {
    return this._backend.ttl(key);
  }

  expire(key: KeyT, timeout: number): void {
    (this.constructor as typeof BaseStore)._validateTimeout(timeout);
    this._backend.expire(key, timeout);
  }

  set(key: KeyT, value: StoreValueT, timeout: number): void {
    (this.constructor as typeof BaseStore)._validateTimeout(timeout);
    this._backend.set(key, value, timeout);
  }

  get(key: KeyT): StoreValueT | null {
    return this._backend.get(key);
  }

  hset(name: KeyT, key?: KeyT | null, value?: StoreValueT | null, mapping?: StoreDictValueT | null): void {
    this._backend.hset(name, key, value, mapping);
  }

  hgetall(name: KeyT): StoreDictValueT {
    return this._backend.hgetall(name);
  }

  makeAtomic(actionCls: new (backend: StoreBackendP) => AtomicActionP): AtomicActionP {
    return new actionCls(this._backend);
  }
}

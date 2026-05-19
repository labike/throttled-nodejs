/**
 * throttled-nodejs 类型定义模块
 *
 * 本模块定义了整个限流库中使用的所有核心类型，包括：
 * - 键类型、存储值类型等基础类型别名
 * - 锁和存储后端的行为协议（Protocol 接口）
 * - 原子操作的行为协议
 *
 * 对应 Python 原版: throttled/types.py
 */

// ============================================================
// 基础类型别名
// ============================================================

/** 限流键的类型 —— 用于标识被限流的对象（如用户ID、IP地址） */
export type KeyT = string;

/** 存储值的类型 —— 数值型（计数器、令牌数等） */
export type StoreValueT = number;

/** 存储字典值的类型 —— Key-Value 映射（如令牌桶的 Hash 结构） */
export type StoreDictValueT = Record<KeyT, number>;

/** 存储桶值的类型 —— 可以是一个数值或一个字典 */
export type StoreBucketValueT = number | StoreDictValueT;

/** 原子操作类型的字符串标识 */
export type AtomicActionTypeT = string;

/** 限流器类型的字符串标识 */
export type RateLimiterTypeT = string;

/** 时间值的类型 */
export type TimeLikeValueT = number;

// ============================================================
// 锁协议接口 —— 定义同步/异步锁的行为
// ============================================================

/** 同步锁协议 —— 仿 threading.Lock 接口 */
export interface SyncLockP {
  acquire(): boolean;
  release(): void;
}

/** 异步锁协议 —— 仿 asyncio.Lock 接口 */
export interface AsyncLockP {
  acquire(): Promise<boolean>;
  release(): void;
}

/** 统一的锁类型 —— 可以是同步锁或异步锁 */
export type LockP = SyncLockP | AsyncLockP;

// ============================================================
// 存储后端协议接口
// ============================================================

/** 存储后端的协议 —— 只要能提供 getClient() 的都可作为后端 */
export interface StoreBackendP {
  getClient(): unknown;
}

// ============================================================
// 原子操作协议接口 —— 定义同步/异步原子操作的行为
// ============================================================

/** 同步原子操作的协议（TYPE/STORE_TYPE 定义在类上，非实例） */
export interface SyncAtomicActionP {
  do(keys: KeyT[], args?: StoreValueT[]): number[];
}

/** 异步原子操作的协议（TYPE/STORE_TYPE 定义在类上，非实例） */
export interface AsyncAtomicActionP {
  do(keys: KeyT[], args?: StoreValueT[]): Promise<number[]>;
}

/** 统一的原子操作类型 */
export type AtomicActionP = SyncAtomicActionP | AsyncAtomicActionP;

// ============================================================
// 存储协议接口 —— 定义同步/异步存储的行为
// ============================================================

/** 同步存储的协议接口 */
export interface SyncStoreP {
  TYPE: string;
  exists(key: KeyT): boolean;
  ttl(key: KeyT): number;
  expire(key: KeyT, timeout: number): void;
  set(key: KeyT, value: StoreValueT, timeout: number): void;
  get(key: KeyT): StoreValueT | null;
  hgetall(name: KeyT): StoreDictValueT;
  hset(name: KeyT, key?: KeyT | null, value?: StoreValueT | null, mapping?: StoreDictValueT | null): void;
  makeAtomic(actionCls: new (backend: StoreBackendP) => AtomicActionP): AtomicActionP;
}

/** 异步存储的协议接口 */
export interface AsyncStoreP {
  TYPE: string;
  exists(key: KeyT): Promise<boolean>;
  ttl(key: KeyT): Promise<number>;
  expire(key: KeyT, timeout: number): Promise<void>;
  set(key: KeyT, value: StoreValueT, timeout: number): Promise<void>;
  get(key: KeyT): Promise<StoreValueT | null>;
  hgetall(name: KeyT): Promise<StoreDictValueT>;
  hset(name: KeyT, key?: KeyT | null, value?: StoreValueT | null, mapping?: StoreDictValueT | null): Promise<void>;
  makeAtomic(actionCls: new (backend: StoreBackendP) => AtomicActionP): AtomicActionP;
}

/** 统一的存储类型 —— 可以是同步或异步存储 */
export type StoreP = SyncStoreP | AsyncStoreP;

/**
 * throttled-nodejs RedisStore 实现
 *
 * 基于 ioredis 的 Redis 存储后端实现。
 * 支持三种部署模式：
 * 1. Standalone（单机模式）
 * 2. Sentinel（哨兵模式）
 * 3. Cluster（集群模式）
 *
 * 配置方式：
 * - Standalone: redis://127.0.0.1:6379/0
 * - Sentinel:   redis+sentinel://host1:26379,host2:26379/mymaster
 * - Cluster:    redis+cluster://host1:6379,host2:6379
 *
 * 对应 Python 原版: throttled/store/redis.py
 */

import { StoreType } from '../constants';
import { DataError } from '../exceptions';
import {
  AtomicActionP,
  AtomicActionTypeT,
  KeyT,
  StoreBackendP,
  StoreDictValueT,
  StoreValueT,
} from '../types';
import { formatKv, formatValue } from '../utils';
import { BaseAtomicAction, BaseStore, BaseStoreBackend } from './base';

// 尝试导入 ioredis（可选依赖）
let RedisModule: typeof import('ioredis') | null = null;
try {
  RedisModule = require('ioredis');
} catch {
  // Redis 是可选的，不强制要求安装
}

// ============================================================
// RedisStoreBackend —— Redis 存储后端
// ============================================================

/**
 * Redis 存储后端
 *
 * 管理 Redis 连接，支持三种部署模式下自动配置连接参数。
 * 解析 URL scheme 自动选择连接方式。
 */
export class RedisStoreBackend extends BaseStoreBackend {
  /** Redis 客户端实例 */
  private _client: import('ioredis').Redis | import('ioredis').Cluster | null = null;

  constructor(server?: string | null, options?: Record<string, unknown> | null) {
    const parsed = RedisStoreBackend._parse(server, options);
    super(parsed.server, parsed.options);

    if (!RedisModule) {
      throw new Error(
        'ioredis is required for RedisStore. Install with: npm install ioredis',
      );
    }
  }

  /**
   * 解析 Redis 连接参数
   *
   * 根据 URL scheme 自动识别部署模式并配置相应的连接参数。
   *
   * @param server - Redis 连接 URL
   * @param options - 连接选项
   * @returns 解析后的 server 和 options
   */
  static _parse(
    server?: string | null,
    options?: Record<string, unknown> | null,
  ): { server: string | null; options: Record<string, unknown> } {
    const opts: Record<string, unknown> = { ...(options ?? {}) };

    if (!server) {
      return { server: null, options: opts };
    }

    // 哨兵模式：redis+sentinel://
    if (server.startsWith('redis+sentinel://')) {
      const url = new URL(server);

      // 解析认证信息
      if (url.username) opts['username'] = url.username;
      if (url.password) opts['password'] = url.password;

      // 解析哨兵节点
      const sentinels: Array<{ host: string; port: number }> = [];
      const idx = url.host.lastIndexOf('@') + 1;
      const hostPart = idx > 0 ? url.host.substring(idx) : url.host;
      for (const node of hostPart.split(',')) {
        const [host, portStr] = node.split(':');
        sentinels.push({ host, port: parseInt(portStr, 10) || 26379 });
      }
      opts['sentinels'] = opts['sentinels'] ?? sentinels;

      // 提取服务名
      const serviceName = url.pathname.replace(/^\//, '') || 'mymaster';
      server = `redis://${serviceName}/0`;
    }
    // 集群模式：redis+cluster://
    else if (server.startsWith('redis+cluster://')) {
      const url = new URL(server);
      if (url.username) opts['username'] = url.username;
      if (url.password) opts['password'] = url.password;

      // 解析集群节点
      const clusterNodes: Array<{ host: string; port: number }> = [];
      const idx = url.host.lastIndexOf('@') + 1;
      const hostPart = idx > 0 ? url.host.substring(idx) : url.host;
      for (const node of hostPart.split(',')) {
        const [host, portStr] = node.split(':');
        clusterNodes.push({ host, port: parseInt(portStr, 10) || 6379 });
      }
      opts['clusterNodes'] = opts['clusterNodes'] ?? clusterNodes;
    }

    return { server, options: opts };
  }

  /**
   * 获取或创建 Redis 客户端
   *
   * 惰性初始化 —— 首次访问时根据配置创建连接。
   *
   * @returns Redis 客户端实例
   */
  getClient(): import('ioredis').Redis | import('ioredis').Cluster {
    if (!this._client) {
      const opts = this.options;

      // 哨兵模式
      if (opts['sentinels']) {
        if (!RedisModule) throw new Error('ioredis not available');
        this._client = new RedisModule.Redis({
          sentinels: opts['sentinels'] as Array<{ host: string; port: number }>,
          name: this.server?.replace('redis://', '').split('/')[0] || 'mymaster',
          ...(opts['password'] ? { password: opts['password'] as string } : {}),
        });
      }
      // 集群模式
      else if (opts['clusterNodes']) {
        if (!RedisModule) throw new Error('ioredis not available');
        this._client = new RedisModule.Cluster(
          opts['clusterNodes'] as Array<{ host: string; port: number }>,
          { redisOptions: { ...(opts['password'] ? { password: opts['password'] as string } : {}) } },
        );
      }
      // 单机模式
      else {
        if (!RedisModule) throw new Error('ioredis not available');
        this._client = new RedisModule.Redis(
          this.server || 'redis://localhost:6379/0',
          {
            ...(opts['SOCKET_TIMEOUT'] ? { connectTimeout: opts['SOCKET_TIMEOUT'] as number } : {}),
            ...(opts['password'] ? { password: opts['password'] as string } : {}),
            ...(opts['username'] ? { username: opts['username'] as string } : {}),
          },
        );
      }
    }
    return this._client;
  }
}

// ============================================================
// RedisStore —— Redis 存储外观
// ============================================================

/**
 * Redis 存储
 *
 * 基于 ioredis 的高层封装，提供与 MemoryStore 一致的接口。
 * 可用于分布式环境下的限流，多个进程/服务共享同一个限流状态。
 */
export class RedisStore extends BaseStore {
  TYPE: string = StoreType.REDIS;

  private _backend: RedisStoreBackend;

  constructor(server?: string | null, options?: Record<string, unknown> | null) {
    super(server, options);
    this._backend = new RedisStoreBackend(server, options);
  }

  exists(key: KeyT): Promise<boolean> {
    return this._backend.getClient().exists(key).then(r => r > 0);
  }

  ttl(key: KeyT): Promise<number> {
    return this._backend.getClient().ttl(key).then(r => r);
  }

  expire(key: KeyT, timeout: number): Promise<void> {
    (this.constructor as typeof BaseStore)._validateTimeout(timeout);
    return this._backend.getClient().expire(key, timeout).then(() => undefined);
  }

  set(key: KeyT, value: StoreValueT, timeout: number): Promise<void> {
    (this.constructor as typeof BaseStore)._validateTimeout(timeout);
    return this._backend.getClient().set(key, value, 'EX', timeout).then(() => undefined);
  }

  async get(key: KeyT): Promise<StoreValueT | null> {
    const value = await this._backend.getClient().get(key);
    if (value === null) return null;
    return formatValue(parseFloat(value));
  }

  hset(
    name: KeyT,
    key?: KeyT | null,
    value?: StoreValueT | null,
    mapping?: StoreDictValueT | null,
  ): Promise<void> {
    if (!key && !mapping) {
      throw new DataError('hset must be called with key/value or mapping');
    }
    const client = this._backend.getClient();
    if (key != null) {
      return client.hset(name, key, String(value ?? 0)).then(() => undefined);
    }
    return client.hset(name, mapping as Record<string, string | number>).then(() => undefined);
  }

  async hgetall(name: KeyT): Promise<StoreDictValueT> {
    const result = await this._backend.getClient().hgetall(name);
    return formatKv(Object.fromEntries(
      Object.entries(result).map(([k, v]) => [k, parseFloat(v)]),
    ));
  }

  makeAtomic(actionCls: new (backend: StoreBackendP) => AtomicActionP): AtomicActionP {
    return new actionCls(this._backend);
  }
}

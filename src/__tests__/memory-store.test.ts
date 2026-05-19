/**
 * MemoryStore 单元测试
 *
 * 测试内存存储后端的核心功能：
 * - 基本读写
 * - TTL 过期
 * - LRU 淘汰
 * - Hash 操作
 * - 过期键清理
 */

import { MemoryStoreBackend, MemoryStore } from '../store/memory';
import { STORE_TTL_STATE_NOT_EXIST, STORE_TTL_STATE_NOT_TTL } from '../constants';
import { nowMonoF } from '../utils';

describe('MemoryStore', () => {
  // ============================================================
  // 基本操作
  // ============================================================

  describe('基本读写操作', () => {
    it('应能 set 和 get 值', () => {
      const store = new MemoryStore();
      store.set('key1', 42, 100);
      expect(store.get('key1')).toBe(42);
    });

    it('不存在的键应返回 null', () => {
      const store = new MemoryStore();
      expect(store.get('nonexistent')).toBeNull();
    });

    it('应能检查键是否存在', () => {
      const store = new MemoryStore();
      store.set('key1', 1, 100);
      expect(store.exists('key1')).toBe(true);
      expect(store.exists('nonexistent')).toBe(false);
    });
  });

  // ============================================================
  // TTL 过期
  // ============================================================

  describe('TTL 过期机制', () => {
    it('未设置 TTL 的键应返回 -1', () => {
      const backend = new MemoryStoreBackend();
      backend.getClient().set('key1', 42);
      expect(backend.ttl('key1')).toBe(STORE_TTL_STATE_NOT_TTL);
    });

    it('已过期的键应返回 -2 且 get() 返回 null', () => {
      const backend = new MemoryStoreBackend();
      backend.set('key1', 42, 0); // 过期时间为 0 → 立即过期
      expect(backend.ttl('key1')).toBe(STORE_TTL_STATE_NOT_EXIST);
      expect(backend.get('key1')).toBeNull();
    });

    it('TTL 应返回正确的剩余时间', () => {
      const backend = new MemoryStoreBackend();
      backend.set('key1', 42, 60); // 60 秒后过期
      const ttl = backend.ttl('key1');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(60);
    });
  });

  // ============================================================
  // LRU 淘汰
  // ============================================================

  describe('LRU 淘汰机制', () => {
    it('超出 MAX_SIZE 时应淘汰最久未访问的键', () => {
      const store = new MemoryStore(null, { MAX_SIZE: 3 });
      store.set('a', 1, 100);
      store.set('b', 2, 100);
      store.set('c', 3, 100);

      // 访问 a，使 b 成为最久未访问的
      store.get('a');

      // 插入 d，应淘汰 b
      store.set('d', 4, 100);

      expect(store.exists('a')).toBe(true); // a 被访问过，保留
      expect(store.exists('b')).toBe(false); // b 最久未访问，淘汰
      expect(store.exists('c')).toBe(true);
      expect(store.exists('d')).toBe(true);
    });
  });

  // ============================================================
  // Hash 操作
  // ============================================================

  describe('Hash 操作', () => {
    it('应支持 hset/hgetall', () => {
      const store = new MemoryStore();
      store.hset('bucket1', null, null, { tokens: 100, last_refreshed: 1000 });
      const result = store.hgetall('bucket1');
      expect(result['tokens']).toBe(100);
      expect(result['last_refreshed']).toBe(1000);
    });

    it('hset 应支持单个键值对', () => {
      const store = new MemoryStore();
      store.hset('bucket1', 'tokens', 200, null);
      const result = store.hgetall('bucket1');
      expect(result['tokens']).toBe(200);
    });

    it('不存在的 Hash 应返回空对象', () => {
      const store = new MemoryStore();
      expect(store.hgetall('nonexistent')).toEqual({});
    });
  });

  // ============================================================
  // 并发安全
  // ============================================================

  describe('线程安全', () => {
    it('应支持多操作序列', () => {
      const store = new MemoryStore();
      // 连续执行多个操作，验证状态一致
      store.set('counter', 0, 100);
      for (let i = 0; i < 10; i++) {
        const val = store.get('counter') as number;
        store.set('counter', val + 1, 100);
      }
      expect(store.get('counter')).toBe(10);
    });
  });

  // ============================================================
  // 边界情况
  // ============================================================

  describe('边界情况', () => {
    it('MAX_SIZE 必须为正整数', () => {
      expect(() => new MemoryStore(null, { MAX_SIZE: -1 })).toThrow();
      expect(() => new MemoryStore(null, { MAX_SIZE: 0 })).toThrow();
    });

    it('对数值值调用 hgetall 应报错', () => {
      const backend = new MemoryStoreBackend();
      backend.set('numeric', 42, 100);
      expect(() => backend.hgetall('numeric')).toThrow();
    });
  });
});

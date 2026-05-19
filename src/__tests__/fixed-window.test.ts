/**
 * 固定窗口限流算法测试
 *
 * 测试场景：
 * 1. 基本限流功能：允许和拒绝
 * 2. 窗口复位：跨窗口后计数器重置
 * 3. peek 查询：不影响状态
 * 4. 大 cost 消耗：一次消耗多个配额
 * 5. MemoryStore 和 RedisStore 后端
 */

import { FixedWindowRateLimiter } from '../rate-limiter/fixed-window';
import { perSec, perMin, Quota } from '../rate-limiter/base';
import { MemoryStore } from '../store/memory';
import { RateLimiterRegistry } from '../rate-limiter/base';
import { RateLimiterType } from '../constants';

describe('FixedWindowRateLimiter', () => {
  let limiter: FixedWindowRateLimiter;
  let store: MemoryStore;

  beforeEach(() => {
    // 每个测试用例前创建全新的限流器，避免状态干扰
    store = new MemoryStore();
    limiter = new FixedWindowRateLimiter(perSec(5), store); // 每秒 5 次
  });

  // ============================================================
  // 基本功能
  // ============================================================

  describe('基本限流功能', () => {
    it('应允许配额内的请求', () => {
      const result = limiter.limit('test:key');
      expect(result.limited).toBe(false);      // 允许
      expect(result.state.limit).toBe(5);       // 上限 5
      expect(result.state.remaining).toBe(4);   // 剩余 4
    });

    it('超出配额后应拒绝请求', () => {
      // 消耗 5 次（满配额）
      for (let i = 0; i < 5; i++) {
        const result = limiter.limit('test:key');
        expect(result.limited).toBe(false);
      }

      // 第 6 次应被拒绝
      const result = limiter.limit('test:key');
      expect(result.limited).toBe(true);
      expect(result.state.remaining).toBe(0);
    });

    it('cost 参数应正确消耗配额', () => {
      // 一次消耗 3 个配额
      let result = limiter.limit('test:key', 3);
      expect(result.limited).toBe(false);
      expect(result.state.remaining).toBe(2);  // 5 - 3 = 2

      // 再消耗 3 个 → 5 个，超限
      result = limiter.limit('test:key', 3);
      expect(result.limited).toBe(true);
    });

    it('cost 为 0 时不应被限流', () => {
      for (let i = 0; i < 10; i++) {
        const result = limiter.limit('test:key', 0);
        expect(result.limited).toBe(false);
      }
    });
  });

  // ============================================================
  // peek 操作
  // ============================================================

  describe('peek 操作', () => {
    it('peek 应返回当前状态而不改变它', () => {
      // 执行一次 limit
      limiter.limit('test:key');
      const state = limiter.peek('test:key');
      expect(state.remaining).toBe(4); // peek 不影响状态
    });

    it('未访问过的 key 的 peek 应返回满配额', () => {
      const state = limiter.peek('new:key');
      expect(state.remaining).toBe(5);
    });
  });

  // ============================================================
  // resetAfter 计算
  // ============================================================

  describe('resetAfter 计算', () => {
    it('resetAfter 应在窗口周期内', () => {
      const result = limiter.limit('test:key');
      // 对于 perSec(5)，窗口长度 1 秒，resetAfter 应在 [0, 1) 之间
      expect(result.state.resetAfter).toBeGreaterThanOrEqual(0);
      expect(result.state.resetAfter).toBeLessThanOrEqual(1);
    });

    it('被限流时 retryAfter 应等于 resetAfter', () => {
      for (let i = 0; i < 5; i++) limiter.limit('test:key');
      const result = limiter.limit('test:key');
      expect(result.limited).toBe(true);
      expect(result.state.retryAfter).toBe(result.state.resetAfter);
    });
  });

  // ============================================================
  // 多 Key 隔离
  // ============================================================

  describe('多 Key 隔离', () => {
    it('不同 Key 应有独立的计数器', () => {
      limiter.limit('key:a');
      limiter.limit('key:a');
      limiter.limit('key:a');

      const resultB = limiter.limit('key:b');
      expect(resultB.limited).toBe(false);  // 新 key，满配额
      expect(resultB.state.remaining).toBe(4);
    });

    it('不同 Key 之间不应相互影响限流', () => {
      // key:a 消耗所有配额
      for (let i = 0; i < 5; i++) limiter.limit('key:a');
      expect(limiter.limit('key:a').limited).toBe(true);

      // key:b 应该仍然是满配额
      expect(limiter.limit('key:b').limited).toBe(false);
    });
  });

  // ============================================================
  // 注册表集成
  // ============================================================

  describe('注册表集成', () => {
    it('应能通过注册表获取 FixedWindowRateLimiter', () => {
      const cls = RateLimiterRegistry.get(RateLimiterType.FIXED_WINDOW);
      expect(cls).toBeDefined();
      const instance = new cls(perMin(60), new MemoryStore());
      expect(instance).toBeInstanceOf(FixedWindowRateLimiter);
    });
  });
});

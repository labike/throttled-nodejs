/**
 * GCRA (Generic Cell Rate Algorithm) 限流算法测试
 *
 * GCRA 基于 TAT（理论到达时间）的数学模型，
 * 与令牌桶数学等价但存储更少（仅需一个 TAT 值）。
 *
 * 测试场景：
 * 1. 基本功能：允许和拒绝
 * 2. TAT 计算：验证 remaining 准确性
 * 3. Burst 突发能力
 * 4. 惰性恢复：等待后 TAT 更新
 * 5. peek 操作（GCRA 需要独立的 peek 逻辑）
 * 6. 多 Key 隔离
 * 7. 注册表集成
 */

import { GCRARateLimiter } from '../rate-limiter/gcra';
import { perSec, perMin } from '../rate-limiter/base';
import { MemoryStore } from '../store/memory';
import { RateLimiterRegistry } from '../rate-limiter/base';
import { RateLimiterType } from '../constants';

describe('GCRARateLimiter', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  // ============================================================
  // 基本功能
  // ============================================================

  describe('基本限流功能', () => {
    it('初始状态下应允许请求并返回正确剩余', () => {
      // perSec(10)：emissionInterval = 0.1s, burst = 10
      const limiter = new GCRARateLimiter(perSec(10), store);
      // 首次请求 cost=1 时，remaining = burst - 1 = 9
      const result = limiter.limit('key', 1);
      expect(result.limited).toBe(false);
      expect(result.state.remaining).toBe(9);
      // cost=0 的探测请求应返回 burst 完整值
      const probe = limiter.limit('key', 0);
      expect(probe.limited).toBe(false);
      expect(probe.state.remaining).toBe(9); // 不消耗，剩余不变
    });

    it('超出容量时应拒绝请求', () => {
      const limiter = new GCRARateLimiter(perSec(3), store);

      // 消耗所有容量（burst = 3）
      for (let i = 0; i < 3; i++) {
        expect(limiter.limit('key').limited).toBe(false);
      }
      // 第 4 次应拒绝
      expect(limiter.limit('key').limited).toBe(true);
    });
  });

  // ============================================================
  // Burst 能力
  // ============================================================

  describe('Burst 突发能力', () => {
    it('应支持 burst 参数', () => {
      // perSec(5, 10)：速率 5/s，burst 容量 10
      const limiter = new GCRARateLimiter(perSec(5, 10), store);

      // 可以连续突发 10 个请求
      for (let i = 0; i < 10; i++) {
        expect(limiter.limit('key').limited).toBe(false);
      }

      // 第 11 个拒绝
      expect(limiter.limit('key').limited).toBe(true);
    });
  });

  // ============================================================
  // TAT 恢复
  // ============================================================

  describe('TAT 惰性恢复', () => {
    it('等待后 TAT 应更新，允许新请求', async () => {
      // perSec(10)：每秒 10 个，100ms 产生一个
      const limiter = new GCRARateLimiter(perSec(10), store);

      // 消耗所有容量
      for (let i = 0; i < 10; i++) limiter.limit('key');
      expect(limiter.limit('key').limited).toBe(true);

      // 等待 200ms（产生约 2 个信元间隔）
      await new Promise(r => setTimeout(r, 200));

      const result = limiter.limit('key');
      expect(result.limited).toBe(false);
    });
  });

  // ============================================================
  // retryAfter
  // ============================================================

  describe('retryAfter', () => {
    it('允许时 retryAfter 应为 0', () => {
      const limiter = new GCRARateLimiter(perSec(10), store);
      const result = limiter.limit('key');
      expect(result.state.retryAfter).toBe(0);
    });

    it('拒绝时 retryAfter 应大于 0', () => {
      const limiter = new GCRARateLimiter(perSec(3), store);
      for (let i = 0; i < 3; i++) limiter.limit('key');
      const result = limiter.limit('key');
      expect(result.limited).toBe(true);
      expect(result.state.retryAfter).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // peek 操作（GCRA 的 peek 需要独立逻辑）
  // ============================================================

  describe('peek 操作', () => {
    it('peek 不应修改桶状态', () => {
      const limiter = new GCRARateLimiter(perSec(10), store);
      limiter.limit('key');

      const state = limiter.peek('key');
      expect(state.remaining).toBe(9); // 不变
    });

    it('连续 peek 应返回一致结果', () => {
      const limiter = new GCRARateLimiter(perSec(5), store);
      const s1 = limiter.peek('key');
      const s2 = limiter.peek('key');
      expect(s1.remaining).toBe(s2.remaining);
    });
  });

  // ============================================================
  // 多 Key 隔离
  // ============================================================

  describe('多 Key 隔离', () => {
    it('不同 Key 有独立的 TAT', () => {
      const limiter = new GCRARateLimiter(perSec(3), store);
      limiter.limit('key:a');
      limiter.limit('key:a');
      limiter.limit('key:a');

      // key:b 应该有完整的配额
      expect(limiter.limit('key:b').limited).toBe(false);
    });
  });

  // ============================================================
  // 注册表集成
  // ============================================================

  describe('注册表集成', () => {
    it('应能通过注册表创建 GCRARateLimiter', () => {
      const cls = RateLimiterRegistry.get(RateLimiterType.GCRA);
      const instance = new cls(perMin(60), new MemoryStore());
      expect(instance).toBeInstanceOf(GCRARateLimiter);
    });
  });
});

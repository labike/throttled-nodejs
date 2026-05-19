/**
 * 漏桶限流算法测试
 *
 * 漏桶与令牌桶是对称算法：
 * - 令牌桶：累加可用令牌
 * - 漏桶：累加积压请求
 *
 * 测试场景：
 * 1. 基本功能：允许和拒绝
 * 2. 漏水机制：随时间冷却
 * 3. peek 操作
 * 4. 多 Key 隔离
 * 5. 注册表集成
 */

import { LeakingBucketRateLimiter } from '../rate-limiter/leaking-bucket';
import { perSec, perMin } from '../rate-limiter/base';
import { MemoryStore } from '../store/memory';
import { RateLimiterRegistry } from '../rate-limiter/base';
import { RateLimiterType } from '../constants';

describe('LeakingBucketRateLimiter', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  // ============================================================
  // 基本功能
  // ============================================================

  describe('基本限流功能', () => {
    it('初始状态下应允许请求', () => {
      const limiter = new LeakingBucketRateLimiter(perSec(5), store);
      const result = limiter.limit('key');

      // 漏桶的 remaining 表示"剩余可用容量"
      expect(result.limited).toBe(false);
      expect(result.state.limit).toBe(5);     // 容量 5
      expect(result.state.remaining).toBe(4); // 用了 1，剩 4
    });

    it('桶满时应拒绝请求', () => {
      const limiter = new LeakingBucketRateLimiter(perSec(3), store);

      // 填满桶（3 个请求）
      limiter.limit('key'); // remaining: 2
      limiter.limit('key'); // remaining: 1
      limiter.limit('key'); // remaining: 0

      // 第 4 个溢出
      const result = limiter.limit('key');
      expect(result.limited).toBe(true);
    });

    it('cost 参数应正确消耗容量', () => {
      const limiter = new LeakingBucketRateLimiter(perSec(5), store);

      let result = limiter.limit('key', 3);
      expect(result.limited).toBe(false);
      expect(result.state.remaining).toBe(2);

      result = limiter.limit('key', 3);
      expect(result.limited).toBe(true);
    });
  });

  // ============================================================
  // 漏水机制
  // ============================================================

  describe('漏水机制', () => {
    it('等待后应腾出空间', async () => {
      // perSec(10)：每秒漏 10 个，容量 10
      const limiter = new LeakingBucketRateLimiter(perSec(10), store);

      // 填满桶
      for (let i = 0; i < 10; i++) limiter.limit('key');
      expect(limiter.limit('key').limited).toBe(true);

      // 等待 200ms，漏掉约 2 个请求
      await new Promise(r => setTimeout(r, 200));

      // 应该腾出空间了
      const result = limiter.limit('key');
      expect(result.limited).toBe(false);
    });

    it('漏水速率应与 fillRate 一致', () => {
      const limiter = new LeakingBucketRateLimiter(perSec(5, 10), store);
      // burst = 10，所以初始容量为 10
      expect(limiter.limit('key').state.remaining).toBe(9);
    });
  });

  // ============================================================
  // peek 操作
  // ============================================================

  describe('peek 操作', () => {
    it('peek 不应改变状态', () => {
      const limiter = new LeakingBucketRateLimiter(perSec(5), store);
      limiter.limit('key');

      const state = limiter.peek('key');
      expect(state.remaining).toBe(4); // 不变
    });
  });

  // ============================================================
  // resetAfter / retryAfter
  // ============================================================

  describe('resetAfter 和 retryAfter', () => {
    it('被限流时应返回正数的 retryAfter', () => {
      const limiter = new LeakingBucketRateLimiter(perSec(5), store);
      for (let i = 0; i < 5; i++) limiter.limit('key');

      const result = limiter.limit('key');
      expect(result.limited).toBe(true);
      expect(result.state.retryAfter).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // 注册表集成
  // ============================================================

  describe('注册表集成', () => {
    it('应能通过注册表创建 LeakingBucketRateLimiter', () => {
      const cls = RateLimiterRegistry.get(RateLimiterType.LEAKING_BUCKET);
      const instance = new cls(perMin(60), new MemoryStore());
      expect(instance).toBeInstanceOf(LeakingBucketRateLimiter);
    });
  });
});

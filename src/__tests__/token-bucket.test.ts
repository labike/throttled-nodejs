/**
 * 令牌桶限流算法测试
 *
 * 测试场景：
 * 1. 基本功能：令牌消耗和拒绝
 * 2. Burst 突发能力：允许短时间内超过平均速率
 * 3. 惰性补充：按时间差自动补充令牌
 * 4. resetAfter / retryAfter 计算
 * 5. 多 Key 隔离
 * 6. 注册表集成
 */

import { TokenBucketRateLimiter } from '../rate-limiter/token-bucket';
import { perSec, perMin } from '../rate-limiter/base';
import { MemoryStore } from '../store/memory';
import { RateLimiterRegistry } from '../rate-limiter/base';
import { RateLimiterType } from '../constants';

describe('TokenBucketRateLimiter', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  // ============================================================
  // 基本功能
  // ============================================================

  describe('基本限流功能', () => {
    it('应有足够的初始令牌', () => {
      // perSec(10) → burst = 10，初始有 10 个令牌
      const limiter = new TokenBucketRateLimiter(perSec(10), store);
      const result = limiter.limit('key');
      expect(result.limited).toBe(false);
      expect(result.state.remaining).toBe(9);
    });

    it('令牌耗尽时应拒绝请求', () => {
      const limiter = new TokenBucketRateLimiter(perSec(3), store);

      // 消耗全部 3 个令牌
      limiter.limit('key'); // remaining: 2
      limiter.limit('key'); // remaining: 1
      limiter.limit('key'); // remaining: 0

      // 第 4 次应被拒绝
      const result = limiter.limit('key');
      expect(result.limited).toBe(true);
    });
  });

  // ============================================================
  // Burst 突发能力
  // ============================================================

  describe('Burst 突发能力', () => {
    it('按指定 burst 应允许突发', () => {
      // perSec(5, 10)：每秒填充 5 个，桶最大存 10 个
      const limiter = new TokenBucketRateLimiter(perSec(5, 10), store);

      // 初始应该有 10 个令牌（burst 容量）
      for (let i = 0; i < 10; i++) {
        const result = limiter.limit('key');
        expect(result.limited).toBe(false);
      }

      // 第 11 个被拒绝
      expect(limiter.limit('key').limited).toBe(true);
    });

    it('默认 burst 应等于 limit', () => {
      const limiter = new TokenBucketRateLimiter(perSec(5), store);
      // 默认 burst 为 5，所以初始有 5 个令牌
      for (let i = 0; i < 5; i++) {
        expect(limiter.limit('key').limited).toBe(false);
      }
      expect(limiter.limit('key').limited).toBe(true);
    });
  });

  // ============================================================
  // 惰性补充
  // ============================================================

  describe('惰性补充', () => {
    it('经过一段时间后应自动补充令牌', async () => {
      // perSec(10)：每秒填 10 个
      const limiter = new TokenBucketRateLimiter(perSec(10), store);

      // 消耗所有令牌
      for (let i = 0; i < 10; i++) limiter.limit('key');
      expect(limiter.limit('key').limited).toBe(true);

      // 等待 200ms，应补充约 2 个令牌
      await new Promise(r => setTimeout(r, 200));

      const result = limiter.limit('key');
      expect(result.limited).toBe(false); // 有补充的令牌
      expect(result.state.remaining).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================
  // resetAfter / retryAfter
  // ============================================================

  describe('resetAfter 和 retryAfter', () => {
    it('被限流时应返回正确的 retryAfter', () => {
      const limiter = new TokenBucketRateLimiter(perSec(10), store);
      for (let i = 0; i < 10; i++) limiter.limit('key');

      const result = limiter.limit('key');
      expect(result.limited).toBe(true);
      // retryAfter > 0：需要等待令牌补充到至少 1 个
      expect(result.state.retryAfter).toBeGreaterThan(0);
    });

    it('允许时 retryAfter 应为 0', () => {
      const limiter = new TokenBucketRateLimiter(perSec(10), store);
      const result = limiter.limit('key');
      expect(result.limited).toBe(false);
      expect(result.state.retryAfter).toBe(0);
    });
  });

  // ============================================================
  // peek 操作
  // ============================================================

  describe('peek 操作', () => {
    it('peek 不应修改桶状态', () => {
      const limiter = new TokenBucketRateLimiter(perSec(10), store);
      limiter.limit('key'); // remaining: 9
      const state = limiter.peek('key');
      expect(state.remaining).toBe(9);
    });
  });

  // ============================================================
  // 注册表集成
  // ============================================================

  describe('注册表集成', () => {
    it('应能通过注册表创建 TokenBucketRateLimiter', () => {
      const cls = RateLimiterRegistry.get(RateLimiterType.TOKEN_BUCKET);
      const instance = new cls(perMin(60), new MemoryStore());
      expect(instance).toBeInstanceOf(TokenBucketRateLimiter);
    });
  });
});

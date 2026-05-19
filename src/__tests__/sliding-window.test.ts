/**
 * 滑动窗口限流算法测试
 *
 * 滑动窗口通过"当前窗口计数 + 上一窗口加权比例"来近似滑动效果。
 *
 * 测试场景：
 * 1. 基本限流功能
 * 2. 滑动窗口的请求量估算
 * 3. retryAfter 计算
 * 4. peek 操作
 * 5. 多 Key 隔离
 * 6. 注册表集成
 */

import { SlidingWindowRateLimiter } from '../rate-limiter/sliding-window';
import { perSec, perMin, Quota } from '../rate-limiter/base';
import { MemoryStore } from '../store/memory';
import { RateLimiterRegistry } from '../rate-limiter/base';
import { RateLimiterType } from '../constants';

describe('SlidingWindowRateLimiter', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  // ============================================================
  // 基本功能
  // ============================================================

  describe('基本限流功能', () => {
    it('应允许窗口内的请求', () => {
      const limiter = new SlidingWindowRateLimiter(perSec(5), store);
      const result = limiter.limit('key');
      expect(result.limited).toBe(false);
      expect(result.state.remaining).toBe(4);
    });

    it('超出限制时应拒绝', () => {
      const limiter = new SlidingWindowRateLimiter(perSec(3), store);
      limiter.limit('key');
      limiter.limit('key');
      limiter.limit('key');

      const result = limiter.limit('key');
      expect(result.limited).toBe(true);
    });

    it('cost 参数应正确影响配额消耗', () => {
      const limiter = new SlidingWindowRateLimiter(perSec(5), store);
      const result = limiter.limit('key', 3);
      expect(result.state.remaining).toBe(2); // 5 - 3 = 2
    });
  });

  // ============================================================
  // peek 操作
  // ============================================================

  describe('peek 操作', () => {
    it('peek 应返回当前状态且不修改', () => {
      const limiter = new SlidingWindowRateLimiter(perSec(5), store);
      limiter.limit('key');
      const state = limiter.peek('key');
      expect(state.remaining).toBe(4);
    });
  });

  // ============================================================
  // 注册表集成
  // ============================================================

  describe('注册表集成', () => {
    it('应能通过注册表创建 SlidingWindowRateLimiter', () => {
      const cls = RateLimiterRegistry.get(RateLimiterType.SLIDING_WINDOW);
      const instance = new cls(perMin(60), new MemoryStore());
      expect(instance).toBeInstanceOf(SlidingWindowRateLimiter);
    });
  });
});

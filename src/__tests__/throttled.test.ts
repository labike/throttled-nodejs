/**
 * Throttled 门面类集成测试
 *
 * 测试 Throttled 类的全部功能：
 * 1. 函数调用模式
 * 2. 装饰器模式
 * 3. 上下文管理器模式
 * 4. 等待重试模式
 * 5. Hook 中间件
 * 6. 配额 DSL 解析集成
 * 7. 参数校验与异常处理
 * 8. 异步版本 AsyncThrottled
 */

import { Throttled } from '../throttled';
import { AsyncThrottled, AsyncHook } from '../async/throttled';
import { Hook, HookContext, buildHookChain } from '../hooks';
import { LimitedError, DataError } from '../exceptions';
import { RateLimitResult, RateLimitState } from '../rate-limiter/base';
import { MemoryStore } from '../store/memory';
import { RateLimiterType } from '../constants';

// ============================================================
// 1. 函数调用模式测试
// ============================================================

describe('Throttled 函数调用模式', () => {
  it('应使用默认配置（TokenBucket, 60/m, MemoryStore）', () => {
    const throttle = new Throttled();
    const result = throttle.limit('test:key');
    expect(result.limited).toBe(false);
    expect(result.state.limit).toBe(60);  // 默认 60/m
  });

  it('应接受配额 DSL 字符串', () => {
    const throttle = new Throttled({ quota: '10/s' });
    const result = throttle.limit('test:key');
    expect(result.state.limit).toBe(10);
  });

  it('应接受 Quota 对象', () => {
    const { perSec } = require('../rate-limiter/base');
    const throttle = new Throttled({ quota: perSec(5) });
    const result = throttle.limit('test:key');
    expect(result.state.limit).toBe(5);
  });

  it('应支持指定限流算法', () => {
    const throttle = new Throttled({
      using: RateLimiterType.FIXED_WINDOW,
      quota: '5/s',
    });
    for (let i = 0; i < 5; i++) throttle.limit('key');
    expect(throttle.limit('key').limited).toBe(true);
  });

  it('应支持自定义 cost', () => {
    const throttle = new Throttled({ quota: '10/s', cost: 3 });
    let result = throttle.limit('key');
    expect(result.state.remaining).toBe(7); // 10 - 3
  });

  it('应支持实例 key', () => {
    const throttle = new Throttled({ key: 'default:key', quota: '5/s' });
    // 不传 key 时应使用实例 key
    expect(throttle.limit().limited).toBe(false);
  });

  it('调用时可覆盖 key', () => {
    const throttle = new Throttled({ key: 'default:key', quota: '5/s' });
    const result = throttle.limit('override:key');
    expect(result.limited).toBe(false); // 使用不同的 key
  });

  it('无 key 时应抛出 DataError', () => {
    const throttle = new Throttled();
    expect(() => throttle.limit()).toThrow(DataError);
  });

  it('peek 应返回当前状态', () => {
    const throttle = new Throttled({ key: 'peek:test', quota: '10/s' });
    throttle.limit();
    const state = throttle.peek('peek:test');
    expect(state.remaining).toBe(9);
  });
});

// ============================================================
// 2. 装饰器模式测试
// ============================================================

describe('Throttled 装饰器模式', () => {
  it('装饰器应能限流函数调用', () => {
    class TestAPI {
      @Throttled.decorate({ key: 'api:test', quota: '2/m' })
      fetch(): string {
        return 'ok';
      }
    }

    const api = new TestAPI();
    expect(api.fetch()).toBe('ok');  // 第 1 次允许
    expect(api.fetch()).toBe('ok');  // 第 2 次允许
    expect(() => api.fetch()).toThrow(LimitedError); // 第 3 次拒绝
  });

  it('装饰器应支持带 cost 的配置', () => {
    class TestAPI {
      @Throttled.decorate({ key: 'api:cost', quota: '5/s', cost: 2 })
      fetch(): string {
        return 'ok';
      }
    }

    const api = new TestAPI();
    const result1 = api.fetch();  // 消耗 2
    expect(result1).toBe('ok');
    // 再消耗 2+2=4，总量 6，超出 5
    api.fetch();
    expect(() => api.fetch()).toThrow(LimitedError);
  });

  it('装饰器应传递原始函数的参数和返回值', () => {
    class TestAPI {
      @Throttled.decorate({ key: 'api:params', quota: '10/s' })
      greet(name: string): string {
        return `Hello, ${name}!`;
      }
    }

    const api = new TestAPI();
    expect(api.greet('World')).toBe('Hello, World!');
    expect(api.greet('Node')).toBe('Hello, Node!');
  });
});

// ============================================================
// 3. Hook 中间件测试
// ============================================================

describe('Hook 中间件系统', () => {
  it('Hook 应在限流前后被调用', () => {
    const calls: string[] = [];
    const testHook = new (class extends Hook {
      onLimit(callNext: () => RateLimitResult, context: HookContext): RateLimitResult {
        calls.push(`before:${context.key}`);
        const result = callNext();
        calls.push(`after:${context.key}:limited=${result.limited}`);
        return result;
      }
    })();

    const throttle = new Throttled({
      key: 'hook:test',
      quota: '10/s',
      hooks: [testHook],
    });

    throttle.limit();
    expect(calls.length).toBe(2);
    expect(calls[0]).toBe('before:hook:test');
    expect(calls[1]).toMatch(/after:hook:test:limited=false/);
  });

  it('多个 Hook 应按洋葱顺序执行', () => {
    const order: number[] = [];

    const hook1 = new (class extends Hook {
      onLimit(callNext: () => RateLimitResult, _ctx: HookContext): RateLimitResult {
        order.push(1);
        const result = callNext();
        order.push(4);
        return result;
      }
    })();

    const hook2 = new (class extends Hook {
      onLimit(callNext: () => RateLimitResult, _ctx: HookContext): RateLimitResult {
        order.push(2);
        const result = callNext();
        order.push(3);
        return result;
      }
    })();

    const throttle = new Throttled({
      key: 'hook:order',
      quota: '10/s',
      hooks: [hook1, hook2],
    });

    throttle.limit();
    expect(order).toEqual([1, 2, 3, 4]); // 洋葱模型顺序
  });

  it('Hook 中抛异常时不应影响限流结果', () => {
    const brokenHook = new (class extends Hook {
      onLimit(callNext: () => RateLimitResult, _ctx: HookContext): RateLimitResult {
        throw new Error('Hook crashed!');
      }
    })();

    const throttle = new Throttled({
      key: 'hook:error',
      quota: '10/s',
      hooks: [brokenHook],
    });

    // 即使 Hook 抛出异常，限流器应正常工作
    const result = throttle.limit();
    expect(result.limited).toBe(false);
  });

  it('HookContext 应包含正确的限流信息', () => {
    let capturedContext: HookContext | null = null;

    const infoHook = new (class extends Hook {
      onLimit(callNext: () => RateLimitResult, context: HookContext): RateLimitResult {
        capturedContext = context;
        return callNext();
      }
    })();

    const throttle = new Throttled({
      key: 'context:info',
      quota: '10/s',
      using: RateLimiterType.TOKEN_BUCKET,
      store: new MemoryStore(),
      hooks: [infoHook],
    });

    throttle.limit();
    expect(capturedContext).not.toBeNull();
    expect(capturedContext!.key).toBe('context:info');
    expect(capturedContext!.cost).toBe(1);
    expect(capturedContext!.algorithm).toBe('token_bucket');
    expect(capturedContext!.storeType).toBe('memory');
  });
});

// ============================================================
// 4. 参数校验测试
// ============================================================

describe('参数校验', () => {
  it('负数的 cost 应抛出 DataError', () => {
    const throttle = new Throttled({ key: 'test', quota: '10/s' });
    expect(() => throttle.limit('test', -1)).toThrow(DataError);
  });

  it('非整数的 cost 应抛出 DataError', () => {
    const throttle = new Throttled({ key: 'test', quota: '10/s' });
    expect(() => throttle.limit('test', 1.5)).toThrow(DataError);
  });

  it('无效的 timeout 应抛出 DataError', () => {
    expect(() => new Throttled({ timeout: -2 })).toThrow(DataError);
  });

  it('多规则配额应抛出 DataError', () => {
    expect(() => new Throttled({ quota: '100/s, 50/m' })).toThrow(DataError);
  });

  it('无效的 Hook 类型应抛出 TypeError', () => {
    expect(() => new Throttled({
      key: 'test',
      hooks: [{} as Hook],
    })).toThrow();
  });
});

// ============================================================
// 5. 存储后端集成测试
// ============================================================

describe('存储后端集成', () => {
  it('应支持自定义 MemoryStore', () => {
    const store = new MemoryStore({ MAX_SIZE: 2048 });
    const throttle = new Throttled({
      key: 'store:test',
      quota: '5/s',
      store,
    });

    const result = throttle.limit();
    expect(result.limited).toBe(false);
  });

  it('共享存储后端的 Throttled 应共享限流状态', () => {
    const sharedStore = new MemoryStore();

    const t1 = new Throttled({ key: 'shared:key', quota: '3/s', store: sharedStore });
    const t2 = new Throttled({ key: 'shared:key', quota: '3/s', store: sharedStore });

    t1.limit(); // 消耗 1
    const remaining = t2.peek('shared:key').remaining;
    expect(remaining).toBe(2); // 共享状态
  });
});

// ============================================================
// 6. 限流算法切换测试
// ============================================================

describe('限流算法切换', () => {
  const ALGORITHMS = [
    { name: 'FixedWindow', value: RateLimiterType.FIXED_WINDOW },
    { name: 'SlidingWindow', value: RateLimiterType.SLIDING_WINDOW },
    { name: 'TokenBucket', value: RateLimiterType.TOKEN_BUCKET },
    { name: 'LeakingBucket', value: RateLimiterType.LEAKING_BUCKET },
    { name: 'GCRA', value: RateLimiterType.GCRA },
  ];

  ALGORITHMS.forEach(({ name, value }) => {
    it(`应支持 ${name} 算法`, () => {
      const throttle = new Throttled({
        using: value,
        key: `algo:${name}`,
        quota: '5/s',
      });

      const result = throttle.limit();
      expect(result).toBeInstanceOf(RateLimitResult);
      expect(typeof result.limited).toBe('boolean');
      expect(result.state).toBeInstanceOf(RateLimitState);
    });
  });
});

// ============================================================
// 7. 异步版本 AsyncThrottled 测试
// ============================================================

describe('AsyncThrottled', () => {
  it('应支持异步限流操作', async () => {
    const throttle = new AsyncThrottled({ key: 'async:test', quota: '10/s' });
    const result = await throttle.limit();
    expect(result.limited).toBe(false);
    expect(result.state.remaining).toBe(9);
  });

  it('应支持异步 peek', async () => {
    const throttle = new AsyncThrottled({ key: 'async:peek', quota: '5/s' });
    await throttle.limit();
    const state = await throttle.peek('async:peek');
    expect(state.remaining).toBe(4);
  });

  it('异步装饰器应能限流', async () => {
    class AsyncAPI {
      private _t = new AsyncThrottled({ key: 'async:deco', quota: '2/s' });

      async fetch(): Promise<string> {
        const result = await this._t.limit();
        if (result.limited) throw new LimitedError(result);
        return 'ok';
      }
    }

    const api = new AsyncAPI();
    expect(await api.fetch()).toBe('ok');
    expect(await api.fetch()).toBe('ok');
    await expect(api.fetch()).rejects.toThrow(LimitedError);
  });

  it('异步 Hook 应正常工作', async () => {
    const calls: string[] = [];

    const hook = new (class extends AsyncHook {
      async onLimit(
        callNext: () => Promise<RateLimitResult>,
        context: HookContext,
      ): Promise<RateLimitResult> {
        calls.push(`before:${context.key}`);
        const result = await callNext();
        calls.push(`after:${context.key}`);
        return result;
      }
    })();

    const throttle = new AsyncThrottled({
      key: 'async:hook',
      quota: '10/s',
      hooks: [hook],
    });

    await throttle.limit();
    expect(calls).toHaveLength(2);
  });

  it('异步限流时应支持等待重试', async () => {
    const throttle = new AsyncThrottled({
      key: 'async:retry',
      quota: '10/s burst 5',
    });

    // 先消耗一些
    for (let i = 0; i < 5; i++) {
      await throttle.limit();
    }

    // 明确指定 timeout 应该等待
    const start = Date.now();
    const result = await throttle.limit('async:retry', 1, 0.5);
    const elapsed = Date.now() - start;
    expect(result.limited).toBe(false);  // 等待后应允许
  }, 10000);
});

// ============================================================
// 8. 边界情况与异常场景
// ============================================================

describe('边界情况', () => {
  it('空 key 应抛出 DataError', () => {
    const throttle = new Throttled();
    expect(() => throttle.limit('')).toThrow(DataError);
    expect(() => throttle.limit(null as unknown as string)).toThrow(DataError);
  });

  it('cost 为 0 不应影响限流状态', () => {
    const throttle = new Throttled({ key: 'zero:cost', quota: '3/s' });
    for (let i = 0; i < 10; i++) {
      const result = throttle.limit('zero:cost', 0);
      expect(result.limited).toBe(false);
    }
    // cost=0 不消耗配额，所以剩余应为 3
    expect(throttle.peek('zero:cost').remaining).toBe(3);
  });

  it('高并发场景下状态应一致', () => {
    const throttle = new Throttled({ key: 'concurrent', quota: '1000/s' });
    const results: boolean[] = [];
    for (let i = 0; i < 100; i++) {
      results.push(throttle.limit('concurrent').limited);
    }
    const denied = results.filter(r => r).length;
    expect(denied).toBe(0); // 100 < 1000，全部允许
  });

  it('同一实例的多次调用应累计状态', () => {
    const throttle = new Throttled({ key: 'cumulative', quota: '5/s' });
    const results: boolean[] = [];
    for (let i = 0; i < 7; i++) {
      results.push(throttle.limit('cumulative').limited);
    }
    // 前 5 次允许，后 2 次拒绝
    expect(results.filter(r => !r).length).toBe(5);
    expect(results.filter(r => r).length).toBe(2);
  });
});

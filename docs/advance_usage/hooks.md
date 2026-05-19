---
title: Hook 中间件
---

# Hook 中间件

Hook 系统基于中间件模式（Chain of Responsibility），用于观测、计时、异常处理等切面需求。

## 1) 基本用法

```typescript
import { Hook, HookContext, RateLimitResult, Throttled } from 'throttled-nodejs';

class LoggingHook extends Hook {
  onLimit(callNext: () => RateLimitResult, context: HookContext): RateLimitResult {
    console.log(`检查限流: ${context.key}`);
    const result = callNext();
    const status = result.limited ? 'denied' : 'allowed';
    console.log(`[${context.key}] ${status} - 剩余: ${result.state.remaining}`);
    return result;
  }
}

const throttle = new Throttled({
  key: '/api/users',
  quota: '10/s',
  hooks: [new LoggingHook()],
});

const result = throttle.limit();
console.log(`limited=${result.limited}`);
// 检查限流: /api/users
// [/api/users] allowed - 剩余: 9
// limited=false
```

### Async

```typescript
import { AsyncHook, HookContext, RateLimitResult, AsyncThrottled } from 'throttled-nodejs';

class LoggingHook extends AsyncHook {
  async onLimit(
    callNext: () => Promise<RateLimitResult>,
    context: HookContext,
  ): Promise<RateLimitResult> {
    console.log(`检查限流: ${context.key}`);
    const result = await callNext();
    const status = result.limited ? 'denied' : 'allowed';
    console.log(`[${context.key}] ${status} - 剩余: ${result.state.remaining}`);
    return result;
  }
}

const throttle = new AsyncThrottled({
  key: '/api/users',
  quota: '10/s',
  hooks: [new LoggingHook()],
});

async function main() {
  const result = await throttle.limit();
  console.log(`limited=${result.limited}`);
}

main();
```

## 2) 中间件模式

多个 Hook 按顺序执行，形成洋葱模型：

```
hooks = [A, B]
执行顺序: A.onLimit(before) → B.onLimit(before) → rateLimit → B.onLimit(after) → A.onLimit(after)
```

每个 Hook 可以：
1. 在限流检查**前**执行逻辑
2. 调用 `callNext()` 继续链
3. 在限流检查**后**执行逻辑
4. 检查或修改结果

## 3) HookContext

| 属性        | 类型      | 说明                        |
|-------------|-----------|-----------------------------|
| `key`       | `string`  | 限流标识（用户 ID、IP 等） |
| `cost`      | `number`  | 请求消耗                    |
| `algorithm` | `string`  | 算法名                      |
| `storeType` | `string`  | 存储后端类型                |

结果通过 `callNext()` 获取，不在 context 中。

## 4) 类型校验

同步 `Throttled` 只接受 `Hook` 实例，异步只接受 `AsyncHook` 实例。

```typescript
// ✅ 正确
new Throttled({ key: '/api', quota: '10/s', hooks: [new MySyncHook()] });
new AsyncThrottled({ key: '/api', quota: '10/s', hooks: [new MyAsyncHook()] });

// ❌ TypeError
new Throttled({ key: '/api', hooks: [new MyAsyncHook()] });
new Throttled({ key: '/api', hooks: ['not a hook'] });
```

## 5) 自定义 Hook

```typescript
import { Hook, HookContext, RateLimitResult, Throttled } from 'throttled-nodejs';

class TimingHook extends Hook {
  onLimit(callNext: () => RateLimitResult, context: HookContext): RateLimitResult {
    const start = process.hrtime.bigint();
    const result = callNext();
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`限流检查耗时 ${elapsed.toFixed(4)}ms`);
    return result;
  }
}

const throttle = new Throttled({
  key: '/api/users',
  quota: '10/s',
  hooks: [new TimingHook()],
});

console.log(`limited=${throttle.limit().limited}`);
```

### 最佳实践

1. **始终调用 `callNext()`** 并返回其结果
2. **异常处理** — 用 try/catch 包裹风险操作
3. **保持 Hook 轻量** — 慢操作使用异步 Hook 或队列
4. **多 Hook 分离关注点**:

```typescript
new Throttled({
  key: '/api',
  quota: '100/s',
  hooks: [new TimingHook(), new LoggingHook(), new MetricsHook()],
});
```

## 6) 内置 Hook

| Hook                                                    | 说明                     |
|---------------------------------------------------------|--------------------------|
| [OTelHook](../observability/opentelemetry)              | OpenTelemetry 指标（同步）|
| [AsyncOTelHook](../observability/opentelemetry)         | OpenTelemetry 指标（异步）|

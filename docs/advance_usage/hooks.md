# Hooks

The Hook system provides a middleware pattern for extending rate limiting behavior. Hooks can be used for observability, timing, exception handling, and custom logic.

## 1) Basic Usage

```typescript
import { Hook, HookContext, RateLimitResult, Throttled } from 'throttled-nodejs';

class LoggingHook extends Hook {
  onLimit(callNext: () => RateLimitResult, context: HookContext): RateLimitResult {
    console.log(`Checking rate limit for ${context.key}`);
    const result = callNext();
    const status = result.limited ? 'denied' : 'allowed';
    console.log(`[${context.key}] ${status} - remaining: ${result.state.remaining}`);
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
// Checking rate limit for /api/users
// [/api/users] allowed - remaining: 9
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
    console.log(`Checking rate limit for ${context.key}`);
    const result = await callNext();
    const status = result.limited ? 'denied' : 'allowed';
    console.log(`[${context.key}] ${status} - remaining: ${result.state.remaining}`);
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

## 2) Middleware Pattern

Hooks follow the Chain of Responsibility pattern. Multiple hooks are executed in order:

```
hooks = [A, B]
Execution: A.onLimit(before) → B.onLimit(before) → rateLimit → B.onLimit(after) → A.onLimit(after)
```

Each hook can:
1. Execute logic **before** the rate limit check
2. Call `callNext()` to continue the chain
3. Execute logic **after** the rate limit check
4. Inspect or modify the result

## 3) HookContext

| Property    | Type     | Description                     |
|-------------|----------|---------------------------------|
| `key`       | `string` | Rate limit key (user ID, IP, etc.) |
| `cost`      | `number` | Request cost                    |
| `algorithm` | `string` | Algorithm name                  |
| `storeType` | `string` | Storage backend type            |

The result is obtained by calling `callNext()`, not from the context.

## 4) Type Validation

Sync `Throttled` only accepts `Hook` instances; `AsyncThrottled` only accepts `AsyncHook` instances.

```typescript
// ✅ Correct
new Throttled({ key: '/api', quota: '10/s', hooks: [new MySyncHook()] });
new AsyncThrottled({ key: '/api', quota: '10/s', hooks: [new MyAsyncHook()] });

// ❌ TypeError
new Throttled({ key: '/api', hooks: [new MyAsyncHook()] });
new Throttled({ key: '/api', hooks: ['not a hook'] });
```

## 5) Creating Custom Hooks

```typescript
import { Hook, HookContext, RateLimitResult, Throttled } from 'throttled-nodejs';

class TimingHook extends Hook {
  onLimit(callNext: () => RateLimitResult, context: HookContext): RateLimitResult {
    const start = process.hrtime.bigint();
    const result = callNext();
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    console.log(`Rate limit check took ${elapsed.toFixed(4)}ms`);
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

### Best Practices

1. **Always call `callNext()`** and return its result
2. **Handle exceptions gracefully** — wrap risky operations in try/catch so your hook doesn't get skipped
3. **Keep hooks fast** — for slow operations, use a queue or async hooks
4. **Use multiple hooks** for different concerns:

```typescript
new Throttled({
  key: '/api',
  quota: '100/s',
  hooks: [
    new TimingHook(),
    new LoggingHook(),
    new MetricsHook(),
  ],
});
```

## 6) Built-in Hooks

| Hook                                                         | Description                                             |
|--------------------------------------------------------------|---------------------------------------------------------|
| [OTelHook](../observability/opentelemetry.md)                | OpenTelemetry metrics integration (sync)                |
| [AsyncOTelHook](../observability/opentelemetry.md)           | OpenTelemetry metrics integration (async)               |

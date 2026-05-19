# API Reference

## Main Interface

### `Throttled` (sync)

```typescript
import { Throttled } from 'throttled-nodejs';
```

**Constructor** `new Throttled(options?)`

| Option    | Type                          | Default              | Description                                         |
|-----------|-------------------------------|----------------------|-----------------------------------------------------|
| `key`     | `string \| null`              | `null`               | Rate limit key (user ID, IP, etc.)                  |
| `timeout` | `number \| null`              | `-1` (non-blocking)  | Max wait time in seconds when rate limited          |
| `using`   | `RateLimiterTypeT \| null`    | `TOKEN_BUCKET`       | Algorithm type                                      |
| `quota`   | `Quota \| string \| null`     | `60/m`               | Rate limit quota                                    |
| `store`   | `StoreP \| null`              | Global `MemoryStore` | Storage backend                                     |
| `cost`    | `number`                      | `1`                  | Cost per request                                    |
| `hooks`   | `Hook[] \| null`              | `[]`                 | Hook middleware chain                                |

**Methods**

- `limit(key?, cost?, timeout?)` → `RateLimitResult` — Execute rate limit check
- `peek(key)` → `RateLimitState` — Query current state without consuming
- `enter()` → `RateLimitResult` — Context manager enter (throws `LimitedError` if denied)
- `exit()` — Context manager exit

**Static Methods**

- `Throttled.decorate(options)` → `MethodDecorator` — Create a decorator

---

### `AsyncThrottled` (async)

```typescript
import { AsyncThrottled } from 'throttled-nodejs';
```

Same options as `Throttled`, but all methods return `Promise`:

- `limit(key?, cost?, timeout?)` → `Promise<RateLimitResult>`
- `peek(key)` → `Promise<RateLimitState>`
- `enter()` → `Promise<RateLimitResult>`

---

### `RateLimitResult`

| Property  | Type              | Description                              |
|-----------|-------------------|------------------------------------------|
| `limited` | `boolean`         | `true` if request was denied             |
| `state`   | `RateLimitState`  | Lazy-computed state snapshot             |

---

### `RateLimitState`

| Property      | Type     | Description                                         |
|---------------|----------|-----------------------------------------------------|
| `limit`       | `number` | Max requests allowed in initial state                |
| `remaining`   | `number` | Remaining requests in current state                  |
| `resetAfter`  | `number` | Seconds until limiter resets to initial state        |
| `retryAfter`  | `number` | Seconds to wait before retrying (`0` if allowed)     |

---

## Rate / Quota

```typescript
import { Rate, Quota, perSec, perMin, perHour, perDay, perWeek, perDuration } from 'throttled-nodejs';
```

### `Rate`

| Property | Type     | Description              |
|----------|----------|--------------------------|
| `period` | `number` | Time period in seconds   |
| `limit`  | `number` | Max requests per period  |

### `Quota`

| Property           | Type     | Description                   |
|--------------------|----------|-------------------------------|
| `rate`             | `Rate`   | Base rate                     |
| `burst`            | `number` | Burst capacity (default: 0)   |
| `periodSec`        | `number` | Period in seconds (floored)   |
| `emissionInterval` | `number` | Seconds between requests      |
| `fillRate`         | `number` | Tokens replenished per second |

### Factory Functions

| Function                      | Description                      |
|-------------------------------|----------------------------------|
| `perSec(limit, burst?)`       | Requests per second              |
| `perMin(limit, burst?)`       | Requests per minute              |
| `perHour(limit, burst?)`      | Requests per hour                |
| `perDay(limit, burst?)`       | Requests per day                 |
| `perWeek(limit, burst?)`      | Requests per week                |
| `perDuration(sec, limit, burst?)` | Custom duration in seconds   |

---

## RateLimiterType

```typescript
import { RateLimiterType } from 'throttled-nodejs';
```

| Constant            | Value               |
|---------------------|---------------------|
| `FIXED_WINDOW`      | `"fixed_window"`    |
| `SLIDING_WINDOW`    | `"sliding_window"`  |
| `TOKEN_BUCKET`      | `"token_bucket"`    |
| `LEAKING_BUCKET`    | `"leaking_bucket"`  |
| `GCRA`              | `"gcra"`            |

---

## Hooks

```typescript
import { Hook, HookContext, buildHookChain } from 'throttled-nodejs';
import { AsyncHook, buildAsyncHookChain } from 'throttled-nodejs';
```

### `Hook` (sync)

```typescript
abstract class Hook {
  abstract onLimit(
    callNext: () => RateLimitResult,
    context: HookContext,
  ): RateLimitResult;
}
```

### `AsyncHook` (async)

```typescript
abstract class AsyncHook {
  abstract onLimit(
    callNext: () => Promise<RateLimitResult>,
    context: HookContext,
  ): Promise<RateLimitResult>;
}
```

### `HookContext`

| Property    | Type     | Description                     |
|-------------|----------|---------------------------------|
| `key`       | `string` | Rate limit key                  |
| `cost`      | `number` | Request cost                    |
| `algorithm` | `string` | Algorithm name                  |
| `storeType` | `string` | Storage backend type            |

---

## Store

```typescript
import { MemoryStore, RedisStore, BaseStore } from 'throttled-nodejs';
```

### `MemoryStore`

Constructor: `new MemoryStore(options?)`

| Option     | Type     | Default | Description                |
|------------|----------|---------|----------------------------|
| `MAX_SIZE` | `number` | `1024`  | Max entries before LRU eviction |

### `RedisStore`

Constructor: `new RedisStore(server?, options?)`

| Parameter        | Type     | Default                         | Description        |
|------------------|----------|---------------------------------|--------------------|
| `server`         | `string` | `"redis://localhost:6379/0"`    | Redis URL          |
| `options`        | `object` | `{}`                            | Connection options |

Supported URL schemes:

- `redis://` — Standalone TCP
- `rediss://` — Standalone SSL
- `redis+sentinel://` — Sentinel
- `redis+cluster://` — Cluster

---

## Exceptions

```typescript
import { BaseThrottledError, SetUpError, DataError, StoreUnavailableError, LimitedError } from 'throttled-nodejs';
```

| Exception              | Description                        |
|------------------------|------------------------------------|
| `BaseThrottledError`   | Base class for all throttled errors |
| `SetUpError`           | Configuration/setup error          |
| `DataError`            | Invalid parameter error            |
| `StoreUnavailableError`| Storage backend unavailable        |
| `LimitedError`         | Rate limit exceeded (has `rateLimitResult` property) |

---

## Utils

```typescript
import { Timer, Benchmark, nowSec, nowMonoF, nowMs } from 'throttled-nodejs';
```

### `Timer`

| Method                           | Description                  |
|----------------------------------|------------------------------|
| `enter()`                        | Start timing                 |
| `exit()`                         | Stop timing, call callback   |
| `decorate(fn)`                   | Wrap a function with timing  |

### `Benchmark`

| Method                                          | Description                |
|-------------------------------------------------|----------------------------|
| `serial(task, batch, ...args)`                  | Serial execution           |
| `concurrent(task, batch, workers?, ...args)`     | Concurrent execution       |
| `asyncSerial(task, batch, ...args)`              | Async serial execution     |
| `asyncConcurrent(task, batch, workers?, ...args)`| Async concurrent execution |
| `stats()`                                       | Print benchmark stats      |
| `clear()`                                       | Reset all data             |

---

## Constants

```typescript
import { StoreType } from 'throttled-nodejs';
```

| Constant   | Value     |
|------------|-----------|
| `MEMORY`   | `"memory"`|
| `REDIS`    | `"redis"` |

---

## OpenTelemetry Hooks

```typescript
import { OTelHook } from 'throttled-nodejs';
import { AsyncOTelHook } from 'throttled-nodejs';
```

These hooks wrap rate limit checks and record metrics via `@opentelemetry/api`. See [OpenTelemetry](observability/opentelemetry.md).

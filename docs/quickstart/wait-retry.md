# Wait & Retry

By default, `Throttled` returns `RateLimitResult` immediately. To enable wait-and-retry, pass the `timeout` parameter. The limiter will wait based on `retryAfter` and retry automatically.

```typescript
import { Throttled, Timer } from 'throttled-nodejs';

// 1 burst request, 1 token per second
const throttle = new Throttled({ key: 'key', quota: '1/s burst 1' });

// Consume burst
console.log(throttle.limit().limited); // false

const timer = new Timer({
  clock: () => Date.now() / 1000,
  callback: (elapsed) => console.log(`elapsed: ${elapsed.toFixed(2)} seconds`),
});

timer.enter();
// Waits ~1s for next token
console.log(throttle.limit('key', 1, 1).limited); // false (after ~1s)
timer.exit();

timer.enter();
// timeout < retryAfter → returns immediately
console.log(throttle.limit('key', 1, 0.5).limited); // true (immediate)
timer.exit();
```

### Async

```typescript
import { AsyncThrottled } from 'throttled-nodejs';

const throttle = new AsyncThrottled({ key: 'key', quota: '1/s burst 1' });

async function main() {
  console.log((await throttle.limit()).limited); // false
  console.log((await throttle.limit('key', 1, 1)).limited); // false (~1s)
  console.log((await throttle.limit('key', 1, 0.5)).limited); // true (immediate)
}

main();
```

### With Decorator

```typescript
import { Throttled, RateLimiterType } from 'throttled-nodejs';

class API {
  @Throttled.decorate({
    key: 'ping',
    using: RateLimiterType.GCRA,
    quota: '2/s burst 2',
    timeout: 0.5,
  })
  ping(): string {
    return 'pong';
  }
}

const api = new API();
const start = Date.now();
for (let i = 0; i < 5; i++) {
  try {
    api.ping();
    console.log(`Request ${i + 1} at ${((Date.now() - start) / 1000).toFixed(2)}s`);
  } catch {
    // LimitedError after timeout
  }
}
// Burst: 0.00s, 0.00s → Refill: 0.50s, 1.00s, 1.50s
```

### Benchmark

```typescript
import { Throttled, Benchmark, RateLimiterType } from 'throttled-nodejs';

const throttle = new Throttled({
  using: RateLimiterType.GCRA,
  quota: '100/s burst 100',
  timeout: 1,
});

function callApi(): boolean {
  return throttle.limit('/ping', 1, 1).limited;
}

async function main() {
  const bench = new Benchmark();
  const results = await bench.concurrent(callApi, 1000, 4);
  const denied = results.filter(Boolean).length;
  console.log(`Denied: ${denied} requests`);
  // ✅ Total: 1000, 🕒 Latency: 35.8103 ms/op, 🚀 Throughput: 111 req/s (--)
}

main();
```

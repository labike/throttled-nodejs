# Benchmarks

Performance benchmarks for throttled-nodejs. Execution time for a single rate limit API call is equivalent to:

- **In-Memory**: ~2.5–4.5× a `Map.set()` operation
- **Redis**: ~1.06–1.37× an `INCR` command

You can run benchmarks using the built-in `Benchmark` utility:

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

const bench = new Benchmark();
const results = bench.serial(callApi, 1000);
bench.stats();
// ✅ Total: 1000, 🕒 Latency: 0.0358 ms/op, 🚀 Throughput: 27933 req/s (--)
```

### Concurrent

```typescript
async function concurrentBench() {
  const bench = new Benchmark();
  const results = await bench.concurrent(callApi, 1000, 4);
  bench.stats();
}
```

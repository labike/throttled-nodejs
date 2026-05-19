---
title: 基准测试
---

# 基准测试

throttled-nodejs 性能指标。单次限流 API 调用耗时相当于：

- **In-Memory**：约 2.5–4.5 倍 `Map.set()` 操作
- **Redis**：约 1.06–1.37 倍 `INCR` 命令

使用内置 `Benchmark` 工具运行测试：

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

## 并发测试

```typescript
async function concurrentBench() {
  const bench = new Benchmark();
  const results = await bench.concurrent(callApi, 1000, 4);
  bench.stats();
}
```

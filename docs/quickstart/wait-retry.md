---
title: 等待重试
---

# 等待重试

默认 `Throttled` 立即返回。设置 `timeout` 后启用等待重试，根据 `retryAfter` 自动等待并重试。

```typescript
import { Throttled, Timer } from 'throttled-nodejs';

// 1 个 burst 请求，每秒补充 1 个 token
const throttle = new Throttled({ key: 'key', quota: '1/s burst 1' });

// 消耗 burst
console.log(throttle.limit().limited); // false

const timer = new Timer({
  clock: () => Date.now() / 1000,
  callback: (elapsed) => console.log(`耗时: ${elapsed.toFixed(2)} 秒`),
});

timer.enter();
// 等待约 1s 获取下一个 token
console.log(throttle.limit('key', 1, 1).limited); // false（~1s 后）
timer.exit();

timer.enter();
// timeout < retryAfter → 立即返回
console.log(throttle.limit('key', 1, 0.5).limited); // true（立即）
timer.exit();
```

## Async

```typescript
import { AsyncThrottled } from 'throttled-nodejs';

const throttle = new AsyncThrottled({ key: 'key', quota: '1/s burst 1' });

async function main() {
  console.log((await throttle.limit()).limited); // false
  console.log((await throttle.limit('key', 1, 1)).limited); // false（~1s）
  console.log((await throttle.limit('key', 1, 0.5)).limited); // true（立即）
}

main();
```

## 装饰器 + 等待重试

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
    console.log(`请求 ${i + 1} 在第 ${((Date.now() - start) / 1000).toFixed(2)}s`);
  } catch {
    // timeout 后抛出 LimitedError
  }
}
// Burst: 0.00s, 0.00s → Refill: 0.50s, 1.00s, 1.50s
```

## 基准测试

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
  console.log(`被限流: ${denied} 次`);
}

main();
```

---
title: 函数调用
---

# 函数调用

使用 `Throttled.limit()` 检查请求是否被允许，返回 `RateLimitResult`，不会抛出异常。

```typescript
import { Throttled } from 'throttled-nodejs';

// 默认：In-Memory 存储，Token Bucket 算法，60 req/min
const throttle = new Throttled();

// 消耗 1 个 token
const result = throttle.limit('key');
console.log(result.limited); // false

// 获取状态快照
console.log(result.state);
// RateLimitState { limit: 60, remaining: 59, resetAfter: 1, retryAfter: 0 }

// peek 只查询不消耗
console.log(throttle.peek('key'));
// RateLimitState { limit: 60, remaining: 59, resetAfter: 1, retryAfter: 0 }

// 指定 cost
const denied = throttle.limit('key', 60);
console.log(denied.limited); // true
```

## Async

```typescript
import { AsyncThrottled } from 'throttled-nodejs';

const throttle = new AsyncThrottled();

async function main() {
  const result = await throttle.limit('key');
  console.log(result.limited); // false

  console.log(await throttle.peek('key'));

  const denied = await throttle.limit('key', 60);
  console.log(denied.limited); // true
}

main();
```

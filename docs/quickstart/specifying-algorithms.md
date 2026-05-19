---
title: 指定算法
---

# 指定算法

通过 `using` 参数选择算法。

```typescript
import { Throttled, RateLimiterType } from 'throttled-nodejs';

const throttle = new Throttled({
  using: RateLimiterType.FIXED_WINDOW,
  // using: RateLimiterType.SLIDING_WINDOW,
  // using: RateLimiterType.TOKEN_BUCKET,
  // using: RateLimiterType.LEAKING_BUCKET,
  // using: RateLimiterType.GCRA,
  quota: '1/m',
});

console.log(throttle.limit('key', 2).limited); // true
```

## 算法列表

| 算法          | `RateLimiterType`      | 说明                          |
|---------------|------------------------|------------------------------|
| Fixed Window  | `FIXED_WINDOW`         | 固定窗口计数器，窗口边界重置    |
| Sliding Window| `SLIDING_WINDOW`       | 基于滑动窗口日志               |
| Token Bucket  | `TOKEN_BUCKET`         | 恒定速率补充令牌               |
| Leaky Bucket  | `LEAKING_BUCKET`       | 恒定速率泄漏请求               |
| GCRA          | `GCRA`                 | 通用信元速率算法               |

## Async

```typescript
import { AsyncThrottled, RateLimiterType } from 'throttled-nodejs';

const throttle = new AsyncThrottled({
  using: RateLimiterType.FIXED_WINDOW,
  quota: '1/m',
});

async function main() {
  console.log((await throttle.limit('key', 2)).limited); // true
}

main();
```

---
title: 上下文管理器
---

# 上下文管理器

使用 `enter()` / `exit()` 对代码块进行限流。允许时返回 `RateLimitResult`，拒绝时抛出 `LimitedError`。

```typescript
import { Throttled, LimitedError } from 'throttled-nodejs';

const throttle = new Throttled({ key: '/api/v1/users/', quota: '1/m' });

// 允许
const result = throttle.enter();
console.log(result.limited); // false
console.log(result.state);
// RateLimitState { limit: 1, remaining: 0, resetAfter: 60, retryAfter: 0 }
throttle.exit();

try {
  throttle.enter(); // 抛出 LimitedError
  throttle.exit();
} catch (e) {
  if (e instanceof LimitedError) {
    console.log(e.message);
    // Rate limit exceeded: remaining=0, reset_after=60, retry_after=60
  }
}
```

## Async

```typescript
import { AsyncThrottled, LimitedError } from 'throttled-nodejs';

const throttle = new AsyncThrottled({ key: '/api/v1/users/', quota: '1/m' });

async function main() {
  const result = await throttle.enter();
  console.log(result.limited); // false
  throttle.exit();

  try {
    await throttle.enter();
    throttle.exit();
  } catch (e) {
    if (e instanceof LimitedError) {
      console.log(e.message);
    }
  }
}

main();
```

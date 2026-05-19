---
title: 装饰器
---

# 装饰器

使用 `Throttled.decorate()` 对类方法进行限流。被限流时抛出 `LimitedError`。

```typescript
import { Throttled, LimitedError } from 'throttled-nodejs';

const quota = '2/m';

class API {
  @Throttled.decorate({ key: '/ping', quota })
  ping(): string {
    return 'pong';
  }

  // 每次调用消耗 2 个 token
  @Throttled.decorate({ key: '/ping', quota, cost: 2 })
  heavyPing(): string {
    return 'heavy_pong';
  }
}

const api = new API();
console.log(api.ping()); // pong

try {
  api.heavyPing(); // 消耗 2 tokens，超出 2/min 限制
} catch (e) {
  if (e instanceof LimitedError) {
    console.log(e.message);
    // Rate limit exceeded: remaining=1, reset_after=30, retry_after=60
  }
}
```

## Async

```typescript
import { AsyncThrottled, LimitedError } from 'throttled-nodejs';

const quota = '2/m';

class API {
  @AsyncThrottled.decorate({ key: '/ping', quota })
  async ping(): Promise<string> {
    return 'pong';
  }

  @AsyncThrottled.decorate({ key: '/ping', quota, cost: 2 })
  async heavyPing(): Promise<string> {
    return 'heavy_pong';
  }
}

const api = new API();

async function main() {
  console.log(await api.ping()); // pong

  try {
    await api.heavyPing();
  } catch (e) {
    if (e instanceof LimitedError) {
      console.log(e.message);
    }
  }
}

main();
```

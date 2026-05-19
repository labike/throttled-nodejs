# Decorator

Use `Throttled.decorate()` to apply rate limiting to class methods. If denied, it throws `LimitedError`.

```typescript
import { Throttled, LimitedError } from 'throttled-nodejs';

const quota = '2/m';

class API {
  @Throttled.decorate({ key: '/ping', quota })
  ping(): string {
    return 'pong';
  }

  // Cost of 2 per call
  @Throttled.decorate({ key: '/ping', quota, cost: 2 })
  heavyPing(): string {
    return 'heavy_pong';
  }
}

const api = new API();
console.log(api.ping()); // pong

try {
  // Consumes 2 tokens, exceeds the 2/min limit
  api.heavyPing();
} catch (e) {
  if (e instanceof LimitedError) {
    console.log(e.message);
    // Rate limit exceeded: remaining=1, reset_after=30, retry_after=60
  }
}
```

### Async

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

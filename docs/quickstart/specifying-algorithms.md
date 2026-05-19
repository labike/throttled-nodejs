# Specifying Algorithms

Use the `using` parameter to choose an algorithm.

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

### Algorithms

| Algorithm     | `RateLimiterType`      | Description                              |
|---------------|------------------------|------------------------------------------|
| Fixed Window  | `FIXED_WINDOW`         | Simple counter, resets at window boundary |
| Sliding Window| `SLIDING_WINDOW`       | Log-based sliding window                 |
| Token Bucket  | `TOKEN_BUCKET`         | Tokens refilled at constant rate          |
| Leaky Bucket  | `LEAKING_BUCKET`       | Requests leak at constant rate            |
| GCRA          | `GCRA`                 | Generic Cell Rate Algorithm               |

### Async

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

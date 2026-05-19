# Function Call

Using `Throttled.limit()` to check if a request is allowed is straightforward — it returns a `RateLimitResult` without throwing.

```typescript
import { Throttled } from 'throttled-nodejs';

// Default: In-Memory storage, Token Bucket, 60 req/min
const throttle = new Throttled();

// Consume 1 token
const result = throttle.limit('key');
console.log(result.limited); // false

// Get state snapshot
console.log(result.state);
// RateLimitState { limit: 60, remaining: 59, resetAfter: 1, retryAfter: 0 }

// Peek without consuming
console.log(throttle.peek('key'));
// RateLimitState { limit: 60, remaining: 59, resetAfter: 1, retryAfter: 0 }

// Specify cost
const denied = throttle.limit('key', 60);
console.log(denied.limited); // true
```

### Async

```typescript
import { AsyncThrottled } from 'throttled-nodejs';

const throttle = new AsyncThrottled();

async function main() {
  const result = await throttle.limit('key');
  console.log(result.limited); // false

  console.log(await throttle.peek('key'));
  // RateLimitState { limit: 60, remaining: 59, resetAfter: 1, retryAfter: 0 }

  const denied = await throttle.limit('key', 60);
  console.log(denied.limited); // true
}

main();
```

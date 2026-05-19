# Context Manager

Use `enter()` / `exit()` to rate-limit a code block. `enter()` returns the `RateLimitResult` if allowed, or throws `LimitedError` if denied.

```typescript
import { Throttled, LimitedError } from 'throttled-nodejs';

const throttle = new Throttled({ key: '/api/v1/users/', quota: '1/m' });

// Allowed
const result = throttle.enter();
console.log(result.limited); // false
console.log(result.state);
// RateLimitState { limit: 1, remaining: 0, resetAfter: 60, retryAfter: 0 }
throttle.exit();

try {
  throttle.enter(); // throws LimitedError
  throttle.exit();
} catch (e) {
  if (e instanceof LimitedError) {
    console.log(e.message);
    // Rate limit exceeded: remaining=0, reset_after=60, retry_after=60
  }
}
```

### Async

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

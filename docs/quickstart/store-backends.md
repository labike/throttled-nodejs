# Store Backends

## 1) In-Memory

`MemoryStore` is an LRU cache with TTL. It is the default backend — you don't usually need to create it manually.

```typescript
import { Throttled } from 'throttled-nodejs';

// Uses global MemoryStore (max 1024 entries)
const throttle = new Throttled({ key: '/api/products', quota: '1/m' });
console.log(throttle.limit().limited); // false
```

Share the same `MemoryStore` instance to limit the same key across multiple throttles:

```typescript
import { Throttled, MemoryStore } from 'throttled-nodejs';

const store = new MemoryStore();

const ping = new Throttled({ key: 'ping-pong', quota: '1/m', store });
const pong = new Throttled({ key: 'ping-pong', quota: '1/m', store });

console.log(ping.limit().limited); // false
console.log(pong.limit().limited); // true
```

### Async

```typescript
import { AsyncThrottled, MemoryStore } from 'throttled-nodejs';

const store = new MemoryStore();
const throttle = new AsyncThrottled({ key: '/api/products', quota: '1/m', store });

async function main() {
  console.log((await throttle.limit()).limited); // false
}

main();
```

## 2) Redis

`RedisStore` is based on `ioredis` for distributed rate limiting.

```typescript
import { Throttled, RedisStore, RateLimiterType } from 'throttled-nodejs';

const store = new RedisStore('redis://127.0.0.1:6379/0');

@Throttled.decorate({
  key: '/api/products',
  using: RateLimiterType.TOKEN_BUCKET,
  quota: '1/m',
  store,
})
function products(): string[] {
  return ['iPhone', 'MacBook'];
}
```

### Standalone

Supported URL formats: `redis://`, `rediss://` (SSL), `unix://`.

```typescript
const store = new RedisStore('redis://localhost:6379/0');
```

### Sentinel

```typescript
const store = new RedisStore(
  'redis+sentinel://:password@host1:26379,host2:26379/mymaster',
);
```

### Cluster

```typescript
const store = new RedisStore(
  'redis+cluster://:password@host1:6379,host2:6379',
);
```

---
title: 存储后端
---

# 存储后端

## 1) In-Memory

`MemoryStore` 是具有 TTL 的 LRU 缓存，**默认使用**，通常无需手动创建。

```typescript
import { Throttled } from 'throttled-nodejs';

// 使用全局 MemoryStore（最大 1024 条）
const throttle = new Throttled({ key: '/api/products', quota: '1/m' });
console.log(throttle.limit().limited); // false
```

共享同一个 `MemoryStore` 实例以在多个限流器间共享状态：

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

基于 `ioredis` 的分布式限流存储。

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

### 单机模式

支持的 URL 格式：`redis://`、`rediss://`（SSL）。

```typescript
const store = new RedisStore('redis://localhost:6379/0');
```

### 哨兵模式

```typescript
const store = new RedisStore(
  'redis+sentinel://:password@host1:26379,host2:26379/mymaster',
);
```

### 集群模式

```typescript
const store = new RedisStore(
  'redis+cluster://:password@host1:6379,host2:6379',
);
```

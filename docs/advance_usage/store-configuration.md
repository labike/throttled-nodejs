# Store Configuration

## 1) RedisStore

`RedisStore` is developed based on `ioredis`. It supports standalone, sentinel, and cluster modes.

```typescript
import { RedisStore } from 'throttled-nodejs';

const store = new RedisStore('redis://127.0.0.1:6379/0', {});
```

### Arguments

| Parameter | Type     | Default                       | Description                                   |
|-----------|----------|-------------------------------|-----------------------------------------------|
| `server`  | `string` | `"redis://localhost:6379/0"`  | Redis connection URL                          |
| `options` | `object` | `{}`                          | Connection options (see below)                |

### Options

| Option                  | Type     | Description                                                     |
|-------------------------|----------|-----------------------------------------------------------------|
| `SOCKET_TIMEOUT`        | `number` | Socket timeout in milliseconds                                  |
| `password`              | `string` | Redis password                                                  |
| `username`              | `string` | Redis ACL username                                              |
| `sentinels`             | `Array`  | Sentinel nodes (auto-parsed from `redis+sentinel://` URL)       |
| `clusterNodes`          | `Array`  | Cluster nodes (auto-parsed from `redis+cluster://` URL)         |

## 2) MemoryStore

`MemoryStore` is an LRU cache with TTL.

```typescript
import { MemoryStore } from 'throttled-nodejs';

const store = new MemoryStore({ MAX_SIZE: 10240 });
```

### Options

| Option     | Type     | Default | Description                                                   |
|------------|----------|---------|---------------------------------------------------------------|
| `MAX_SIZE` | `number` | `1024`  | Maximum entries before LRU eviction                           |

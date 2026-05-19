---
title: 存储配置
---

# 存储配置

## 1) RedisStore

基于 `ioredis`，支持单机、哨兵、集群三种模式。

```typescript
import { RedisStore } from 'throttled-nodejs';

const store = new RedisStore('redis://127.0.0.1:6379/0', {});
```

### 参数

| 参数      | 类型      | 默认值                          | 说明              |
|-----------|-----------|--------------------------------|-------------------|
| `server`  | `string`  | `"redis://localhost:6379/0"`   | Redis 连接 URL    |
| `options` | `object`  | `{}`                           | 连接选项          |

### 选项

| 选项                 | 类型      | 说明                              |
|----------------------|-----------|-----------------------------------|
| `SOCKET_TIMEOUT`     | `number`  | Socket 超时（毫秒）              |
| `password`           | `string`  | Redis 密码                       |
| `username`           | `string`  | Redis ACL 用户名                 |
| `sentinels`          | `Array`   | 哨兵节点（自动从 URL 解析）      |
| `clusterNodes`       | `Array`   | 集群节点（自动从 URL 解析）      |

## 2) MemoryStore

具有 TTL 的 LRU 缓存。

```typescript
import { MemoryStore } from 'throttled-nodejs';

const store = new MemoryStore({ MAX_SIZE: 10240 });
```

### 选项

| 选项        | 类型      | 默认值  | 说明                        |
|-------------|-----------|---------|-----------------------------|
| `MAX_SIZE`  | `number`  | `1024`  | 最大条目数，超出后 LRU 淘汰 |

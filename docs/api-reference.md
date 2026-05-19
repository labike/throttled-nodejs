---
title: API 参考
---

# API 参考

## 主接口

### `Throttled`（同步）

```typescript
import { Throttled } from 'throttled-nodejs';
```

**构造函数** `new Throttled(options?)`

| 参数      | 类型                           | 默认值              | 说明                        |
|-----------|--------------------------------|---------------------|-----------------------------|
| `key`     | `string \| null`               | `null`              | 限流标识                    |
| `timeout` | `number \| null`               | `-1`（非阻塞）      | 最大等待时间（秒）          |
| `using`   | `RateLimiterTypeT \| null`     | `TOKEN_BUCKET`      | 算法类型                    |
| `quota`   | `Quota \| string \| null`      | `60/m`              | 配额                        |
| `store`   | `StoreP \| null`               | 全局 `MemoryStore`  | 存储后端                    |
| `cost`    | `number`                       | `1`                 | 每次请求消耗                |
| `hooks`   | `Hook[] \| null`               | `[]`                | Hook 中间件链               |

**方法**

- `limit(key?, cost?, timeout?)` → `RateLimitResult` — 执行限流检查
- `peek(key)` → `RateLimitState` — 查询状态（不消耗）
- `enter()` → `RateLimitResult` — 上下文管理器（拒绝时抛 `LimitedError`）
- `exit()` — 退出上下文

**静态方法**

- `Throttled.decorate(options)` → `MethodDecorator` — 创建装饰器

---

### `AsyncThrottled`（异步）

```typescript
import { AsyncThrottled } from 'throttled-nodejs';
```

参数与 `Throttled` 相同，所有方法返回 `Promise`：

- `limit(key?, cost?, timeout?)` → `Promise<RateLimitResult>`
- `peek(key)` → `Promise<RateLimitState>`
- `enter()` → `Promise<RateLimitResult>`

---

### `RateLimitResult`

| 属性      | 类型              | 说明                        |
|-----------|-------------------|-----------------------------|
| `limited` | `boolean`         | `true` 表示请求被拒绝       |
| `state`   | `RateLimitState`  | 惰性计算的状态快照          |

---

### `RateLimitState`

| 属性          | 类型      | 说明                              |
|---------------|-----------|-----------------------------------|
| `limit`       | `number`  | 初始状态最大请求数                |
| `remaining`   | `number`  | 当前剩余请求数                    |
| `resetAfter`  | `number`  | 距重置到初始状态的秒数            |
| `retryAfter`  | `number`  | 建议重试等待秒数（`0` = 已允许）  |

---

## Rate / Quota

```typescript
import { Rate, Quota, perSec, perMin, perHour, perDay, perWeek, perDuration } from 'throttled-nodejs';
```

### `Rate`

| 属性     | 类型      | 说明              |
|----------|-----------|------------------|
| `period` | `number`  | 时间周期（秒）    |
| `limit`  | `number`  | 周期内最大请求数  |

### `Quota`

| 属性               | 类型      | 说明                     |
|--------------------|-----------|--------------------------|
| `rate`             | `Rate`    | 基础速率                 |
| `burst`            | `number`  | 突发容量                 |
| `periodSec`        | `number`  | 周期秒数（向下取整）     |
| `emissionInterval` | `number`  | 请求间隔（秒）           |
| `fillRate`         | `number`  | 每秒补充速率             |

### 工厂函数

| 函数                           | 说明              |
|-------------------------------|-------------------|
| `perSec(limit, burst?)`       | 每秒请求数        |
| `perMin(limit, burst?)`       | 每分钟请求数      |
| `perHour(limit, burst?)`      | 每小时请求数      |
| `perDay(limit, burst?)`       | 每天请求数        |
| `perWeek(limit, burst?)`      | 每周请求数        |
| `perDuration(sec, limit, burst?)` | 自定义周期（秒）|

---

## RateLimiterType

```typescript
import { RateLimiterType } from 'throttled-nodejs';
```

| 常量              | 值                  |
|-------------------|---------------------|
| `FIXED_WINDOW`    | `"fixed_window"`    |
| `SLIDING_WINDOW`  | `"sliding_window"`  |
| `TOKEN_BUCKET`    | `"token_bucket"`    |
| `LEAKING_BUCKET`  | `"leaking_bucket"`  |
| `GCRA`            | `"gcra"`            |

---

## Hooks

```typescript
import { Hook, HookContext, buildHookChain } from 'throttled-nodejs';
import { AsyncHook } from 'throttled-nodejs';
```

### `Hook`（同步）

```typescript
abstract class Hook {
  abstract onLimit(
    callNext: () => RateLimitResult,
    context: HookContext,
  ): RateLimitResult;
}
```

### `AsyncHook`（异步）

```typescript
abstract class AsyncHook {
  abstract onLimit(
    callNext: () => Promise<RateLimitResult>,
    context: HookContext,
  ): Promise<RateLimitResult>;
}
```

### `HookContext`

| 属性        | 类型      | 说明              |
|-------------|-----------|-------------------|
| `key`       | `string`  | 限流标识          |
| `cost`      | `number`  | 请求消耗          |
| `algorithm` | `string`  | 算法名            |
| `storeType` | `string`  | 存储后端类型      |

---

## Store

```typescript
import { MemoryStore, RedisStore } from 'throttled-nodejs';
```

### MemoryStore

构造函数：`new MemoryStore(options?)`

| 参数       | 类型      | 默认值  | 说明                        |
|------------|-----------|---------|-----------------------------|
| `MAX_SIZE` | `number`  | `1024`  | 最大条目数，超出后 LRU 淘汰 |

### RedisStore

构造函数：`new RedisStore(server?, options?)`

| 参数      | 类型      | 默认值                          | 说明              |
|-----------|-----------|--------------------------------|-------------------|
| `server`  | `string`  | `"redis://localhost:6379/0"`   | Redis 连接 URL    |
| `options` | `object`  | `{}`                           | 连接选项          |

支持 URL scheme：`redis://`、`rediss://`、`redis+sentinel://`、`redis+cluster://`

---

## 异常

```typescript
import { BaseThrottledError, SetUpError, DataError, StoreUnavailableError, LimitedError } from 'throttled-nodejs';
```

| 异常                    | 说明                        |
|-------------------------|-----------------------------|
| `BaseThrottledError`    | 所有限流异常的基类          |
| `SetUpError`            | 配置/初始化错误             |
| `DataError`             | 参数无效错误                |
| `StoreUnavailableError` | 存储后端不可用              |
| `LimitedError`          | 超出限流（含 `rateLimitResult` 属性）|

---

## 工具类

```typescript
import { Timer, Benchmark, nowSec, nowMonoF, nowMs } from 'throttled-nodejs';
```

### Timer

| 方法               | 说明          |
|--------------------|--------------|
| `enter()`          | 开始计时      |
| `exit()`           | 停止计时      |
| `decorate(fn)`     | 包装函数计时  |

### Benchmark

| 方法                                               | 说明          |
|----------------------------------------------------|--------------|
| `serial(task, batch, ...args)`                     | 串行执行      |
| `concurrent(task, batch, workers?, ...args)`       | 并发执行      |
| `asyncSerial(task, batch, ...args)`                | 异步串行      |
| `asyncConcurrent(task, batch, workers?, ...args)`  | 异步并发      |
| `stats()`                                          | 打印统计      |
| `clear()`                                          | 重置数据      |

---

## 常量

```typescript
import { StoreType } from 'throttled-nodejs';
```

| 常量     | 值          |
|----------|-------------|
| `MEMORY` | `"memory"`  |
| `REDIS`  | `"redis"`   |

---

## OpenTelemetry Hooks

```typescript
import { OTelHook, AsyncOTelHook } from 'throttled-nodejs';
```

详情见 [OpenTelemetry 文档](/observability/opentelemetry)。

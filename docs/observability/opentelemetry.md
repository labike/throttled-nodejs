---
title: OpenTelemetry
---

# OpenTelemetry

`OTelHook` / `AsyncOTelHook` 提供基于 OpenTelemetry Meter 的限流指标监控。

## 安装

```bash
npm install @opentelemetry/api
```

throttled-nodejs 仅依赖 `@opentelemetry/api`（接口层），如何采集和导出由你的应用决定。

## 快速开始

### Sync

```typescript
import { metrics } from '@opentelemetry/api';
import { Throttled, OTelHook } from 'throttled-nodejs';

const meter = metrics.getMeter('throttled-example');
const throttle = new Throttled({
  key: '/api/ping',
  quota: '5/m',
  hooks: [new OTelHook(meter)],
});

for (let i = 0; i < 5; i++) {
  const result = throttle.limit('/api/ping');
  console.log(`请求 ${i + 1}: ${result.limited ? 'denied' : 'allowed'}`);
}

// 第 6 次被限流
const result = throttle.limit('/api/ping');
console.log(`请求 6: ${result.limited ? 'denied' : 'allowed'}`);
```

### Async

```typescript
import { metrics } from '@opentelemetry/api';
import { AsyncThrottled, AsyncOTelHook } from 'throttled-nodejs';

const meter = metrics.getMeter('throttled-example');
const throttle = new AsyncThrottled({
  key: '/api/ping',
  quota: '5/m',
  hooks: [new AsyncOTelHook(meter)],
});

async function main() {
  for (let i = 0; i < 5; i++) {
    const result = await throttle.limit('/api/ping');
    console.log(`请求 ${i + 1}: ${result.limited ? 'denied' : 'allowed'}`);
  }

  const result = await throttle.limit('/api/ping');
  console.log(`请求 6: ${result.limited ? 'denied' : 'allowed'}`);
}

main();
```

## 指标

| 指标                | 类型      | 说明                              |
|---------------------|-----------|-----------------------------------|
| `throttled.requests`| Counter   | 限流检查次数（带 result 维度）    |
| `throttled.duration`| Histogram | 限流检查耗时（秒）                |

### 属性

| 属性         | 说明                                   |
|--------------|----------------------------------------|
| `key`        | 限流标识（如 `/api/users`）            |
| `algorithm`  | 算法（如 `token_bucket`）              |
| `store_type` | 存储后端（如 `memory`、`redis`）       |
| `result`     | `"allowed"` 或 `"denied"`              |

## 配置

```typescript
import { metrics } from '@opentelemetry/api';
import { OTelHook, AsyncOTelHook } from 'throttled-nodejs';

const meter = metrics.getMeter('my-service', '1.0.0');
const syncHook = new OTelHook(meter);
const asyncHook = new AsyncOTelHook(meter);
```

## 架构

throttled-nodejs 仅依赖 `@opentelemetry/api`（接口层）：

```
┌───────────────────────────────────────────┐
│          throttled-nodejs                  │
│  依赖: @opentelemetry/api                 │
│  输出: counter.add(), histogram.record()   │
└─────────────────────┬─────────────────────┘
                      │
                      v
┌───────────────────────────────────────────┐
│          你的应用                           │
│  你决定如何采集和导出:                      │
│  - Console, OTLP, Prometheus, 等          │
└───────────────────────────────────────────┘
```

## 导出示例

### Console

```typescript
import { metrics } from '@opentelemetry/api';
import {
  MeterProvider, PeriodicExportingMetricReader, ConsoleMetricExporter,
} from '@opentelemetry/sdk-metrics';

const reader = new PeriodicExportingMetricReader({ exporter: new ConsoleMetricExporter() });
metrics.setMeterProvider(new MeterProvider({ metricReaders: [reader] }));

const meter = metrics.getMeter('my-app');
```

### OTLP

```typescript
import { metrics } from '@opentelemetry/api';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-otlp-proto-grpc';

const reader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({ endpoint: 'http://collector:4317' }),
});
metrics.setMeterProvider(new MeterProvider({ metricReaders: [reader] }));
```

### Prometheus

```typescript
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

metrics.setMeterProvider(
  new MeterProvider({ metricReaders: [new PrometheusExporter({ port: 9464 })] }),
);
// 指标位于 http://localhost:9464/metrics
```

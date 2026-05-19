# OpenTelemetry

`OTelHook` / `AsyncOTelHook` provide OpenTelemetry metrics integration for monitoring rate limiting events.

## Installation

```bash
npm install @opentelemetry/api
```

throttled-nodejs depends only on `@opentelemetry/api` (interface only). How you collect and export metrics is up to your application.

## Quick Start

### Sync

```typescript
import { metrics } from '@opentelemetry/api';
import { Throttled } from 'throttled-nodejs';
import { OTelHook } from 'throttled-nodejs';

const meter = metrics.getMeter('throttled-example');
const throttle = new Throttled({
  key: '/api/ping',
  quota: '5/m',
  hooks: [new OTelHook(meter)],
});

for (let i = 0; i < 5; i++) {
  const result = throttle.limit('/api/ping');
  console.log(`Request ${i + 1}: ${result.limited ? 'denied' : 'allowed'}`);
}

// 6th is denied
const result = throttle.limit('/api/ping');
console.log(`Request 6: ${result.limited ? 'denied' : 'allowed'}`);

// 📊 OTelHook records:
//   throttled.requests (Counter) — number of rate limit checks
//   throttled.duration (Histogram) — latency in seconds
// Attributes: key, algorithm, store_type, result ("allowed" / "denied")
```

### Async

```typescript
import { metrics } from '@opentelemetry/api';
import { AsyncThrottled } from 'throttled-nodejs';
import { AsyncOTelHook } from 'throttled-nodejs';

const meter = metrics.getMeter('throttled-example');
const throttle = new AsyncThrottled({
  key: '/api/ping',
  quota: '5/m',
  hooks: [new AsyncOTelHook(meter)],
});

async function main() {
  for (let i = 0; i < 5; i++) {
    const result = await throttle.limit('/api/ping');
    console.log(`Request ${i + 1}: ${result.limited ? 'denied' : 'allowed'}`);
  }

  const result = await throttle.limit('/api/ping');
  console.log(`Request 6: ${result.limited ? 'denied' : 'allowed'}`);
}

main();
```

## Metrics

| Metric              | Type      | Description                                         |
|---------------------|-----------|-----------------------------------------------------|
| `throttled.requests`| Counter   | Number of rate limit checks (with `result` dimension) |
| `throttled.duration`| Histogram | Duration of rate limit checks in seconds            |

### Attributes

| Attribute    | Description                                  |
|--------------|----------------------------------------------|
| `key`        | Rate limit key (e.g., `/api/users`)          |
| `algorithm`  | Algorithm used (e.g., `token_bucket`)        |
| `store_type` | Storage backend (e.g., `memory`, `redis`)    |
| `result`     | `"allowed"` or `"denied`                    |

## Configuration

Both hooks require a `Meter` instance:

```typescript
import { metrics } from '@opentelemetry/api';
import { OTelHook } from 'throttled-nodejs';
import { AsyncOTelHook } from 'throttled-nodejs';

const meter = metrics.getMeter('my-service', '1.0.0');
const syncHook = new OTelHook(meter);
const asyncHook = new AsyncOTelHook(meter);
```

## Architecture

throttled-nodejs depends only on `@opentelemetry/api` (interface only):

```
┌───────────────────────────────────────────┐
│          throttled-nodejs                  │
│  Dependency: @opentelemetry/api           │
│  Output: counter.add(), histogram.record()│
└─────────────────────┬─────────────────────┘
                      │
                      v
┌───────────────────────────────────────────┐
│          Your Application                  │
│  You decide how to collect and export:    │
│  - Console, OTLP, Prometheus, etc.        │
└───────────────────────────────────────────┘
```

## Exporter Examples

### Console

```typescript
import { metrics } from '@opentelemetry/api';
import { MeterProvider, PeriodicExportingMetricReader, ConsoleMetricExporter } from '@opentelemetry/sdk-metrics';

const reader = new PeriodicExportingMetricReader({
  exporter: new ConsoleMetricExporter(),
});
const provider = new MeterProvider({ metricReaders: [reader] });
metrics.setMeterProvider(provider);

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
const provider = new MeterProvider({ metricReaders: [reader] });
metrics.setMeterProvider(provider);
```

### Prometheus

```typescript
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

const exporter = new PrometheusExporter({ port: 9464 });
const provider = new MeterProvider({ metricReaders: [exporter] });
metrics.setMeterProvider(provider);

// Metrics available at http://localhost:9464/metrics
```

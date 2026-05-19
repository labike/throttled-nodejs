# throttled-nodejs

[![npm version](https://img.shields.io/npm/v/throttled-nodejs?color=blue&logo=npm)](https://www.npmjs.com/package/throttled-nodejs)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

High-performance Node.js rate limiting library — port of [throttled-py](https://github.com/ZhuoZhuoCrayon/throttled-py).

Supports five algorithms (Fixed Window, Sliding Window, Token Bucket, Leaky Bucket & GCRA) and two storage backends (Redis, In-Memory).

## Installation

```bash
npm install throttled-nodejs
```

## Quick Start

```typescript
import { Throttled } from 'throttled-nodejs';

const throttle = new Throttled({ quota: '100/s' });
const result = throttle.limit('/api');

if (result.limited) {
  console.log(`Rate limited. Retry after ${result.state.retryAfter}s`);
} else {
  console.log(`Allowed. ${result.state.remaining} remaining`);
}
```

## Documentation

See the [full documentation](docs/index.md) for:
- [Function Call](docs/quickstart/function-call.md)
- [Decorator](docs/quickstart/decorator.md)
- [Context Manager](docs/quickstart/context-manager.md)
- [Wait & Retry](docs/quickstart/wait-retry.md)
- [Store Backends](docs/quickstart/store-backends.md)
- [Specifying Algorithms](docs/quickstart/specifying-algorithms.md)
- [Quota Configuration](docs/quickstart/quota-configuration.md)
- [Hooks](docs/advance_usage/hooks.md)
- [Store Configuration](docs/advance_usage/store-configuration.md)
- [OpenTelemetry](docs/observability/opentelemetry.md)
- [API Reference](docs/api-reference.md)

## Features

- **Synchronous & Asynchronous** — Works with both sync and `async/await` code
- **Thread-safe storage** — In-Memory (LRU + TTL) and Redis (standalone / sentinel / cluster)
- **Five algorithms** — Fixed Window, Sliding Window, Token Bucket, Leaky Bucket, GCRA
- **Flexible quota** — DSL string `"100/s"` or programmatic `Quota` objects
- **Three call modes** — Function call, decorator, and context manager (`enter()`/`exit()`)
- **Wait & Retry** — Automatic retry with configurable timeout
- **Hook system** — Middleware pattern for observability, timing, and custom logic
- **OpenTelemetry** — Optional metrics integration
- **Utils** — `Timer` and `Benchmark` utilities

## License

MIT

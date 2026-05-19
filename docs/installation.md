# Installation

## Install

```bash
npm install throttled-nodejs
```

> Requires Node.js >= 18 (ES2021).

## Optional Dependencies

Only core dependencies are installed by default. To enable additional features, install optional dependencies:

```bash
npm install ioredis            # Redis storage backend
npm install @opentelemetry/api # OpenTelemetry metrics
```

| Dependency            | Feature              |
|-----------------------|----------------------|
| `ioredis`             | Redis storage backend |
| `@opentelemetry/api`  | OpenTelemetry metrics |

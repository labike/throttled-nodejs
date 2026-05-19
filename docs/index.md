# throttled-nodejs

[![npm version](https://img.shields.io/npm/v/throttled-nodejs?color=blue&logo=npm)](https://www.npmjs.com/package/throttled-nodejs)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

High-performance Node.js rate limiting library — port of [throttled-py](https://github.com/ZhuoZhuoCrayon/throttled-py).

Supports five algorithms (Fixed Window, Sliding Window, Token Bucket, Leaky Bucket & GCRA) and two storage backends (Redis, In-Memory).

## Features

- **Synchronous & Asynchronous** — Works with both sync and `async/await` code.
- **Thread-safe storage** — In-Memory (LRU + TTL) and Redis (standalone / sentinel / cluster).
- **Five algorithms** — Fixed Window, Sliding Window, Token Bucket, Leaky Bucket, Generic Cell Rate Algorithm (GCRA).
- **Flexible quota** — DSL string `"100/s"` or programmatic `Quota` objects.
- **Three call modes** — Function call, decorator, and context manager (`enter()`/`exit()`).
- **Wait & Retry** — Automatic retry with configurable timeout.
- **Hook system** — Middleware pattern for observability, timing, and custom logic.
- **OpenTelemetry** — Optional metrics integration.
- **Excellent performance** — In-Memory: ~2.5–4.5× a `Map.set()` operation; Redis: ~1.06–1.37× an `INCR` command.

## Contents

- [Installation](installation.md)
- [Quick Start](quickstart/function-call.md)
  - [Function Call](quickstart/function-call.md)
  - [Decorator](quickstart/decorator.md)
  - [Context Manager](quickstart/context-manager.md)
  - [Wait & Retry](quickstart/wait-retry.md)
  - [Store Backends](quickstart/store-backends.md)
  - [Specifying Algorithms](quickstart/specifying-algorithms.md)
  - [Quota Configuration](quickstart/quota-configuration.md)
- [Advanced Usage](advance_usage/hooks.md)
  - [Hooks](advance_usage/hooks.md)
  - [Store Configuration](advance_usage/store-configuration.md)
- [Observability](observability/opentelemetry.md)
  - [OpenTelemetry](observability/opentelemetry.md)
- [Changelog](changelog.md)
- [Benchmarks](benchmarks.md)
- [API Reference](api-reference.md)

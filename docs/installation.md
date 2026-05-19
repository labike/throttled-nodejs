---
title: 安装
---

# 安装

## Install

```bash
npm install throttled-nodejs
```

> 需要 Node.js >= 18（ES2021）。

## 可选依赖

只安装核心依赖。启用附加功能需要额外安装：

```bash
npm install ioredis            # Redis 存储后端
npm install @opentelemetry/api # OpenTelemetry 指标
```

| 依赖                     | 功能               |
|--------------------------|-------------------|
| `ioredis`                | Redis 存储后端     |
| `@opentelemetry/api`     | OpenTelemetry 指标 |

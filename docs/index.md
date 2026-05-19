---
layout: home

hero:
  name: throttled-nodejs
  text: 高性能 Node.js 限流库
  tagline: 基于 throttled-py，支持五种算法、两种存储、同步/异步全模式
  actions:
    - theme: brand
      text: 快速开始
      link: /quickstart/function-call
    - theme: alt
      text: API 参考
      link: /api-reference

features:
  - title: 五种算法
    details: Fixed Window、Sliding Window、Token Bucket、Leaky Bucket、GCRA
  - title: 双存储后端
    details: In-Memory（LRU + TTL）和 Redis（单机/哨兵/集群）
  - title: 三种调用模式
    details: 函数调用、装饰器、上下文管理器（enter/exit）
  - title: 同步 & 异步
    details: 同时支持 sync 和 async/await
  - title: Hook 中间件
    details: 基于洋葱模型的插件系统，支持 OpenTelemetry
  - title: 等待重试
    details: 自动等待重试，可配置超时
---

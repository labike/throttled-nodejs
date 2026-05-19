---
title: 变更日志
---

# 变更日志

## 3.2.0

- 基于 throttled-py v3.2.0
- 五种算法（Fixed Window、Sliding Window、Token Bucket、Leaky Bucket、GCRA）
- MemoryStore（LRU + TTL）
- RedisStore（单机、哨兵、集群）
- 同步和异步 Throttled 门面
- Hook 中间件系统
- OpenTelemetry 指标集成
- 配额 DSL 解析器
- Timer 和 Benchmark 工具类
- 完整测试覆盖（112 项测试）

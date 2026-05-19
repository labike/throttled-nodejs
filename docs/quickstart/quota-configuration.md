---
title: 配额配置
---

# 配额配置

## 1) DSL 字符串

直接向 `Throttled` 传入可读的配额字符串：

```typescript
import { Throttled } from 'throttled-nodejs';

const throttle = new Throttled({
  key: '/api/ping',
  quota: '100/s',
  // quota: '100/s burst 200',
  // quota: '100 per second',
  // quota: '100 per second burst 200',
});

console.log(throttle.limit());
```

**支持的模式：**

- `n / unit`
- `n / unit burst <burst>`
- `n per unit`
- `n per unit burst <burst>`

`burst` 表示突发容量，用于 Token Bucket、Leaky Bucket、GCRA。省略时默认等于 `n`。

**支持的时间单位：**

| 规范单位 | 短格式 | 兼容格式                                  | 示例               |
|----------|--------|-------------------------------------------|--------------------|
| second   | s      | s, sec, secs, second, seconds             | `100/s`            |
| minute   | m      | m, min, mins, minute, minutes             | `60/m`             |
| hour     | h      | h, hr, hrs, hour, hours                   | `10/h`             |
| day      | d      | d, day, days                              | `5/d`              |
| week     | w      | w, wk, wks, week, weeks                   | `1/w`              |

## 2) 编程方式

```typescript
import {
  perSec, perMin, perHour, perDay, perWeek, perDuration,
} from 'throttled-nodejs';

perSec(60);       // 60 req/sec
perMin(60);       // 60 req/min
perHour(60);      // 60 req/hour
perDay(60);       // 60 req/day
perWeek(60);      // 60 req/week

// 带 burst
perMin(60, 120);  // 60 req/min, burst 120

// 自定义周期
perDuration(120, 120, 150); // 120 req 每 120s, burst 150
```

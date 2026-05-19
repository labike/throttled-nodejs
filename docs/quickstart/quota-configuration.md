# Quota Configuration

## 1) DSL String

Pass a readable quota string directly to `Throttled`:

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

**Supported patterns:**

- `n / unit`
- `n / unit burst <burst>`
- `n per unit`
- `n per unit burst <burst>`

`burst` means extra bucket capacity for short spikes, effective for Token Bucket, Leaky Bucket, and GCRA. If omitted, `burst` defaults to `n`.

**Supported units:**

| Canonical | Short | Compatible forms                          | Example             |
|-----------|-------|-------------------------------------------|---------------------|
| second    | s     | s, sec, secs, second, seconds             | `100/s`             |
| minute    | m     | m, min, mins, minute, minutes             | `60/m`              |
| hour      | h     | h, hr, hrs, hour, hours                   | `10/h`              |
| day       | d     | d, day, days                              | `5/d`               |
| week      | w     | w, wk, wks, week, weeks                   | `1/w`               |

## 2) Programmatic Quota

```typescript
import { perSec, perMin, perHour, perDay, perWeek, perDuration, Quota, Rate } from 'throttled-nodejs';

perSec(60);       // 60 req/sec
perMin(60);       // 60 req/min
perHour(60);      // 60 req/hour
perDay(60);       // 60 req/day
perWeek(60);      // 60 req/week

// With burst
perMin(60, 120);  // 60 req/min, burst 120

// Custom duration
perDuration(120, 120, 150); // 120 req per 120s, burst 150
```

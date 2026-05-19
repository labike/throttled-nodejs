/**
 * throttled-nodejs OpenTelemetry Hook
 *
 * 提供基于 OpenTelemetry Meter 的限流指标监控。
 * 依赖: @opentelemetry/api (可选)
 *
 * 记录以下指标:
 * - throttled.requests (Counter): 限流检查次数，带 result 维度 ("allowed"/"denied")
 * - throttled.duration (Histogram): 限流检查耗时（秒）
 *
 * 所有指标携带属性: key, algorithm, store_type, result
 *
 * 对应 Python 原版: throttled/contrib/otel.py
 */

import { Meter, Counter, Histogram, Attributes } from '@opentelemetry/api';
import { Hook, HookContext } from '../hooks';
import { RateLimitResult } from '../rate-limiter/base';

/**
 * 同步 OTelHook
 *
 * 包装限流检查，自动记录请求计数和耗时指标。
 *
 * 使用示例:
 * ```
 * import { metrics } from '@opentelemetry/api';
 * import { Throttled } from 'throttled-nodejs';
 * import { OTelHook } from 'throttled-nodejs/contrib/otel';
 *
 * const meter = metrics.getMeter('my-app');
 * const throttle = new Throttled({
 *   quota: '100/s',
 *   hooks: [new OTelHook(meter)],
 * });
 * ```
 */
export class OTelHook extends Hook {
  private _requestsCounter: Counter;
  private _durationHistogram: Histogram;

  constructor(meter: Meter) {
    super();
    this._requestsCounter = meter.createCounter('throttled.requests', {
      description: 'Number of rate limit checks',
    });
    this._durationHistogram = meter.createHistogram('throttled.duration', {
      description: 'Duration of rate limit checks in seconds',
      unit: 's',
    });
  }

  onLimit(
    callNext: () => RateLimitResult,
    context: HookContext,
  ): RateLimitResult {
    const startTime = process.hrtime();
    const result = callNext();

    const elapsed = process.hrtime(startTime);
    const durationSec = elapsed[0] + elapsed[1] / 1e9;

    const attributes: Attributes = {
      key: context.key,
      algorithm: context.algorithm,
      store_type: context.storeType,
      result: result.limited ? 'denied' : 'allowed',
    };

    this._requestsCounter.add(1, attributes);
    this._durationHistogram.record(durationSec, attributes);

    return result;
  }
}

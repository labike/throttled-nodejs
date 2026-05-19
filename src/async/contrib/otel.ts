/**
 * throttled-nodejs 异步 OpenTelemetry Hook
 *
 * 异步版本的 OTelHook，用于 AsyncThrottled。
 * 依赖: @opentelemetry/api (可选)
 *
 * 记录以下指标:
 * - throttled.requests (Counter): 限流检查次数，带 result 维度 ("allowed"/"denied")
 * - throttled.duration (Histogram): 限流检查耗时（秒）
 *
 * 所有指标携带属性: key, algorithm, store_type, result
 *
 * 对应 Python 原版: throttled/asyncio/contrib/otel.py
 */

import { Meter, Counter, Histogram, Attributes } from '@opentelemetry/api';
import { AsyncHook } from '../throttled';
import { HookContext } from '../../hooks';
import { RateLimitResult } from '../../rate-limiter/base';

/**
 * 异步 AsyncOTelHook
 *
 * 包装异步限流检查，自动记录请求计数和耗时指标。
 *
 * 使用示例:
 * ```
 * import { metrics } from '@opentelemetry/api';
 * import { AsyncThrottled } from 'throttled-nodejs';
 * import { AsyncOTelHook } from 'throttled-nodejs/async/contrib/otel';
 *
 * const meter = metrics.getMeter('my-app');
 * const throttle = new AsyncThrottled({
 *   quota: '100/s',
 *   hooks: [new AsyncOTelHook(meter)],
 * });
 * ```
 */
export class AsyncOTelHook extends AsyncHook {
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

  async onLimit(
    callNext: () => Promise<RateLimitResult>,
    context: HookContext,
  ): Promise<RateLimitResult> {
    const startTime = process.hrtime();
    const result = await callNext();

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

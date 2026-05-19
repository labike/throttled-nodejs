/**
 * throttled-nodejs 工具函数模块
 *
 * 提供库中各处使用的通用工具函数和类，包括：
 * - 时间获取函数（秒级、毫秒级、单调时钟）
 * - 值格式化函数
 * - 计时器工具类
 * - 性能基准测试工具类
 *
 * 对应 Python 原版: throttled/utils.py
 */

import { KeyT, StoreDictValueT, StoreValueT } from './types';

// ============================================================
// 时间函数
// ============================================================

/**
 * 获取当前 Unix 时间戳（秒）
 *
 * 用于固定窗口、令牌桶等算法的窗口边界判定。
 * 对应 Python 的 time.time() 取整。
 */
export function nowSec(): number {
  return Date.now() / 1000;
}

/**
 * 获取当前单调时钟时间（秒，高精度浮点数）
 *
 * 用于 GCRA 等需要高精度时间测量的算法。
 * 单调时钟不受系统时间跳变影响。
 * 对应 Python 的 time.monotonic()。
 */
export function nowMonoF(): number {
  const [seconds, nanoseconds] = process.hrtime();
  return seconds + nanoseconds / 1e9;
}

/**
 * 获取当前时间戳（毫秒）
 *
 * 用于滑动窗口等需要毫秒级精度的时间计算。
 * 对应 Python 的 time.time() * 1000。
 */
export function nowMs(): number {
  return Date.now();
}

// ============================================================
// 值格式化函数
// ============================================================

/**
 * 格式化存储值 —— 如果浮点数是整数则转为整数
 *
 * 用于 Redis 等存储读取后的值格式化。
 *
 * @param value - 原始值
 * @returns 格式化后的值（整数字面量或浮点数）
 */
export function formatValue(value: StoreValueT): StoreValueT {
  if (Number.isInteger(value)) {
    return Math.floor(value);
  }
  return value;
}

/**
 * 格式化键名 —— 将 Buffer/字节键转为字符串
 *
 * 用于 Redis 读取二进制键后的解码。
 *
 * @param key - 原始键（字符串或 Buffer）
 * @returns 字符串形式的键
 */
export function formatKey(key: string | Buffer): KeyT {
  if (Buffer.isBuffer(key)) {
    return key.toString('utf-8');
  }
  return key;
}

/**
 * 格式化键值对字典
 *
 * @param kv - 原始键值对字典
 * @returns 格式化后的键值对字典
 */
export function formatKv(kv: Record<string, StoreValueT>): StoreDictValueT {
  const result: StoreDictValueT = {};
  for (const [k, v] of Object.entries(kv)) {
    result[formatKey(k)] = formatValue(v);
  }
  return result;
}

// ============================================================
// Timer —— 计时上下文管理器 / 装饰器
// ============================================================

/**
 * 计时器工具类，测量同步和异步代码块的执行耗时。
 *
 * 提供两种使用模式：
 * 1. 上下文管理器：enter() / exit()
 * 2. 装饰器：timer.decorate(fn)
 *
 * 对应 Python 原版: throttled/utils.py Timer
 *
 * 使用示例：
 * ```
 * const timer = new Timer({
 *   clock: () => Date.now() / 1000,
 *   callback: (elapsed, start, end) => console.log(`耗时: ${elapsed.toFixed(2)}s`),
 * });
 *
 * // 上下文管理器模式
 * timer.enter();
 * // ... 要计时的代码 ...
 * timer.exit();
 *
 * // 装饰器模式
 * const timedFn = timer.decorate(myFunction);
 * ```
 */
export class Timer {
  private _clock: () => number;
  private _callback: ((elapsed: number, start: number, end: number) => void) | null;
  private _start: number = 0;

  constructor(options?: {
    clock?: () => number;
    callback?: (elapsed: number, start: number, end: number) => void;
  }) {
    this._clock = options?.clock ?? nowMonoF;
    this._callback = options?.callback ?? null;
  }

  protected _newTimer(): Timer {
    return new Timer({ clock: this._clock, callback: this._callback ?? undefined });
  }

  enter(): Timer {
    this._start = this._clock();
    return this;
  }

  exit(): void {
    this._handleCallback();
  }

  private _handleCallback(): void {
    if (this._callback) {
      const end = this._clock();
      const elapsed = end - this._start;
      this._callback(elapsed, this._start, end);
    }
  }

  decorate<T extends (...args: any[]) => any>(fn: T): T {
    const self = this;
    const wrapped = function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
      const timer = self._newTimer();
      timer.enter();
      try {
        return fn.apply(this, args);
      } finally {
        timer.exit();
      }
    };
    Object.defineProperty(wrapped, 'name', { value: fn.name });
    return wrapped as unknown as T;
  }
}

// ============================================================
// Benchmark —— 性能基准测试工具
// ============================================================

/**
 * 基准测试工具类，测量同步/异步函数调用的吞吐量和延迟。
 *
 * 支持串行和并发两种执行模式。
 *
 * 对应 Python 原版: throttled/utils.py Benchmark
 *
 * 使用示例：
 * ```
 * function callApi(): boolean {
 *   const result = throttle.limit('/ping');
 *   return result.limited;
 * }
 *
 * const bench = new Benchmark();
 * const results = bench.serial(callApi, 100);
 * bench.stats();
 * ```
 */
export class Benchmark {
  public handledNsList: number[] = [];
  public startTimes: number[] = [];
  public endTimes: number[] = [];
  public lastAvg: number = 0;
  public lastQps: number = 0;

  private _hasCheckedEnvironment: boolean = false;

  enter(): Benchmark {
    this._checkEnvironment();
    this.clear();
    return this;
  }

  exit(): void {
    this.stats();
  }

  stats(): void {
    const total = this.handledNsList.length;
    if (total === 0) return;

    const avg = this.handledNsList.reduce((a, b) => a + b, 0) / total;
    const durationSec = (Math.max(...this.endTimes) - Math.min(...this.startTimes)) / 1e9;
    const qps = durationSec > 0 ? Math.floor(total / durationSec) : 0;

    const growthRate = this.lastQps ? ((qps - this.lastQps) * 100) / this.lastQps : 0;
    const growth = this.lastQps
      ? `${growthRate >= 0 ? '🚀' : '💤'}${growthRate.toFixed(2)}%`
      : '--';

    console.log(
      `✅ Total: ${total}, ` +
      `🕒 Latency: ${(avg / 1e6).toFixed(4)} ms/op, ` +
      `🚀 Throughput: ${qps} req/s (${growth})`,
    );

    this.lastQps = qps;
    this.lastAvg = avg;
  }

  clear(): void {
    this.handledNsList = [];
    this.endTimes = [];
    this.startTimes = [];
  }

  private _checkEnvironment(): void {
    if (this._hasCheckedEnvironment) return;
    this._hasCheckedEnvironment = true;

    console.log(
      `Node.js ${process.version}\n` +
      `Platform: ${process.platform} ${process.arch}\n`,
    );
  }

  private _timer<T extends (...args: any[]) => any>(task: T): T {
    const bench = this;
    const wrapped = function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
      const start = process.hrtime.bigint();
      bench.startTimes.push(Number(start));
      const ret = task.apply(this, args);
      const end = process.hrtime.bigint();
      bench.endTimes.push(Number(end));
      bench.handledNsList.push(Number(end - start));
      return ret;
    };
    return wrapped as unknown as T;
  }

  private _asyncTimer<T extends (...args: any[]) => Promise<any>>(task: T): T {
    const bench = this;
    const wrapped = async function (this: unknown, ...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> {
      const start = process.hrtime.bigint();
      bench.startTimes.push(Number(start));
      try {
        const ret = await task.apply(this, args);
        return ret;
      } finally {
        const end = process.hrtime.bigint();
        bench.endTimes.push(Number(end));
        bench.handledNsList.push(Number(end - start));
      }
    };
    return wrapped as unknown as T;
  }

  serial<T extends (...args: any[]) => any>(
    task: T,
    batch: number,
    ...args: Parameters<T>
  ): ReturnType<T>[] {
    this.enter();
    try {
      const timed = this._timer(task);
      const results: ReturnType<T>[] = [];
      for (let i = 0; i < batch; i++) {
        results.push(timed(...args));
      }
      return results;
    } finally {
      this.exit();
    }
  }

  async concurrent<T extends (...args: any[]) => any>(
    task: T,
    batch: number,
    workers: number = 32,
    ...args: Parameters<T>
  ): Promise<ReturnType<T>[]> {
    this.enter();
    try {
      const timed = this._timer(task);
      const runBatch = async (count: number): Promise<ReturnType<T>[]> => {
        const results: ReturnType<T>[] = [];
        for (let i = 0; i < count; i++) {
          results.push(timed(...args));
        }
        return results;
      };
      const chunks: Promise<ReturnType<T>[]>[] = [];
      const chunkSize = Math.ceil(batch / Math.ceil(batch / workers));
      for (let i = 0; i < batch; i += chunkSize) {
        const size = Math.min(chunkSize, batch - i);
        chunks.push(runBatch(size));
      }
      const chunkResults = await Promise.all(chunks);
      return chunkResults.flat();
    } finally {
      this.exit();
    }
  }

  async asyncSerial<T extends (...args: any[]) => Promise<any>>(
    task: T,
    batch: number,
    ...args: Parameters<T>
  ): Promise<Awaited<ReturnType<T>>[]> {
    this.enter();
    try {
      const timed = this._asyncTimer(task);
      const results: Awaited<ReturnType<T>>[] = [];
      for (let i = 0; i < batch; i++) {
        results.push(await timed(...args));
      }
      return results;
    } finally {
      this.exit();
    }
  }

  async asyncConcurrent<T extends (...args: any[]) => Promise<any>>(
    task: T,
    batch: number,
    workers: number = 32,
    ...args: Parameters<T>
  ): Promise<Awaited<ReturnType<T>>[]> {
    this.enter();
    try {
      const timed = this._asyncTimer(task);

      // 使用信号量限制并发数
      let active = 0;
      let idx = 0;
      const results: Awaited<ReturnType<T>>[] = new Array(batch);

      const runNext = async (): Promise<void> => {
        while (idx < batch) {
          const i = idx++;
          active++;
          try {
            results[i] = await timed(...args);
          } finally {
            active--;
          }
        }
      };

      const runners: Promise<void>[] = [];
      const numWorkers = Math.min(workers, batch);
      for (let i = 0; i < numWorkers; i++) {
        runners.push(runNext());
      }
      await Promise.all(runners);
      return results;
    } finally {
      this.exit();
    }
  }
}

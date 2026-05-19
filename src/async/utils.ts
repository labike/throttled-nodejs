/**
 * throttled-nodejs 异步工具模块
 *
 * 从同步模块中重新导出 Timer 和 Benchmark。
 * 这两个类同时支持同步和异步使用场景。
 *
 * 对应 Python 原版: throttled/asyncio/utils.py
 */

export { Timer, Benchmark } from '../utils';

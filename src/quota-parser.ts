/**
 * throttled-nodejs 配额 DSL 解析器
 *
 * 将可读性强的配额字符串解析为 Quota 对象。
 *
 * 支持以下格式：
 * - "n/unit"            → 如 "100/s"
 * - "n per unit"        → 如 "100 per second"
 * - "n/unit burst m"    → 如 "100/s burst 200"
 * - "n per unit burst m" → 如 "100 per second burst 200"
 *
 * 单位支持：
 * - 秒: s / sec / secs / second / seconds
 * - 分: m / min / mins / minute / minutes
 * - 时: h / hr / hrs / hour / hours
 * - 天: d / day / days
 * - 周: w / wk / wks / week / weeks
 *
 * 对应 Python 原版: throttled/rate_limiter/quota_parser.py
 */

import { DataError } from './exceptions';
import { perDuration, Quota } from './rate-limiter/base';

// 单位别名到标准名的映射表
const UNIT_ALIAS_TO_CANONICAL: Record<string, string> = {
  's': 'second', 'sec': 'second', 'secs': 'second', 'second': 'second', 'seconds': 'second',
  'm': 'minute', 'min': 'minute', 'mins': 'minute', 'minute': 'minute', 'minutes': 'minute',
  'h': 'hour', 'hr': 'hour', 'hrs': 'hour', 'hour': 'hour', 'hours': 'hour',
  'd': 'day', 'day': 'day', 'days': 'day',
  'w': 'week', 'wk': 'week', 'wks': 'week', 'week': 'week', 'weeks': 'week',
};

// 标准单位名到秒数的映射
const CANONICAL_UNIT_TO_SECONDS: Record<string, number> = {
  'second': 1,
  'minute': 60,
  'hour': 3600,
  'day': 86400,
  'week': 604800,
};

// 配额 DSL 的正则表达式
// 匹配: "100/s", "100 per second", "100/s burst 200", "100 per second burst 200"
const RATE_PATTERN = /^\s*(\d+)\s*(?:\/\s*([a-zA-Z]+)|per\s+([a-zA-Z]+))(?:\s+burst\s+(\d+))?\s*$/i;

/**
 * 解析单位别名为标准名并获取对应的秒数
 *
 * @param rawUnit - 原始单位字符串
 * @param token - 完整的 DSL token（用于错误提示）
 * @returns 标准单位名
 * @throws DataError 当单位不识别时抛出
 */
function parseUnit(rawUnit: string, token: string): string {
  const canonical = UNIT_ALIAS_TO_CANONICAL[rawUnit.toLowerCase()];
  if (!canonical) {
    throw new DataError(
      `Invalid quota token: '${token}', unsupported unit '${rawUnit}'. ` +
      'Expected one of: s/sec/second, m/min/minute, h/hr/hour, d/day, w/wk/week.',
    );
  }
  return canonical;
}

/**
 * 解析单个配额 DSL Token
 *
 * @param token - 配额 DSL 字符串（如 "100/s burst 200"）
 * @returns [limit, 周期秒数, burst]
 * @throws DataError 当格式无法解析时抛出
 */
function parseRateToken(token: string): [number, number, number | null] {
  const match = RATE_PATTERN.exec(token);
  if (!match) {
    throw new DataError(
      `Invalid quota token: '${token}', expected '<n>/<unit>' or '<n> per <unit>', optionally followed by 'burst <n>'.`,
    );
  }

  const limit = parseInt(match[1], 10);
  if (limit <= 0) {
    throw new DataError(`Invalid quota token: '${token}', limit must be greater than 0.`);
  }

  // 单位可能在第二组（/ 语法）或第三组（per 语法）
  const rawUnit = match[2] || match[3];
  const canonicalUnit = parseUnit(rawUnit, token);
  const burstExpr = match[4];           // burst 值（可能为 undefined）
  const burst = burstExpr ? parseInt(burstExpr, 10) : null;

  return [limit, CANONICAL_UNIT_TO_SECONDS[canonicalUnit], burst];
}

/**
 * 解析配额 DSL 字符串，返回一个或多个 Quota 对象
 *
 * 支持通过逗号、分号、竖线分隔多个规则：
 * - "100/s, 50/m"    → 两个 Quota 规则
 * - "100/s; 50/m"    → 同上
 * - "100/s | 50/m"   → 同上
 *
 * @param quotaExpr - 配额 DSL 字符串
 * @returns Quota 对象列表
 * @throws DataError 当输入无效时抛出
 */
export function parseQuota(quotaExpr: string): Quota[] {
  if (typeof quotaExpr !== 'string' || !quotaExpr.trim()) {
    throw new DataError('Invalid quota: must be a non-empty string.');
  }

  // 按分隔符拆分多规则
  const tokens = quotaExpr.split(/[;,|]/).map(t => t.trim()).filter(t => t.length > 0);
  if (tokens.length === 0) {
    throw new DataError('Invalid quota: must be a non-empty string.');
  }

  const quotas: Quota[] = [];
  for (const token of tokens) {
    const [limit, periodSeconds, burst] = parseRateToken(token);
    quotas.push(perDuration(periodSeconds, limit, burst ?? limit));
  }

  return quotas;
}

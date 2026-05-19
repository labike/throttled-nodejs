/**
 * 配额 DSL 解析器单元测试
 *
 * 测试 parseQuota 函数对各类 DSL 字符串的解析结果。
 */

import { parseQuota } from '../quota-parser';
import { Quota } from '../rate-limiter/base';

describe('QuotaParser', () => {
  // ============================================================
  // 基本格式测试
  // ============================================================

  describe('基本格式 (n/unit)', () => {
    it('应解析 "100/s" 为每秒 100 次', () => {
      const quotas = parseQuota('100/s');
      expect(quotas).toHaveLength(1);
      expect(quotas[0].rate.limit).toBe(100);
      expect(quotas[0].rate.period).toBe(1);
      expect(quotas[0].burst).toBe(100); // 默认 burst = limit
    });

    it('应解析 "60/m" 为每分钟 60 次', () => {
      const quotas = parseQuota('60/m');
      expect(quotas[0].rate.limit).toBe(60);
      expect(quotas[0].rate.period).toBe(60);
    });

    it('应解析 "5/h" 为每小时 5 次', () => {
      const quotas = parseQuota('5/h');
      expect(quotas[0].rate.limit).toBe(5);
      expect(quotas[0].rate.period).toBe(3600);
    });
  });

  // ============================================================
  // burst 格式测试
  // ============================================================

  describe('带 burst 格式 (n/unit burst m)', () => {
    it('应解析 "100/s burst 200" 为每秒 100 次，突发 200', () => {
      const quotas = parseQuota('100/s burst 200');
      expect(quotas[0].rate.limit).toBe(100);
      expect(quotas[0].burst).toBe(200);
    });

    it('应解析 "10/m burst 50" 为每分钟 10 次，突发 50', () => {
      const quotas = parseQuota('10/m burst 50');
      expect(quotas[0].rate.limit).toBe(10);
      expect(quotas[0].burst).toBe(50);
    });
  });

  // ============================================================
  // "per" 语法格式测试
  // ============================================================

  describe('"per" 语法格式 (n per unit)', () => {
    it('应解析 "100 per second"', () => {
      const quotas = parseQuota('100 per second');
      expect(quotas[0].rate.limit).toBe(100);
      expect(quotas[0].rate.period).toBe(1);
    });

    it('应解析 "5 per minute burst 10"', () => {
      const quotas = parseQuota('5 per minute burst 10');
      expect(quotas[0].rate.limit).toBe(5);
      expect(quotas[0].rate.period).toBe(60);
      expect(quotas[0].burst).toBe(10);
    });
  });

  // ============================================================
  // 单位别名测试
  // ============================================================

  describe('单位别名', () => {
    it('应支持所有秒的别名: s/sec/secs/second/seconds', () => {
      expect(parseQuota('1/s')[0].rate.period).toBe(1);
      expect(parseQuota('1/sec')[0].rate.period).toBe(1);
      expect(parseQuota('1/secs')[0].rate.period).toBe(1);
      expect(parseQuota('1/second')[0].rate.period).toBe(1);
      expect(parseQuota('1/seconds')[0].rate.period).toBe(1);
    });

    it('应支持所有分钟的别名: m/min/mins/minute/minutes', () => {
      expect(parseQuota('1/m')[0].rate.period).toBe(60);
      expect(parseQuota('1/min')[0].rate.period).toBe(60);
      expect(parseQuota('1/minute')[0].rate.period).toBe(60);
    });

    it('应支持天和周: d/day/w/week', () => {
      expect(parseQuota('1/d')[0].rate.period).toBe(86400);
      expect(parseQuota('1/w')[0].rate.period).toBe(604800);
    });
  });

  // ============================================================
  // 多规则测试
  // ============================================================

  describe('多规则解析', () => {
    it('应支持逗号分隔的多规则', () => {
      const quotas = parseQuota('100/s, 50/m');
      expect(quotas).toHaveLength(2);
      expect(quotas[0].rate.limit).toBe(100);
      expect(quotas[1].rate.limit).toBe(50);
    });

    it('应支持分号分隔的多规则', () => {
      const quotas = parseQuota('100/s; 50/m');
      expect(quotas).toHaveLength(2);
    });

    it('应支持竖线分隔的多规则', () => {
      const quotas = parseQuota('100/s | 50/m');
      expect(quotas).toHaveLength(2);
    });
  });

  // ============================================================
  // 错误处理测试
  // ============================================================

  describe('错误处理', () => {
    it('空字符串应抛出 DataError', () => {
      expect(() => parseQuota('')).toThrow();
    });

    it('无效格式应抛出 DataError', () => {
      expect(() => parseQuota('abc')).toThrow();
    });

    it('limit 为 0 应抛出 DataError', () => {
      expect(() => parseQuota('0/s')).toThrow();
    });

    it('不支持的单位应抛出 DataError', () => {
      expect(() => parseQuota('1/year')).toThrow();
    });
  });

  // ============================================================
  // 派生属性测试
  // ============================================================

  describe('自动派生属性', () => {
    it('应正确计算 emissionInterval 和 fillRate', () => {
      // 100/s: 每 0.01 秒一个请求, 100 填充率
      const quota = parseQuota('100/s')[0];
      expect(quota.emissionInterval).toBeCloseTo(0.01);
      expect(quota.fillRate).toBeCloseTo(100);
    });

    it('burst 不指定时应等于 limit', () => {
      const quota = parseQuota('50/s')[0];
      expect(quota.burst).toBe(50);
    });
  });
});

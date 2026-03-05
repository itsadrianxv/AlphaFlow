/**
 * ScoringConfig 值对象单元测试
 */

import { describe, it, expect } from "vitest";
import {
  ScoringConfig,
  NormalizationMethod,
  InvalidScoringConfigError,
} from "../scoring-config";
import { IndicatorField } from "../../enums/indicator-field";

describe("ScoringConfig", () => {
  describe("create", () => {
    it("应该成功创建有效的评分配置", () => {
      const weights = new Map([
        [IndicatorField.ROE, 0.3],
        [IndicatorField.PE, 0.2],
        [IndicatorField.REVENUE_CAGR_3Y, 0.5],
      ]);

      const config = ScoringConfig.create(weights);

      expect(config.weights.size).toBe(3);
      expect(config.getWeight(IndicatorField.ROE)).toBe(0.3);
      expect(config.getWeight(IndicatorField.PE)).toBe(0.2);
      expect(config.getWeight(IndicatorField.REVENUE_CAGR_3Y)).toBe(0.5);
      expect(config.normalizationMethod).toBe(NormalizationMethod.MIN_MAX);
    });

    it("应该接受权重之和在允许误差范围内的配置", () => {
      // 权重之和为 1.0005（在 ±0.001 范围内）
      const weights = new Map([
        [IndicatorField.ROE, 0.3335],
        [IndicatorField.PE, 0.3335],
        [IndicatorField.PB, 0.3335],
      ]);

      expect(() => ScoringConfig.create(weights)).not.toThrow();
    });

    it("应该拒绝权重之和不等于 1.0 的配置", () => {
      const weights = new Map([
        [IndicatorField.ROE, 0.3],
        [IndicatorField.PE, 0.2],
        [IndicatorField.REVENUE_CAGR_3Y, 0.4], // 总和 0.9
      ]);

      expect(() => ScoringConfig.create(weights)).toThrow(
        InvalidScoringConfigError
      );
      expect(() => ScoringConfig.create(weights)).toThrow(/权重之和必须等于 1.0/);
    });

    it("应该拒绝权重之和超出允许误差的配置", () => {
      // 权重之和为 1.002（超出 ±0.001 范围）
      const weights = new Map([
        [IndicatorField.ROE, 0.334],
        [IndicatorField.PE, 0.334],
        [IndicatorField.PB, 0.334],
      ]);

      expect(() => ScoringConfig.create(weights)).toThrow(
        InvalidScoringConfigError
      );
    });

    it("应该拒绝空权重配置", () => {
      const weights = new Map<IndicatorField, number>();

      expect(() => ScoringConfig.create(weights)).toThrow(
        InvalidScoringConfigError
      );
      expect(() => ScoringConfig.create(weights)).toThrow(
        /至少包含一个指标权重/
      );
    });

    it("应该拒绝包含负权重的配置", () => {
      const weights = new Map([
        [IndicatorField.ROE, 0.5],
        [IndicatorField.PE, -0.2],
        [IndicatorField.PB, 0.7],
      ]);

      expect(() => ScoringConfig.create(weights)).toThrow(
        InvalidScoringConfigError
      );
      expect(() => ScoringConfig.create(weights)).toThrow(/权重必须为正数/);
    });

    it("应该拒绝包含零权重的配置", () => {
      const weights = new Map([
        [IndicatorField.ROE, 0.5],
        [IndicatorField.PE, 0],
        [IndicatorField.PB, 0.5],
      ]);

      expect(() => ScoringConfig.create(weights)).toThrow(
        InvalidScoringConfigError
      );
      expect(() => ScoringConfig.create(weights)).toThrow(/权重必须为正数/);
    });

    it("应该拒绝包含非有限数值权重的配置", () => {
      const weights = new Map([
        [IndicatorField.ROE, 0.5],
        [IndicatorField.PE, Infinity],
        [IndicatorField.PB, 0.5],
      ]);

      expect(() => ScoringConfig.create(weights)).toThrow(
        InvalidScoringConfigError
      );
      expect(() => ScoringConfig.create(weights)).toThrow(/权重必须为有限数值/);
    });

    it("应该支持单个指标权重为 1.0", () => {
      const weights = new Map([[IndicatorField.ROE, 1.0]]);

      const config = ScoringConfig.create(weights);

      expect(config.weights.size).toBe(1);
      expect(config.getWeight(IndicatorField.ROE)).toBe(1.0);
    });

    it("应该支持自定义归一化方法", () => {
      const weights = new Map([[IndicatorField.ROE, 1.0]]);

      const config = ScoringConfig.create(weights, NormalizationMethod.MIN_MAX);

      expect(config.normalizationMethod).toBe(NormalizationMethod.MIN_MAX);
    });
  });

  describe("tryCreate", () => {
    it("应该返回有效配置的实例", () => {
      const weights = new Map([[IndicatorField.ROE, 1.0]]);

      const config = ScoringConfig.tryCreate(weights);

      expect(config).not.toBeNull();
      expect(config?.getWeight(IndicatorField.ROE)).toBe(1.0);
    });

    it("应该对无效配置返回 null", () => {
      const weights = new Map([[IndicatorField.ROE, 0.5]]); // 总和不为 1.0

      const config = ScoringConfig.tryCreate(weights);

      expect(config).toBeNull();
    });
  });

  describe("validate", () => {
    it("应该验证有效配置", () => {
      const weights = new Map([
        [IndicatorField.ROE, 0.5],
        [IndicatorField.PE, 0.5],
      ]);

      const result = ScoringConfig.validate(weights);

      expect(result.isValid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("应该返回空配置的错误信息", () => {
      const weights = new Map<IndicatorField, number>();

      const result = ScoringConfig.validate(weights);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("至少包含一个指标权重");
    });

    it("应该返回权重之和不为 1.0 的错误信息", () => {
      const weights = new Map([[IndicatorField.ROE, 0.5]]);

      const result = ScoringConfig.validate(weights);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("权重之和必须等于 1.0");
      expect(result.error).toContain("偏差");
    });

    it("应该返回负权重的错误信息", () => {
      const weights = new Map([
        [IndicatorField.ROE, 1.5],
        [IndicatorField.PE, -0.5],
      ]);

      const result = ScoringConfig.validate(weights);

      expect(result.isValid).toBe(false);
      expect(result.error).toContain("权重必须为正数");
    });
  });

  describe("getWeight", () => {
    it("应该返回存在的指标权重", () => {
      const weights = new Map([[IndicatorField.ROE, 1.0]]);
      const config = ScoringConfig.create(weights);

      expect(config.getWeight(IndicatorField.ROE)).toBe(1.0);
    });

    it("应该对不存在的指标返回 0", () => {
      const weights = new Map([[IndicatorField.ROE, 1.0]]);
      const config = ScoringConfig.create(weights);

      expect(config.getWeight(IndicatorField.PE)).toBe(0);
    });
  });

  describe("getFields", () => {
    it("应该返回所有指标字段", () => {
      const weights = new Map([
        [IndicatorField.ROE, 0.3],
        [IndicatorField.PE, 0.3],
        [IndicatorField.PB, 0.4],
      ]);
      const config = ScoringConfig.create(weights);

      const fields = config.getFields();

      expect(fields).toHaveLength(3);
      expect(fields).toContain(IndicatorField.ROE);
      expect(fields).toContain(IndicatorField.PE);
      expect(fields).toContain(IndicatorField.PB);
    });
  });

  describe("hasField", () => {
    it("应该对存在的指标返回 true", () => {
      const weights = new Map([[IndicatorField.ROE, 1.0]]);
      const config = ScoringConfig.create(weights);

      expect(config.hasField(IndicatorField.ROE)).toBe(true);
    });

    it("应该对不存在的指标返回 false", () => {
      const weights = new Map([[IndicatorField.ROE, 1.0]]);
      const config = ScoringConfig.create(weights);

      expect(config.hasField(IndicatorField.PE)).toBe(false);
    });
  });

  describe("size", () => {
    it("应该返回权重数量", () => {
      const weights = new Map([
        [IndicatorField.ROE, 0.5],
        [IndicatorField.PE, 0.5],
      ]);
      const config = ScoringConfig.create(weights);

      expect(config.size()).toBe(2);
    });
  });

  describe("toDict / fromDict", () => {
    it("应该正确序列化和反序列化", () => {
      const weights = new Map([
        [IndicatorField.ROE, 0.3],
        [IndicatorField.PE, 0.2],
        [IndicatorField.REVENUE_CAGR_3Y, 0.5],
      ]);
      const config = ScoringConfig.create(weights, NormalizationMethod.MIN_MAX);

      const dict = config.toDict();
      const restored = ScoringConfig.fromDict(dict);

      expect(restored.equals(config)).toBe(true);
      expect(restored.getWeight(IndicatorField.ROE)).toBe(0.3);
      expect(restored.getWeight(IndicatorField.PE)).toBe(0.2);
      expect(restored.getWeight(IndicatorField.REVENUE_CAGR_3Y)).toBe(0.5);
      expect(restored.normalizationMethod).toBe(NormalizationMethod.MIN_MAX);
    });

    it("toDict 应该返回正确的对象结构", () => {
      const weights = new Map([
        [IndicatorField.ROE, 0.6],
        [IndicatorField.PE, 0.4],
      ]);
      const config = ScoringConfig.create(weights);

      const dict = config.toDict();

      expect(dict).toHaveProperty("weights");
      expect(dict).toHaveProperty("normalizationMethod");
      expect(dict.weights).toEqual({
        [IndicatorField.ROE]: 0.6,
        [IndicatorField.PE]: 0.4,
      });
      expect(dict.normalizationMethod).toBe(NormalizationMethod.MIN_MAX);
    });

    it("fromDict 应该拒绝缺少 weights 的数据", () => {
      const dict = {
        normalizationMethod: NormalizationMethod.MIN_MAX,
      };

      expect(() => ScoringConfig.fromDict(dict)).toThrow(/必须包含 weights 对象/);
    });

    it("fromDict 应该拒绝非数字权重", () => {
      const dict = {
        weights: {
          [IndicatorField.ROE]: "0.5",
          [IndicatorField.PE]: "0.5",
        },
        normalizationMethod: NormalizationMethod.MIN_MAX,
      };

      expect(() => ScoringConfig.fromDict(dict)).toThrow(/权重必须为数字/);
    });

    it("fromDict 应该拒绝未知的指标字段", () => {
      const dict = {
        weights: {
          UNKNOWN_FIELD: 1.0,
        },
        normalizationMethod: NormalizationMethod.MIN_MAX,
      };

      expect(() => ScoringConfig.fromDict(dict)).toThrow(/未知的指标字段/);
    });

    it("fromDict 应该拒绝未知的归一化方法", () => {
      const dict = {
        weights: {
          [IndicatorField.ROE]: 1.0,
        },
        normalizationMethod: "UNKNOWN_METHOD",
      };

      expect(() => ScoringConfig.fromDict(dict)).toThrow(/未知的归一化方法/);
    });

    it("fromDict 应该使用默认归一化方法", () => {
      const dict = {
        weights: {
          [IndicatorField.ROE]: 1.0,
        },
      };

      const config = ScoringConfig.fromDict(dict);

      expect(config.normalizationMethod).toBe(NormalizationMethod.MIN_MAX);
    });
  });

  describe("equals", () => {
    it("应该对相同配置返回 true", () => {
      const weights = new Map([
        [IndicatorField.ROE, 0.5],
        [IndicatorField.PE, 0.5],
      ]);
      const config1 = ScoringConfig.create(weights);
      const config2 = ScoringConfig.create(weights);

      expect(config1.equals(config2)).toBe(true);
    });

    it("应该对不同权重返回 false", () => {
      const weights1 = new Map([
        [IndicatorField.ROE, 0.6],
        [IndicatorField.PE, 0.4],
      ]);
      const weights2 = new Map([
        [IndicatorField.ROE, 0.5],
        [IndicatorField.PE, 0.5],
      ]);
      const config1 = ScoringConfig.create(weights1);
      const config2 = ScoringConfig.create(weights2);

      expect(config1.equals(config2)).toBe(false);
    });

    it("应该对不同指标字段返回 false", () => {
      const weights1 = new Map([[IndicatorField.ROE, 1.0]]);
      const weights2 = new Map([[IndicatorField.PE, 1.0]]);
      const config1 = ScoringConfig.create(weights1);
      const config2 = ScoringConfig.create(weights2);

      expect(config1.equals(config2)).toBe(false);
    });

    it("应该对不同数量的权重返回 false", () => {
      const weights1 = new Map([[IndicatorField.ROE, 1.0]]);
      const weights2 = new Map([
        [IndicatorField.ROE, 0.5],
        [IndicatorField.PE, 0.5],
      ]);
      const config1 = ScoringConfig.create(weights1);
      const config2 = ScoringConfig.create(weights2);

      expect(config1.equals(config2)).toBe(false);
    });

    it("应该对 null 返回 false", () => {
      const weights = new Map([[IndicatorField.ROE, 1.0]]);
      const config = ScoringConfig.create(weights);

      expect(config.equals(null)).toBe(false);
    });

    it("应该对 undefined 返回 false", () => {
      const weights = new Map([[IndicatorField.ROE, 1.0]]);
      const config = ScoringConfig.create(weights);

      expect(config.equals(undefined)).toBe(false);
    });
  });

  describe("边界情况", () => {
    it("应该处理权重之和恰好为 1.0 的情况", () => {
      const weights = new Map([
        [IndicatorField.ROE, 0.333333333],
        [IndicatorField.PE, 0.333333333],
        [IndicatorField.PB, 0.333333334],
      ]);

      expect(() => ScoringConfig.create(weights)).not.toThrow();
    });

    it("应该处理多个指标的复杂配置", () => {
      const weights = new Map([
        [IndicatorField.ROE, 0.15],
        [IndicatorField.PE, 0.15],
        [IndicatorField.PB, 0.1],
        [IndicatorField.REVENUE_CAGR_3Y, 0.2],
        [IndicatorField.NET_PROFIT_CAGR_3Y, 0.2],
        [IndicatorField.DEBT_RATIO, 0.1],
        [IndicatorField.MARKET_CAP, 0.1],
      ]);

      const config = ScoringConfig.create(weights);

      expect(config.size()).toBe(7);
      expect(config.getFields()).toHaveLength(7);
    });

    it("应该处理非常小的权重值", () => {
      const weights = new Map([
        [IndicatorField.ROE, 0.001],
        [IndicatorField.PE, 0.999],
      ]);

      const config = ScoringConfig.create(weights);

      expect(config.getWeight(IndicatorField.ROE)).toBe(0.001);
      expect(config.getWeight(IndicatorField.PE)).toBe(0.999);
    });
  });
});

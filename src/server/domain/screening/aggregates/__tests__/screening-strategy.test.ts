/**
 * ScreeningStrategy 聚合根单元测试
 *
 * 测试策略：
 * - 测试创建和不变量验证
 * - 测试更新操作
 * - 测试模板标记和克隆
 * - 测试筛选执行流程
 */

import { describe, it, expect } from "vitest";
import { ScreeningStrategy } from "../index.js";
import { FilterGroup } from "../../entities/filter-group.js";
import { FilterCondition } from "../../value-objects/filter-condition.js";
import { ScoringConfig, NormalizationMethod } from "../../value-objects/scoring-config.js";
import { IndicatorField } from "../../enums/indicator-field.js";
import { ComparisonOperator } from "../../enums/comparison-operator.js";
import { LogicalOperator } from "../../enums/logical-operator.js";
import { InvalidStrategyError } from "../../errors.js";
import { Stock } from "../../entities/stock.js";
import { StockCode } from "../../value-objects/stock-code.js";
import type { IScoringService, IIndicatorCalculationService } from "../index.js";
import { ScoredStock } from "../../value-objects/scored-stock.js";

describe("ScreeningStrategy", () => {
  // 辅助函数：创建有效的筛选条件
  const createValidFilterCondition = (): FilterCondition => {
    return FilterCondition.create(
      IndicatorField.ROE,
      ComparisonOperator.GREATER_THAN,
      { type: "numeric", value: 0.15 }
    );
  };

  // 辅助函数：创建有效的 FilterGroup
  const createValidFilterGroup = (): FilterGroup => {
    return FilterGroup.create(
      LogicalOperator.AND,
      [createValidFilterCondition()],
      []
    );
  };

  // 辅助函数：创建有效的 ScoringConfig
  const createValidScoringConfig = (): ScoringConfig => {
    return ScoringConfig.create(
      new Map([
        [IndicatorField.ROE, 0.5],
        [IndicatorField.PE, 0.5],
      ]),
      NormalizationMethod.MIN_MAX
    );
  };

  // Mock 服务
  const mockCalcService: IIndicatorCalculationService = {
    calculateIndicator: (indicator: IndicatorField, stock: Stock) => stock.getValue(indicator),
    calculateBatch: (indicators: IndicatorField[], stock: Stock) => {
      const result = new Map();
      indicators.forEach((ind: IndicatorField) => {
        result.set(ind, stock.getValue(ind));
      });
      return result;
    },
  };

  const mockScoringService: IScoringService = {
    scoreStocks: (stocks, config, calcService) => {
      // 简单的 mock 实现：返回固定评分
      return stocks.map((stock) =>
        ScoredStock.create(
          stock.code,
          stock.name,
          0.8,
          new Map([[IndicatorField.ROE, 0.8]]),
          new Map([[IndicatorField.ROE, stock.roe]]),
          []
        )
      );
    },
  };

  describe("create", () => {
    it("应该成功创建有效的策略", () => {
      const strategy = ScreeningStrategy.create({
        name: "高ROE策略",
        description: "筛选ROE>15%的股票",
        filters: createValidFilterGroup(),
        scoringConfig: createValidScoringConfig(),
        userId: "user123",
      });

      expect(strategy.name).toBe("高ROE策略");
      expect(strategy.description).toBe("筛选ROE>15%的股票");
      expect(strategy.userId).toBe("user123");
      expect(strategy.isTemplate).toBe(false);
      expect(strategy.tags).toEqual([]);
    });

    it("应该拒绝空名称", () => {
      expect(() =>
        ScreeningStrategy.create({
          name: "",
          filters: createValidFilterGroup(),
          scoringConfig: createValidScoringConfig(),
          userId: "user123",
        })
      ).toThrow(InvalidStrategyError);

      expect(() =>
        ScreeningStrategy.create({
          name: "   ",
          filters: createValidFilterGroup(),
          scoringConfig: createValidScoringConfig(),
          userId: "user123",
        })
      ).toThrow(InvalidStrategyError);
    });

    it("应该拒绝没有条件的 FilterGroup", () => {
      const emptyFilterGroup = FilterGroup.create(LogicalOperator.AND, [], []);

      expect(() =>
        ScreeningStrategy.create({
          name: "测试策略",
          filters: emptyFilterGroup,
          scoringConfig: createValidScoringConfig(),
          userId: "user123",
        })
      ).toThrow(InvalidStrategyError);
    });

    it("应该拒绝权重之和不为 1.0 的 ScoringConfig", () => {
      // ScoringConfig.create 会在创建时验证，所以这里测试会在 ScoringConfig 层面失败
      expect(() =>
        ScoringConfig.create(
          new Map([
            [IndicatorField.ROE, 0.5],
            [IndicatorField.PE, 0.4], // 总和 0.9，不等于 1.0
          ]),
          NormalizationMethod.MIN_MAX
        )
      ).toThrow();
    });
  });

  describe("update", () => {
    it("应该成功更新策略", () => {
      const strategy = ScreeningStrategy.create({
        name: "原始策略",
        filters: createValidFilterGroup(),
        scoringConfig: createValidScoringConfig(),
        userId: "user123",
      });

      const newFilterGroup = FilterGroup.create(
        LogicalOperator.OR,
        [createValidFilterCondition()],
        []
      );

      strategy.update({
        name: "更新后的策略",
        description: "新描述",
        filters: newFilterGroup,
        tags: ["标签1", "标签2"],
      });

      expect(strategy.name).toBe("更新后的策略");
      expect(strategy.description).toBe("新描述");
      expect(strategy.filters.operator).toBe(LogicalOperator.OR);
      expect(strategy.tags).toEqual(["标签1", "标签2"]);
    });

    it("更新后应该重新验证不变量", () => {
      const strategy = ScreeningStrategy.create({
        name: "原始策略",
        filters: createValidFilterGroup(),
        scoringConfig: createValidScoringConfig(),
        userId: "user123",
      });

      expect(() =>
        strategy.update({
          name: "",
        })
      ).toThrow(InvalidStrategyError);

      expect(() =>
        strategy.update({
          filters: FilterGroup.create(LogicalOperator.AND, [], []),
        })
      ).toThrow(InvalidStrategyError);
    });
  });

  describe("markAsTemplate", () => {
    it("应该成功标记为模板", () => {
      const strategy = ScreeningStrategy.create({
        name: "测试策略",
        filters: createValidFilterGroup(),
        scoringConfig: createValidScoringConfig(),
        userId: "user123",
      });

      expect(strategy.isTemplate).toBe(false);

      strategy.markAsTemplate();

      expect(strategy.isTemplate).toBe(true);
    });
  });

  describe("cloneWithModifications", () => {
    it("应该成功克隆策略", () => {
      const originalStrategy = ScreeningStrategy.create({
        name: "原始策略",
        description: "原始描述",
        filters: createValidFilterGroup(),
        scoringConfig: createValidScoringConfig(),
        tags: ["标签1"],
        userId: "user123",
      });

      const clonedStrategy = originalStrategy.cloneWithModifications(
        "克隆策略",
        "user456"
      );

      expect(clonedStrategy.name).toBe("克隆策略");
      expect(clonedStrategy.description).toBe("原始描述");
      expect(clonedStrategy.userId).toBe("user456");
      expect(clonedStrategy.isTemplate).toBe(false);
      expect(clonedStrategy.id).not.toBe(originalStrategy.id);
    });

    it("克隆应该深拷贝 FilterGroup", () => {
      const originalStrategy = ScreeningStrategy.create({
        name: "原始策略",
        filters: createValidFilterGroup(),
        scoringConfig: createValidScoringConfig(),
        userId: "user123",
      });

      const clonedStrategy = originalStrategy.cloneWithModifications(
        "克隆策略",
        "user456"
      );

      // 修改克隆策略的 filters
      const newFilterGroup = FilterGroup.create(
        LogicalOperator.OR,
        [createValidFilterCondition()],
        []
      );
      clonedStrategy.update({ filters: newFilterGroup });

      // 原始策略的 filters 应该不受影响
      expect(originalStrategy.filters.operator).toBe(LogicalOperator.AND);
      expect(clonedStrategy.filters.operator).toBe(LogicalOperator.OR);
    });

    it("克隆应该深拷贝 ScoringConfig", () => {
      const originalStrategy = ScreeningStrategy.create({
        name: "原始策略",
        filters: createValidFilterGroup(),
        scoringConfig: createValidScoringConfig(),
        userId: "user123",
      });

      const clonedStrategy = originalStrategy.cloneWithModifications(
        "克隆策略",
        "user456"
      );

      // 修改克隆策略的 scoringConfig
      const newScoringConfig = ScoringConfig.create(
        new Map([[IndicatorField.ROE, 1.0]]),
        NormalizationMethod.MIN_MAX
      );
      clonedStrategy.update({ scoringConfig: newScoringConfig });

      // 原始策略的 scoringConfig 应该不受影响
      expect(originalStrategy.scoringConfig.size()).toBe(2);
      expect(clonedStrategy.scoringConfig.size()).toBe(1);
    });

    it("应该支持克隆时修改参数", () => {
      const originalStrategy = ScreeningStrategy.create({
        name: "原始策略",
        description: "原始描述",
        filters: createValidFilterGroup(),
        scoringConfig: createValidScoringConfig(),
        userId: "user123",
      });

      const clonedStrategy = originalStrategy.cloneWithModifications(
        "克隆策略",
        "user456",
        {
          description: "修改后的描述",
          tags: ["新标签"],
        }
      );

      expect(clonedStrategy.description).toBe("修改后的描述");
      expect(clonedStrategy.tags).toEqual(["新标签"]);
    });
  });

  describe("execute", () => {
    it("应该成功执行筛选流程", () => {
      const strategy = ScreeningStrategy.create({
        name: "高ROE策略",
        filters: createValidFilterGroup(),
        scoringConfig: createValidScoringConfig(),
        userId: "user123",
      });

      const candidateStocks = [
        new Stock({
          code: StockCode.create("600519"),
          name: "贵州茅台",
          industry: "白酒",
          sector: "主板",
          roe: 0.28,
          pe: 35.5,
        }),
        new Stock({
          code: StockCode.create("000858"),
          name: "五粮液",
          industry: "白酒",
          sector: "主板",
          roe: 0.18,
          pe: 28.0,
        }),
        new Stock({
          code: StockCode.create("000001"),
          name: "平安银行",
          industry: "银行",
          sector: "主板",
          roe: 0.10, // 不满足 ROE > 0.15
          pe: 8.5,
        }),
      ];

      const result = strategy.execute(
        candidateStocks,
        mockScoringService,
        mockCalcService
      );

      expect(result.totalScanned).toBe(3);
      expect(result.getMatchedCount()).toBe(2); // 只有贵州茅台和五粮液满足条件
      expect(result.executionTime).toBeGreaterThan(0);
    });

    it("执行结果应该按评分降序排列", () => {
      const strategy = ScreeningStrategy.create({
        name: "测试策略",
        filters: createValidFilterGroup(),
        scoringConfig: createValidScoringConfig(),
        userId: "user123",
      });

      // Mock 评分服务返回不同评分
      const customScoringService: IScoringService = {
        scoreStocks: (stocks) => {
          return stocks.map((stock, index) =>
            ScoredStock.create(
              stock.code,
              stock.name,
              0.9 - index * 0.1, // 递减评分
              new Map(),
              new Map(),
              []
            )
          );
        },
      };

      const candidateStocks = [
        new Stock({
          code: StockCode.create("600519"),
          name: "股票1",
          industry: "行业1",
          sector: "主板",
          roe: 0.20,
        }),
        new Stock({
          code: StockCode.create("000858"),
          name: "股票2",
          industry: "行业2",
          sector: "主板",
          roe: 0.18,
        }),
      ];

      const result = strategy.execute(
        candidateStocks,
        customScoringService,
        mockCalcService
      );

      const scores = result.matchedStocks.map((s) => s.score);
      for (let i = 0; i < scores.length - 1; i++) {
        expect(scores[i]!).toBeGreaterThanOrEqual(scores[i + 1]!);
      }
    });
  });

  describe("序列化", () => {
    it("应该正确序列化和反序列化", () => {
      const originalStrategy = ScreeningStrategy.create({
        name: "测试策略",
        description: "测试描述",
        filters: createValidFilterGroup(),
        scoringConfig: createValidScoringConfig(),
        tags: ["标签1", "标签2"],
        isTemplate: true,
        userId: "user123",
      });

      const dict = originalStrategy.toDict();
      const restoredStrategy = ScreeningStrategy.fromDict(dict);

      expect(restoredStrategy.id).toBe(originalStrategy.id);
      expect(restoredStrategy.name).toBe(originalStrategy.name);
      expect(restoredStrategy.description).toBe(originalStrategy.description);
      expect(restoredStrategy.userId).toBe(originalStrategy.userId);
      expect(restoredStrategy.isTemplate).toBe(originalStrategy.isTemplate);
      expect(restoredStrategy.tags).toEqual(originalStrategy.tags);
    });
  });

  describe("equals", () => {
    it("应该正确判断相等性", () => {
      const strategy1 = ScreeningStrategy.create({
        name: "策略1",
        filters: createValidFilterGroup(),
        scoringConfig: createValidScoringConfig(),
        userId: "user123",
      });

      const strategy2 = ScreeningStrategy.create({
        name: "策略2",
        filters: createValidFilterGroup(),
        scoringConfig: createValidScoringConfig(),
        userId: "user123",
      });

      expect(strategy1.equals(strategy1)).toBe(true);
      expect(strategy1.equals(strategy2)).toBe(false);
      expect(strategy1.equals(null)).toBe(false);
      expect(strategy1.equals(undefined)).toBe(false);
    });
  });
});

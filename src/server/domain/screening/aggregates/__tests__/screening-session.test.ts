/**
 * ScreeningSession 聚合根单元测试
 */

import { describe, it, expect } from "vitest";
import { ScreeningSession } from "../screening-session.js";
import { ScreeningResult } from "../../value-objects/screening-result.js";
import { ScoredStock } from "../../value-objects/scored-stock.js";
import { StockCode } from "../../value-objects/stock-code.js";
import { FilterGroup } from "../../entities/filter-group.js";
import { FilterCondition } from "../../value-objects/filter-condition.js";
import { ScoringConfig, NormalizationMethod } from "../../value-objects/scoring-config.js";
import { IndicatorField } from "../../enums/indicator-field.js";
import { ComparisonOperator } from "../../enums/comparison-operator.js";
import { LogicalOperator } from "../../enums/logical-operator.js";

describe("ScreeningSession", () => {
  function createScoredStock(code: string, name: string, score: number): ScoredStock {
    return ScoredStock.create(
      StockCode.create(code),
      name,
      score,
      new Map([[IndicatorField.ROE, score]]),
      new Map([[IndicatorField.ROE, score * 0.3]]),
      []
    );
  }

  function createTestFilterGroup(): FilterGroup {
    const condition = FilterCondition.create(
      IndicatorField.ROE,
      ComparisonOperator.GREATER_THAN,
      { type: "numeric", value: 0.15 }
    );
    return FilterGroup.create(LogicalOperator.AND, [condition], []);
  }

  function createTestScoringConfig(): ScoringConfig {
    return ScoringConfig.create(
      new Map([[IndicatorField.ROE, 1.0]]),
      NormalizationMethod.MIN_MAX
    );
  }

  describe("create", () => {
    it("应该创建包含少于 50 只股票的会话", () => {
      const stocks = [
        createScoredStock("600519", "贵州茅台", 0.9),
        createScoredStock("000858", "五粮液", 0.8),
        createScoredStock("000333", "美的集团", 0.7),
      ];

      const result = ScreeningResult.create(stocks, 5000, 1250.5);
      const session = ScreeningSession.create({
        strategyId: "strategy-1",
        strategyName: "高 ROE 策略",
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
      });

      expect(session.topStocks).toHaveLength(3);
      expect(session.otherStockCodes).toHaveLength(0);
      expect(session.countMatched()).toBe(3);
    });

    it("应该创建包含超过 50 只股票的会话（分层存储）", () => {
      const stocks: ScoredStock[] = [];
      for (let i = 0; i < 60; i++) {
        const code = `60${String(i).padStart(4, "0")}`;
        stocks.push(createScoredStock(code, `股票${i}`, 0.9 - i * 0.01));
      }

      const result = ScreeningResult.create(stocks, 5000, 1250.5);
      const session = ScreeningSession.create({
        strategyId: "strategy-1",
        strategyName: "高 ROE 策略",
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
      });

      expect(session.topStocks).toHaveLength(50);
      expect(session.otherStockCodes).toHaveLength(10);
      expect(session.countMatched()).toBe(60);
    });
  });

  describe("getAllMatchedCodes", () => {
    it("应该返回所有匹配股票的代码", () => {
      const stocks: ScoredStock[] = [];
      for (let i = 0; i < 55; i++) {
        const code = `60${String(i).padStart(4, "0")}`;
        stocks.push(createScoredStock(code, `股票${i}`, 0.9 - i * 0.01));
      }

      const result = ScreeningResult.create(stocks, 5000, 1250.5);
      const session = ScreeningSession.create({
        strategyId: "strategy-1",
        strategyName: "测试策略",
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
      });

      const allCodes = session.getAllMatchedCodes();
      expect(allCodes).toHaveLength(55);
    });
  });

  describe("getStockDetail", () => {
    it("应该返回前 50 只股票的详细信息", () => {
      const stocks: ScoredStock[] = [];
      for (let i = 0; i < 60; i++) {
        const code = `60${String(i).padStart(4, "0")}`;
        stocks.push(createScoredStock(code, `股票${i}`, 0.9 - i * 0.01));
      }

      const result = ScreeningResult.create(stocks, 5000, 1250.5);
      const session = ScreeningSession.create({
        strategyId: "strategy-1",
        strategyName: "测试策略",
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
      });

      const detail0 = session.getStockDetail(StockCode.create("600000"));
      expect(detail0).not.toBeNull();
      expect(detail0?.stockName).toBe("股票0");
    });

    it("应该对超过前 50 只的股票返回 null", () => {
      const stocks: ScoredStock[] = [];
      for (let i = 0; i < 60; i++) {
        const code = `60${String(i).padStart(4, "0")}`;
        stocks.push(createScoredStock(code, `股票${i}`, 0.9 - i * 0.01));
      }

      const result = ScreeningResult.create(stocks, 5000, 1250.5);
      const session = ScreeningSession.create({
        strategyId: "strategy-1",
        strategyName: "测试策略",
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
      });

      const detail50 = session.getStockDetail(StockCode.create("600050"));
      expect(detail50).toBeNull();
    });
  });

  describe("序列化", () => {
    it("应该正确序列化和反序列化", () => {
      const stocks = [
        createScoredStock("600519", "贵州茅台", 0.9),
        createScoredStock("000858", "五粮液", 0.8),
      ];

      const result = ScreeningResult.create(stocks, 5000, 1250.5);
      const session = ScreeningSession.create({
        strategyId: "strategy-1",
        strategyName: "高 ROE 策略",
        result,
        filtersSnapshot: createTestFilterGroup(),
        scoringConfigSnapshot: createTestScoringConfig(),
      });

      const dict = session.toDict();
      const restored = ScreeningSession.fromDict(dict);

      expect(restored.id).toBe(session.id);
      expect(restored.strategyId).toBe(session.strategyId);
      expect(restored.countMatched()).toBe(2);
    });
  });
});

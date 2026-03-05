/**
 * ScoringService 单元测试
 *
 * 测试评分服务的核心功能：
 * - MIN_MAX 归一化
 * - 加权求和
 * - 缺失值处理
 * - 边界情况
 */

import { describe, it, expect, vi } from "vitest";
import { ScoringService } from "../scoring-service";
import { Stock } from "../../entities/stock";
import { StockCode } from "../../value-objects/stock-code";
import { ScoringConfig } from "../../value-objects/scoring-config";
import { IndicatorField } from "../../enums/indicator-field";
import type { IIndicatorCalculationService } from "../indicator-calculation-service";

describe("ScoringService", () => {
  // 创建 mock 指标计算服务
  const createMockCalcService = (
    mockValues: Map<Stock, Map<IndicatorField, number | string | null>>
  ): IIndicatorCalculationService => {
    return {
      calculateIndicator: vi.fn(),
      calculateBatch: vi.fn(async (fields: IndicatorField[], stock: Stock) => {
        const stockValues = mockValues.get(stock);
        if (!stockValues) {
          return new Map();
        }
        const result = new Map<IndicatorField, number | string | null>();
        for (const field of fields) {
          result.set(field, stockValues.get(field) ?? null);
        }
        return result;
      }),
      validateDerivedIndicator: vi.fn(),
    };
  };

  describe("scoreStocks", () => {
    it("应该对股票列表进行评分并按降序排列", async () => {
      // 准备测试数据
      const stock1 = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        roe: 0.3,
        pe: 40,
      });

      const stock2 = new Stock({
        code: StockCode.create("000858"),
        name: "五粮液",
        industry: "白酒",
        sector: "主板",
        roe: 0.2,
        pe: 30,
      });

      const stock3 = new Stock({
        code: StockCode.create("000333"),
        name: "美的集团",
        industry: "家电",
        sector: "主板",
        roe: 0.25,
        pe: 20,
      });

      const stocks = [stock1, stock2, stock3];

      // Mock 指标值
      const mockValues = new Map([
        [stock1, new Map([[IndicatorField.ROE, 0.3], [IndicatorField.PE, 40]])],
        [stock2, new Map([[IndicatorField.ROE, 0.2], [IndicatorField.PE, 30]])],
        [stock3, new Map([[IndicatorField.ROE, 0.25], [IndicatorField.PE, 20]])],
      ]);

      const calcService = createMockCalcService(mockValues);

      // 评分配置：ROE 权重 0.6，PE 权重 0.4
      const config = ScoringConfig.create(
        new Map([
          [IndicatorField.ROE, 0.6],
          [IndicatorField.PE, 0.4],
        ])
      );

      const service = new ScoringService();
      const result = await service.scoreStocks(stocks, config, calcService);

      // 验证结果
      expect(result).toHaveLength(3);

      // 验证按评分降序排列
      expect(result[0]!.score).toBeGreaterThanOrEqual(result[1]!.score);
      expect(result[1]!.score).toBeGreaterThanOrEqual(result[2]!.score);

      // 验证评分在 [0, 1] 区间
      for (const scored of result) {
        expect(scored.score).toBeGreaterThanOrEqual(0);
        expect(scored.score).toBeLessThanOrEqual(1);
      }

      // 验证 scoreBreakdown 在 [0, 1] 区间
      for (const scored of result) {
        for (const breakdownScore of scored.scoreBreakdown.values()) {
          expect(breakdownScore).toBeGreaterThanOrEqual(0);
          expect(breakdownScore).toBeLessThanOrEqual(1);
        }
      }
    });

    it("应该正确处理缺失指标值（归一化得分为 0）", async () => {
      const stock1 = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        roe: 0.3,
        pe: 40,
      });

      const stock2 = new Stock({
        code: StockCode.create("000858"),
        name: "五粮液",
        industry: "白酒",
        sector: "主板",
        roe: null, // 缺失 ROE
        pe: 30,
      });

      const stocks = [stock1, stock2];

      // Mock 指标值
      const mockValues = new Map([
        [stock1, new Map([[IndicatorField.ROE, 0.3], [IndicatorField.PE, 40]])],
        [stock2, new Map([[IndicatorField.ROE, null], [IndicatorField.PE, 30]])],
      ]);

      const calcService = createMockCalcService(mockValues);

      const config = ScoringConfig.create(
        new Map([
          [IndicatorField.ROE, 0.6],
          [IndicatorField.PE, 0.4],
        ])
      );

      const service = new ScoringService();
      const result = await service.scoreStocks(stocks, config, calcService);

      // stock2 的 ROE 缺失，归一化得分应为 0
      const stock2Scored = result.find((s) => s.stockCode.equals(stock2.code));
      expect(stock2Scored).toBeDefined();
      expect(stock2Scored!.getBreakdownScore(IndicatorField.ROE)).toBe(0);

      // stock2 的总分应该只来自 PE 的贡献（0.4 权重）
      // PE: stock2=30, stock1=40, 归一化: (30-30)/(40-30) = 0
      // 总分 = 0 * 0.6 + 0 * 0.4 = 0
      expect(stock2Scored!.score).toBe(0);
    });

    it("应该正确处理所有值相同的情况（归一化得分为 1）", async () => {
      const stock1 = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        roe: 0.3,
      });

      const stock2 = new Stock({
        code: StockCode.create("000858"),
        name: "五粮液",
        industry: "白酒",
        sector: "主板",
        roe: 0.3,
      });

      const stocks = [stock1, stock2];

      // Mock 指标值（所有 ROE 都是 0.3）
      const mockValues = new Map([
        [stock1, new Map([[IndicatorField.ROE, 0.3]])],
        [stock2, new Map([[IndicatorField.ROE, 0.3]])],
      ]);

      const calcService = createMockCalcService(mockValues);

      const config = ScoringConfig.create(
        new Map([[IndicatorField.ROE, 1.0]])
      );

      const service = new ScoringService();
      const result = await service.scoreStocks(stocks, config, calcService);

      // 所有股票的 ROE 相同，归一化得分应为 1
      for (const scored of result) {
        expect(scored.getBreakdownScore(IndicatorField.ROE)).toBe(1);
        expect(scored.score).toBe(1);
      }
    });

    it("应该正确处理空股票列表", async () => {
      const calcService = createMockCalcService(new Map());
      const config = ScoringConfig.create(
        new Map([[IndicatorField.ROE, 1.0]])
      );

      const service = new ScoringService();
      const result = await service.scoreStocks([], config, calcService);

      expect(result).toEqual([]);
    });

    it("应该正确计算 MIN_MAX 归一化", async () => {
      // 测试归一化公式：(value - min) / (max - min)
      const stock1 = new Stock({
        code: StockCode.create("600519"),
        name: "股票1",
        industry: "行业",
        sector: "主板",
        roe: 0.1, // min
      });

      const stock2 = new Stock({
        code: StockCode.create("000858"),
        name: "股票2",
        industry: "行业",
        sector: "主板",
        roe: 0.3, // max
      });

      const stock3 = new Stock({
        code: StockCode.create("000333"),
        name: "股票3",
        industry: "行业",
        sector: "主板",
        roe: 0.2, // mid
      });

      const stocks = [stock1, stock2, stock3];

      const mockValues = new Map([
        [stock1, new Map([[IndicatorField.ROE, 0.1]])],
        [stock2, new Map([[IndicatorField.ROE, 0.3]])],
        [stock3, new Map([[IndicatorField.ROE, 0.2]])],
      ]);

      const calcService = createMockCalcService(mockValues);

      const config = ScoringConfig.create(
        new Map([[IndicatorField.ROE, 1.0]])
      );

      const service = new ScoringService();
      const result = await service.scoreStocks(stocks, config, calcService);

      // 验证归一化结果
      const scored1 = result.find((s) => s.stockCode.equals(stock1.code))!;
      const scored2 = result.find((s) => s.stockCode.equals(stock2.code))!;
      const scored3 = result.find((s) => s.stockCode.equals(stock3.code))!;

      // stock1: (0.1 - 0.1) / (0.3 - 0.1) = 0 / 0.2 = 0
      expect(scored1.score).toBeCloseTo(0, 5);

      // stock2: (0.3 - 0.1) / (0.3 - 0.1) = 0.2 / 0.2 = 1
      expect(scored2.score).toBeCloseTo(1, 5);

      // stock3: (0.2 - 0.1) / (0.3 - 0.1) = 0.1 / 0.2 = 0.5
      expect(scored3.score).toBeCloseTo(0.5, 5);
    });

    it("应该正确计算加权求和", async () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "测试股票",
        industry: "行业",
        sector: "主板",
        roe: 0.3,
        pe: 40,
      });

      const stocks = [stock];

      const mockValues = new Map([
        [stock, new Map([[IndicatorField.ROE, 0.3], [IndicatorField.PE, 40]])],
      ]);

      const calcService = createMockCalcService(mockValues);

      // ROE 权重 0.7，PE 权重 0.3
      const config = ScoringConfig.create(
        new Map([
          [IndicatorField.ROE, 0.7],
          [IndicatorField.PE, 0.3],
        ])
      );

      const service = new ScoringService();
      const result = await service.scoreStocks(stocks, config, calcService);

      // 只有一只股票，所有指标归一化得分都是 1（max === min）
      // 总分 = 1 * 0.7 + 1 * 0.3 = 1
      expect(result[0]!.score).toBe(1);
      expect(result[0]!.getBreakdownScore(IndicatorField.ROE)).toBe(1);
      expect(result[0]!.getBreakdownScore(IndicatorField.PE)).toBe(1);
    });

    it("应该在 indicatorValues 中保存原始指标值", async () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        roe: 0.28,
        pe: 35.5,
      });

      const stocks = [stock];

      const mockValues = new Map([
        [stock, new Map([[IndicatorField.ROE, 0.28], [IndicatorField.PE, 35.5]])],
      ]);

      const calcService = createMockCalcService(mockValues);

      const config = ScoringConfig.create(
        new Map([
          [IndicatorField.ROE, 0.6],
          [IndicatorField.PE, 0.4],
        ])
      );

      const service = new ScoringService();
      const result = await service.scoreStocks(stocks, config, calcService);

      // 验证原始指标值被保存
      expect(result[0]!.getIndicatorValue(IndicatorField.ROE)).toBe(0.28);
      expect(result[0]!.getIndicatorValue(IndicatorField.PE)).toBe(35.5);
    });
  });
});

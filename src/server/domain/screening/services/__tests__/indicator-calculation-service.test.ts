/**
 * IIndicatorCalculationService 单元测试
 *
 * 测试指标计算服务的核心功能：
 * - BASIC 指标：直接从 Stock 获取
 * - TIME_SERIES 指标：从历史数据计算
 * - DERIVED 指标：使用公式计算
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  IndicatorCalculationService,
  type IIndicatorCalculationService,
} from "../indicator-calculation-service";
import type { IHistoricalDataProvider } from "../../repositories/historical-data-provider";
import { Stock } from "../../entities/stock";
import { StockCode } from "../../value-objects/stock-code";
import { IndicatorField } from "../../enums/indicator-field";

describe("IndicatorCalculationService", () => {
  let service: IIndicatorCalculationService;
  let mockHistoricalDataProvider: IHistoricalDataProvider;

  beforeEach(() => {
    // 创建 mock 历史数据提供者
    mockHistoricalDataProvider = {
      getIndicatorHistory: vi.fn(),
    };

    service = new IndicatorCalculationService(mockHistoricalDataProvider);
  });

  describe("BASIC 指标计算", () => {
    it("应该从 Stock 实体直接获取基础指标值", async () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        roe: 0.28,
        pe: 35.5,
        pb: 10.2,
      });

      const roe = await service.calculateIndicator(IndicatorField.ROE, stock);
      const pe = await service.calculateIndicator(IndicatorField.PE, stock);
      const industry = await service.calculateIndicator(
        IndicatorField.INDUSTRY,
        stock
      );

      expect(roe).toBe(0.28);
      expect(pe).toBe(35.5);
      expect(industry).toBe("白酒");
    });

    it("应该对缺失的基础指标返回 null", async () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        // roe 未设置
      });

      const roe = await service.calculateIndicator(IndicatorField.ROE, stock);
      expect(roe).toBeNull();
    });
  });

  describe("TIME_SERIES 指标计算", () => {
    it("应该计算 3 年营收复合增长率（CAGR）", async () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
      });

      // Mock 历史数据：3 年营收从 1000 增长到 1331（年增长率 10%）
      vi.mocked(mockHistoricalDataProvider.getIndicatorHistory).mockResolvedValue([
        { date: new Date("2021-12-31"), value: 1000, isEstimated: false },
        { date: new Date("2022-12-31"), value: 1100, isEstimated: false },
        { date: new Date("2023-12-31"), value: 1210, isEstimated: false },
        { date: new Date("2024-12-31"), value: 1331, isEstimated: false },
      ]);

      const cagr = await service.calculateIndicator(
        IndicatorField.REVENUE_CAGR_3Y,
        stock
      );

      expect(cagr).toBeCloseTo(0.1, 2); // 10% CAGR
      expect(mockHistoricalDataProvider.getIndicatorHistory).toHaveBeenCalledWith(
        stock.code,
        IndicatorField.REVENUE,
        3
      );
    });

    it("应该计算 3 年 ROE 平均值", async () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
      });

      // Mock 历史数据：3 年 ROE 分别为 0.25, 0.28, 0.30
      vi.mocked(mockHistoricalDataProvider.getIndicatorHistory).mockResolvedValue([
        { date: new Date("2021-12-31"), value: 0.25, isEstimated: false },
        { date: new Date("2022-12-31"), value: 0.28, isEstimated: false },
        { date: new Date("2023-12-31"), value: 0.3, isEstimated: false },
      ]);

      const avgRoe = await service.calculateIndicator(
        IndicatorField.ROE_AVG_3Y,
        stock
      );

      expect(avgRoe).toBeCloseTo(0.2767, 2); // (0.25 + 0.28 + 0.30) / 3
    });

    it("应该在历史数据不足时返回 null", async () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
      });

      // Mock 历史数据不足（需要 4 个数据点，只有 2 个）
      vi.mocked(mockHistoricalDataProvider.getIndicatorHistory).mockResolvedValue([
        { date: new Date("2022-12-31"), value: 1100, isEstimated: false },
        { date: new Date("2023-12-31"), value: 1210, isEstimated: false },
      ]);

      const cagr = await service.calculateIndicator(
        IndicatorField.REVENUE_CAGR_3Y,
        stock
      );

      expect(cagr).toBeNull();
    });

    it("应该在起始值为 0 或负数时返回 null", async () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
      });

      // Mock 历史数据：起始值为 0
      vi.mocked(mockHistoricalDataProvider.getIndicatorHistory).mockResolvedValue([
        { date: new Date("2021-12-31"), value: 0, isEstimated: false },
        { date: new Date("2022-12-31"), value: 1100, isEstimated: false },
        { date: new Date("2023-12-31"), value: 1210, isEstimated: false },
        { date: new Date("2024-12-31"), value: 1331, isEstimated: false },
      ]);

      const cagr = await service.calculateIndicator(
        IndicatorField.REVENUE_CAGR_3Y,
        stock
      );

      expect(cagr).toBeNull();
    });
  });

  describe("DERIVED 指标计算", () => {
    it("应该计算 PEG（使用 PE / (ROE × 100) 简化公式）", async () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        pe: 35.5,
        roe: 0.28,
      });

      const peg = await service.calculateIndicator(IndicatorField.PEG, stock);

      // PEG = 35.5 / (0.28 × 100) = 35.5 / 28 ≈ 1.268
      expect(peg).toBeCloseTo(1.268, 2);
    });

    it("应该在 PE 或 ROE 缺失时返回 null", async () => {
      const stockNoPE = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        roe: 0.28,
        // pe 未设置
      });

      const stockNoROE = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        pe: 35.5,
        // roe 未设置
      });

      const peg1 = await service.calculateIndicator(
        IndicatorField.PEG,
        stockNoPE
      );
      const peg2 = await service.calculateIndicator(
        IndicatorField.PEG,
        stockNoROE
      );

      expect(peg1).toBeNull();
      expect(peg2).toBeNull();
    });

    it("应该计算 ROE 与负债率之差", async () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        roe: 0.28,
        debtRatio: 0.15,
      });

      const diff = await service.calculateIndicator(
        IndicatorField.ROE_MINUS_DEBT,
        stock
      );

      expect(diff).toBeCloseTo(0.13, 2); // 0.28 - 0.15 = 0.13
    });

    it("应该在 ROE 或负债率缺失时返回 null", async () => {
      const stockNoROE = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        debtRatio: 0.15,
        // roe 未设置
      });

      const stockNoDebt = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        roe: 0.28,
        // debtRatio 未设置
      });

      const diff1 = await service.calculateIndicator(
        IndicatorField.ROE_MINUS_DEBT,
        stockNoROE
      );
      const diff2 = await service.calculateIndicator(
        IndicatorField.ROE_MINUS_DEBT,
        stockNoDebt
      );

      expect(diff1).toBeNull();
      expect(diff2).toBeNull();
    });
  });

  describe("批量计算", () => {
    it("应该批量计算多个指标", async () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        roe: 0.28,
        pe: 35.5,
        debtRatio: 0.15,
      });

      const indicators = [
        IndicatorField.ROE,
        IndicatorField.PE,
        IndicatorField.ROE_MINUS_DEBT,
      ];

      const values = await service.calculateBatch(indicators, stock);

      expect(values.size).toBe(3);
      expect(values.get(IndicatorField.ROE)).toBe(0.28);
      expect(values.get(IndicatorField.PE)).toBe(35.5);
      expect(values.get(IndicatorField.ROE_MINUS_DEBT)).toBeCloseTo(0.13, 2);
    });

    it("应该对缺失的指标返回 null", async () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        roe: 0.28,
        // pe 和 debtRatio 未设置
      });

      const indicators = [
        IndicatorField.ROE,
        IndicatorField.PE,
        IndicatorField.ROE_MINUS_DEBT,
      ];

      const values = await service.calculateBatch(indicators, stock);

      expect(values.size).toBe(3);
      expect(values.get(IndicatorField.ROE)).toBe(0.28);
      expect(values.get(IndicatorField.PE)).toBeNull();
      expect(values.get(IndicatorField.ROE_MINUS_DEBT)).toBeNull();
    });
  });

  describe("验证衍生指标", () => {
    it("应该验证衍生指标可计算", () => {
      const result1 = service.validateDerivedIndicator(IndicatorField.PEG);
      const result2 = service.validateDerivedIndicator(
        IndicatorField.ROE_MINUS_DEBT
      );

      expect(result1.valid).toBe(true);
      expect(result2.valid).toBe(true);
    });

    it("应该拒绝非衍生指标", () => {
      const result = service.validateDerivedIndicator(IndicatorField.ROE);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain("不是衍生指标");
    });
  });
});

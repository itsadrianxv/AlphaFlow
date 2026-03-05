import { describe, it, expect } from "vitest";
import { Stock } from "../stock";
import { StockCode } from "../../value-objects/stock-code";
import { IndicatorField } from "../../enums/indicator-field";

describe("Stock 实体", () => {
  describe("构造函数", () => {
    it("应该正确创建 Stock 实例", () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        roe: 0.28,
        pe: 35.5,
        pb: 10.2,
        marketCap: 21000.0,
      });

      expect(stock.code.value).toBe("600519");
      expect(stock.name).toBe("贵州茅台");
      expect(stock.industry).toBe("白酒");
      expect(stock.sector).toBe("主板");
      expect(stock.roe).toBe(0.28);
      expect(stock.pe).toBe(35.5);
      expect(stock.pb).toBe(10.2);
      expect(stock.marketCap).toBe(21000.0);
    });

    it("应该将未提供的指标设为 null", () => {
      const stock = new Stock({
        code: StockCode.create("000001"),
        name: "平安银行",
        industry: "银行",
        sector: "主板",
      });

      expect(stock.roe).toBeNull();
      expect(stock.pe).toBeNull();
      expect(stock.pb).toBeNull();
      expect(stock.eps).toBeNull();
      expect(stock.revenue).toBeNull();
      expect(stock.netProfit).toBeNull();
      expect(stock.debtRatio).toBeNull();
      expect(stock.marketCap).toBeNull();
      expect(stock.floatMarketCap).toBeNull();
      expect(stock.dataDate).toBeNull();
    });
  });

  describe("getValue", () => {
    const stock = new Stock({
      code: StockCode.create("600519"),
      name: "贵州茅台",
      industry: "白酒",
      sector: "主板",
      roe: 0.28,
      pe: 35.5,
      pb: 10.2,
      eps: 50.3,
      revenue: 1275.5,
      netProfit: 620.8,
      debtRatio: 0.25,
      marketCap: 21000.0,
      floatMarketCap: 20500.0,
    });

    it("应该返回数值型基础指标", () => {
      expect(stock.getValue(IndicatorField.ROE)).toBe(0.28);
      expect(stock.getValue(IndicatorField.PE)).toBe(35.5);
      expect(stock.getValue(IndicatorField.PB)).toBe(10.2);
      expect(stock.getValue(IndicatorField.EPS)).toBe(50.3);
      expect(stock.getValue(IndicatorField.REVENUE)).toBe(1275.5);
      expect(stock.getValue(IndicatorField.NET_PROFIT)).toBe(620.8);
      expect(stock.getValue(IndicatorField.DEBT_RATIO)).toBe(0.25);
      expect(stock.getValue(IndicatorField.MARKET_CAP)).toBe(21000.0);
      expect(stock.getValue(IndicatorField.FLOAT_MARKET_CAP)).toBe(20500.0);
    });

    it("应该返回文本型基础指标", () => {
      expect(stock.getValue(IndicatorField.INDUSTRY)).toBe("白酒");
      expect(stock.getValue(IndicatorField.SECTOR)).toBe("主板");
    });

    it("应该对缺失的指标返回 null", () => {
      const stockWithMissingData = new Stock({
        code: StockCode.create("000001"),
        name: "平安银行",
        industry: "银行",
        sector: "主板",
      });

      expect(stockWithMissingData.getValue(IndicatorField.ROE)).toBeNull();
      expect(stockWithMissingData.getValue(IndicatorField.PE)).toBeNull();
    });

    it("应该对时间序列指标返回 null", () => {
      expect(stock.getValue(IndicatorField.REVENUE_CAGR_3Y)).toBeNull();
      expect(stock.getValue(IndicatorField.NET_PROFIT_CAGR_3Y)).toBeNull();
      expect(stock.getValue(IndicatorField.ROE_AVG_3Y)).toBeNull();
    });

    it("应该对衍生指标返回 null", () => {
      expect(stock.getValue(IndicatorField.PEG)).toBeNull();
      expect(stock.getValue(IndicatorField.ROE_MINUS_DEBT)).toBeNull();
    });
  });

  describe("equals", () => {
    it("应该判断两个相同代码的股票相等", () => {
      const stock1 = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
      });

      const stock2 = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台（不同名称）",
        industry: "白酒",
        sector: "主板",
      });

      expect(stock1.equals(stock2)).toBe(true);
    });

    it("应该判断不同代码的股票不相等", () => {
      const stock1 = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
      });

      const stock2 = new Stock({
        code: StockCode.create("000001"),
        name: "平安银行",
        industry: "银行",
        sector: "主板",
      });

      expect(stock1.equals(stock2)).toBe(false);
    });

    it("应该对 null 和 undefined 返回 false", () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
      });

      expect(stock.equals(null)).toBe(false);
      expect(stock.equals(undefined)).toBe(false);
    });
  });

  describe("toString", () => {
    it("应该返回正确的字符串表示", () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
      });

      expect(stock.toString()).toBe("600519 贵州茅台");
    });
  });

  describe("序列化", () => {
    it("应该正确序列化为字典", () => {
      const stock = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        roe: 0.28,
        pe: 35.5,
        dataDate: new Date("2024-01-15"),
      });

      const dict = stock.toDict();

      expect(dict.code).toBe("600519");
      expect(dict.name).toBe("贵州茅台");
      expect(dict.industry).toBe("白酒");
      expect(dict.sector).toBe("主板");
      expect(dict.roe).toBe(0.28);
      expect(dict.pe).toBe(35.5);
      expect(dict.dataDate).toBe("2024-01-15T00:00:00.000Z");
    });

    it("应该正确反序列化", () => {
      const dict = {
        code: "600519",
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        roe: 0.28,
        pe: 35.5,
        pb: null,
        dataDate: "2024-01-15T00:00:00.000Z",
      };

      const stock = Stock.fromDict(dict);

      expect(stock.code.value).toBe("600519");
      expect(stock.name).toBe("贵州茅台");
      expect(stock.industry).toBe("白酒");
      expect(stock.sector).toBe("主板");
      expect(stock.roe).toBe(0.28);
      expect(stock.pe).toBe(35.5);
      expect(stock.pb).toBeNull();
      expect(stock.dataDate).toEqual(new Date("2024-01-15T00:00:00.000Z"));
    });

    it("序列化后反序列化应该保持一致", () => {
      const original = new Stock({
        code: StockCode.create("600519"),
        name: "贵州茅台",
        industry: "白酒",
        sector: "主板",
        roe: 0.28,
        pe: 35.5,
        pb: 10.2,
        eps: 50.3,
        revenue: 1275.5,
        netProfit: 620.8,
        debtRatio: 0.25,
        marketCap: 21000.0,
        floatMarketCap: 20500.0,
        dataDate: new Date("2024-01-15"),
      });

      const dict = original.toDict();
      const restored = Stock.fromDict(dict);

      expect(restored.code.equals(original.code)).toBe(true);
      expect(restored.name).toBe(original.name);
      expect(restored.industry).toBe(original.industry);
      expect(restored.sector).toBe(original.sector);
      expect(restored.roe).toBe(original.roe);
      expect(restored.pe).toBe(original.pe);
      expect(restored.pb).toBe(original.pb);
      expect(restored.eps).toBe(original.eps);
      expect(restored.revenue).toBe(original.revenue);
      expect(restored.netProfit).toBe(original.netProfit);
      expect(restored.debtRatio).toBe(original.debtRatio);
      expect(restored.marketCap).toBe(original.marketCap);
      expect(restored.floatMarketCap).toBe(original.floatMarketCap);
      expect(restored.dataDate).toEqual(original.dataDate);
    });
  });
});

import { describe, expect, it } from "vitest";
import { PortfolioRiskDiagnosticService } from "~/server/application/timing/portfolio-risk-diagnostic-service";
import type { PortfolioCompositionPosition, TimingSignalData } from "~/server/domain/timing/types";

const positions: PortfolioCompositionPosition[] = [
  { stockCode: "000001", stockName: "甲", weightPct: 50, sector: "银行", themes: ["红利"] },
  { stockCode: "000002", stockName: "乙", weightPct: 30, sector: "银行", themes: ["红利"] },
  { stockCode: "000003", stockName: "丙", weightPct: 20, sector: "科技", themes: ["算力"] },
];

function signal(stockCode: string, drift: number, amount?: number): TimingSignalData {
  const bars = Array.from({ length: 61 }, (_, index) => {
    const close = 10 * (1 + drift * index + Math.sin(index / 3) * 0.002);
    return { tradeDate: `2026-05-${String(index + 1).padStart(2, "0")}`, open: close, high: close * 1.01, low: close * 0.99, close, volume: 1000 + index, amount, turnoverRate: amount === undefined ? undefined : 1 + index / 100 };
  });
  return {
    stockCode, stockName: stockCode, asOfDate: "2026-07-28", barsCount: bars.length, bars, barsByTimeframe: { DAILY: bars },
    indicators: { close: 10, ema5: 10, ema20: 10, ema60: 10, ema120: 10, atr14: 0.1, volumeRatio20: 1, realizedVol20: 0.2, realizedVol120: 0.2, macd: { dif: 0, dea: 0, histogram: 0 }, rsi: { value: 50 }, bollinger: { upper: 11, middle: 10, lower: 9, closePosition: 0.5 }, obv: { value: 1, slope: 0 } },
    signalContext: { engines: [], composite: { score: 0, confidence: 0, direction: "neutral", signalStrength: 0, participatingEngines: 0 } },
  };
}

describe("组合风险诊断", () => {
  it("计算集中度、暴露、相关矩阵和波动贡献", () => {
    const result = new PortfolioRiskDiagnosticService().build({ positions, signals: [signal("000001", 0.001, 10_000), signal("000002", 0.001, 50_000), signal("000003", -0.0004, 100_000)], asOfDate: "2026-07-28" });
    expect(result.concentration).toMatchObject({ top1Pct: 50, top3Pct: 100, hhi: 0.38 });
    expect(result.exposures.sectors[0]).toEqual({ name: "银行", weightPct: 80 });
    expect(result.correlation.matrix).toHaveLength(3);
    expect(result.correlation.matrix[0]?.[0]).toBe(1);
    expect(result.correlation.clusters.some((cluster) => cluster.stockCodes.includes("000001") && cluster.stockCodes.includes("000002"))).toBe(true);
    expect(result.volatility.annualizedPct).not.toBeNull();
    expect(result.volatility.contributions).toHaveLength(3);
  });

  it("输出流动性分位和五种固定压力情景", () => {
    const result = new PortfolioRiskDiagnosticService().build({ positions, signals: [signal("000001", 0.001, 10_000), signal("000002", 0.001, 50_000), signal("000003", -0.0004)], asOfDate: "2026-07-28" });
    expect(result.liquidity.items.map((item) => item.level)).toEqual(["LOW", "HIGH", "UNAVAILABLE"]);
    expect(result.scenarios.map((item) => item.id)).toEqual(["MARKET_DOWN_5", "LARGEST_SECTOR_DOWN_8", "TOP_HOLDING_DOWN_10", "VOLATILITY_UP_50", "LIQUIDITY_DOWN_50"]);
    expect(result.scenarios.every((item) => item.disclaimer === "压力假设，不代表发生概率或投资建议。")).toBe(true);
  });

  it("行情缺失时对相关性、波动和流动性降级", () => {
    const result = new PortfolioRiskDiagnosticService().build({ positions, signals: [], asOfDate: "2026-07-28" });
    expect(result.volatility.annualizedPct).toBeNull();
    expect(result.correlation.matrix.flat().every((item) => item === null)).toBe(true);
    expect(result.liquidity.items.every((item) => item.level === "UNAVAILABLE")).toBe(true);
    expect(result.dataQuality.warnings.length).toBeGreaterThan(0);
  });
});

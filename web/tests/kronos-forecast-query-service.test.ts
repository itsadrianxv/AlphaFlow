import { describe, expect, it, vi } from "vitest";
import { KronosForecastQueryService } from "~/server/application/timing/kronos-forecast-query-service";
import type {
  TimingBar,
  TimingKronosForecast,
} from "~/server/domain/timing/types";

function buildBars(count: number): TimingBar[] {
  return Array.from({ length: count }, (_, index) => ({
    tradeDate: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
    open: 10 + index,
    high: 11 + index,
    low: 9 + index,
    close: 10.5 + index,
    volume: 1_000 + index,
  }));
}

function buildForecast(): TimingKronosForecast {
  return {
    stockCode: "002475",
    timeframe: "WEEKLY",
    asOfDate: "2026-07-24",
    modelName: "NeoQuasar/Kronos-base",
    modelVersion: "base",
    lookbackBars: 120,
    predictionLength: 12,
    device: "cpu",
    points: [],
    summary: {
      expectedReturnPct: 1,
      maxDrawdownPct: -2,
      upsidePct: 3,
      volatilityProxy: 0.2,
      direction: "bullish",
      confidence: 0.7,
    },
    warnings: [],
  };
}

describe("KronosForecastQueryService", () => {
  it("使用当前周期 K 线和统一预测长度请求 Kronos", async () => {
    const bars = buildBars(120);
    const getBars = vi.fn().mockResolvedValue({
      stockCode: "002475",
      stockName: "立讯精密",
      timeframe: "WEEKLY",
      adjust: "qfq",
      bars,
    });
    const forecast = buildForecast();
    const forecastBatch = vi.fn().mockResolvedValue({
      items: [forecast],
      errors: [],
    });
    const service = new KronosForecastQueryService({
      timingDataClient: { getBars },
      kronosClient: { forecastBatch },
    });

    await expect(
      service.getForecast({ stockCode: "002475", timeframe: "WEEKLY" }),
    ).resolves.toEqual({ forecast, warnings: [] });
    expect(getBars).toHaveBeenCalledWith({
      stockCode: "002475",
      timeframe: "WEEKLY",
      adjust: "qfq",
    });
    expect(forecastBatch).toHaveBeenCalledWith({
      items: [{ stockCode: "002475", timeframe: "WEEKLY", bars }],
      predictionLength: 12,
    });
  });

  it("历史不足时不调用 Kronos，并返回可展示的降级告警", async () => {
    const forecastBatch = vi.fn();
    const service = new KronosForecastQueryService({
      timingDataClient: {
        getBars: vi.fn().mockResolvedValue({
          stockCode: "002475",
          stockName: "立讯精密",
          timeframe: "MONTHLY",
          adjust: "qfq",
          bars: buildBars(119),
        }),
      },
      kronosClient: { forecastBatch },
    });

    const result = await service.getForecast({
      stockCode: "002475",
      timeframe: "MONTHLY",
    });

    expect(result.forecast).toBeNull();
    expect(result.warnings[0]).toContain("至少需要 120 根 K 线");
    expect(forecastBatch).not.toHaveBeenCalled();
  });

  it("Kronos 服务失败时不影响 K 线查询", async () => {
    const service = new KronosForecastQueryService({
      timingDataClient: {
        getBars: vi.fn().mockResolvedValue({
          stockCode: "002475",
          stockName: "立讯精密",
          timeframe: "DAILY",
          adjust: "qfq",
          bars: buildBars(120),
        }),
      },
      kronosClient: {
        forecastBatch: vi.fn().mockRejectedValue(new Error("timeout")),
      },
    });

    const result = await service.getForecast({
      stockCode: "002475",
      timeframe: "DAILY",
    });

    expect(result.forecast).toBeNull();
    expect(result.warnings).toEqual(["Kronos 预测暂不可用：timeout"]);
  });
});

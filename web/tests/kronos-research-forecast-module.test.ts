import { describe, expect, it, vi } from "vitest";
import { KronosResearchForecastModule } from "~/server/application/timing/kronos-research-forecast-module";
import type {
  TimingBar,
  TimingKronosForecast,
  TimingSignalSnapshotRecord,
} from "~/server/domain/timing/types";

function bars(count: number): TimingBar[] {
  return Array.from({ length: count }, (_, index) => ({
    tradeDate: `2026-01-${String(index + 1).padStart(2, "0")}`,
    open: 10 + index,
    high: 11 + index,
    low: 9 + index,
    close: 10.5 + index,
    volume: 1_000 + index,
    amount: 10_000 + index,
  }));
}

function signalSnapshot(stockCode: string, dailyBars: TimingBar[]): TimingSignalSnapshotRecord {
  return {
    id: `signal-${stockCode}`,
    userId: "user-1",
    stockCode,
    stockName: `股票${stockCode}`,
    asOfDate: "2026-07-28",
    sourceType: "single",
    sourceId: "run-1",
    timeframe: "DAILY",
    barsCount: dailyBars.length,
    bars: dailyBars,
    barsByTimeframe: { DAILY: dailyBars },
    indicators: {} as never,
    signalContext: { engines: [], composite: { score: 0, confidence: 0, direction: "neutral", signalStrength: 0, participatingEngines: 0 } },
    createdAt: new Date("2026-07-28T00:00:00.000Z"),
  };
}

function forecast(stockCode: string): TimingKronosForecast {
  return {
    stockCode,
    timeframe: "DAILY",
    asOfDate: "2026-07-28",
    modelName: "Kronos-base",
    modelVersion: "1.0",
    lookbackBars: 120,
    predictionLength: 60,
    device: "cpu",
    points: [],
    summary: { expectedReturnPct: 6, maxDrawdownPct: -4, upsidePct: 8, volatilityProxy: 2, direction: "bullish", confidence: 0.8 },
    warnings: [],
  };
}

describe("Kronos 研究预测模块", () => {
  it("按周期批量预测并冻结持久化快照", async () => {
    const forecastBatch = vi.fn(async ({ items }: { items: Array<{ stockCode: string; bars: TimingBar[] }> }) => ({
      items: items.map((item) => forecast(item.stockCode)),
      errors: [],
    }));
    const upsert = vi.fn(async (input: { stockCode: string; forecast: TimingKronosForecast }) => ({
      id: `forecast-${input.stockCode}`,
      forecast: input.forecast,
    }));
    const module = new KronosResearchForecastModule({ client: { forecastBatch }, snapshotRepository: { upsert } as never });

    const result = await module.generateForResearchRun({
      userId: "user-1",
      sourceType: "single",
      sourceId: "run-1", researchRunId: "research-run-1",
      signalSnapshots: [signalSnapshot("000001", bars(130)), signalSnapshot("000002", bars(120))],
      requestedTimeframes: ["DAILY"],
    });

    expect(forecastBatch).toHaveBeenCalledTimes(1);
    expect(forecastBatch.mock.calls[0]?.[0].items.map((item) => item.bars)).toEqual([bars(120).map((_, index) => bars(130)[index + 10]), bars(120)]);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(result.forecastsByStock.get("000001")?.DAILY?.snapshotId).toBe("forecast-000001");
    expect(result.evidenceByStock.get("000001")?.status).toBe("AVAILABLE");
  });

  it("历史不足时不调用模型并返回结构化原因", async () => {
    const forecastBatch = vi.fn();
    const module = new KronosResearchForecastModule({ client: { forecastBatch }, snapshotRepository: { upsert: vi.fn() } as never });

    const result = await module.generateForResearchRun({
      userId: "user-1",
      sourceType: "single",
      sourceId: "run-1", researchRunId: "research-run-1",
      signalSnapshots: [signalSnapshot("000001", bars(119))],
      requestedTimeframes: ["DAILY"],
    });

    expect(forecastBatch).not.toHaveBeenCalled();
    expect(result.evidenceByStock.get("000001")).toMatchObject({ status: "INSUFFICIENT_HISTORY", inputBars: 119 });
  });

  it("批量部分失败时保留成功快照并归类失败股票", async () => {
    const forecastBatch = vi.fn(async () => ({
      items: [forecast("000001")],
      errors: [{ stockCode: "000002", timeframe: "DAILY" as const, code: "service_unavailable", message: "模型服务繁忙" }],
    }));
    const module = new KronosResearchForecastModule({
      client: { forecastBatch },
      snapshotRepository: { upsert: vi.fn(async (input: { forecast: TimingKronosForecast }) => ({ id: "forecast-1", forecast: input.forecast })) } as never,
    });

    const result = await module.generateForResearchRun({
      userId: "user-1", sourceType: "single", sourceId: "run-1", researchRunId: "research-run-1",
      signalSnapshots: [signalSnapshot("000001", bars(120)), signalSnapshot("000002", bars(120))],
      requestedTimeframes: ["DAILY"],
    });

    expect(result.evidenceByStock.get("000001")?.status).toBe("AVAILABLE");
    expect(result.evidenceByStock.get("000002")).toMatchObject({ status: "SERVICE_UNAVAILABLE", retryable: true });
  });

  it("日线成功后中期失败不会覆盖已有可用预测", async () => {
    const forecastBatch = vi.fn()
      .mockResolvedValueOnce({ items: [forecast("000001")], errors: [] })
      .mockResolvedValueOnce({ items: [], errors: [{ stockCode: "000001", timeframe: "WEEKLY", code: "service_unavailable", message: "周线服务繁忙" }] });
    const module = new KronosResearchForecastModule({
      client: { forecastBatch },
      snapshotRepository: { upsert: vi.fn(async (input: { forecast: TimingKronosForecast }) => ({ id: "daily-1", forecast: input.forecast })) } as never,
    });
    const snapshot = signalSnapshot("000001", bars(120));
    snapshot.barsByTimeframe = { DAILY: bars(120), WEEKLY: bars(120) };

    const result = await module.generateForResearchRun({
      userId: "user-1", sourceType: "single", sourceId: "run-1", researchRunId: "research-run-1", signalSnapshots: [snapshot], requestedTimeframes: ["DAILY", "WEEKLY"],
    });

    expect(result.forecastsByStock.get("000001")?.DAILY?.snapshotId).toBe("daily-1");
    expect(result.evidenceByStock.get("000001")?.status).toBe("AVAILABLE");
    expect(result.evidenceByStock.get("000001")?.message).toContain("周线服务繁忙");
  });
});

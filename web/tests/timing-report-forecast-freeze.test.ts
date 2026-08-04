import { describe, expect, it, vi } from "vitest";
import { TimingReportService } from "~/server/application/timing/timing-report-service";
import type { TimingKronosForecast, TimingResearchReportRecord } from "~/server/domain/timing/types";

function frozenForecast(timeframe: "DAILY" | "WEEKLY", expectedReturnPct: number): TimingKronosForecast {
  return {
    stockCode: "000001",
    timeframe,
    asOfDate: "2026-07-28",
    modelName: "Kronos-base",
    modelVersion: "frozen-v1",
    lookbackBars: 120,
    predictionLength: timeframe === "DAILY" ? 60 : 12,
    device: "cpu",
    points: [],
    summary: { expectedReturnPct, maxDrawdownPct: -3, upsidePct: 8, volatilityProxy: 2, direction: "bullish", confidence: 0.8 },
    warnings: [],
  };
}

function report(): TimingResearchReportRecord {
  const daily = frozenForecast("DAILY", 6);
  const weekly = frozenForecast("WEEKLY", 4);
  return {
    id: "report-1", userId: "user-1", stockCode: "000001", stockName: "平安银行", asOfDate: "2026-07-28",
    sourceType: "single", sourceId: "run-1", signalSnapshotId: "signal-1", researchState: "CONFIRMED", trendState: "UP_TREND",
    confidence: 0.8, summary: "冻结报告", dimensions: [], observationConditions: [],
    dataCompleteness: { status: "COMPLETE", available: 1, total: 1, missing: [], warnings: [] },
    modelOutlook: daily,
    modelEvidence: { status: "AVAILABLE", inputBars: 120, requestedTimeframes: ["DAILY", "WEEKLY"], availableTimeframes: ["DAILY", "WEEKLY"], message: "已冻结", retryable: false, alignment: "CONFIRMING", timeframeConsistency: "CONSISTENT", confidenceAdjustment: 0.08, timeframeResults: {} },
    forecastSnapshots: [{ snapshotId: "daily-1", forecast: daily }, { snapshotId: "weekly-1", forecast: weekly }],
    riskFlags: [], reasoning: { indicators: {} as never, engineBreakdown: [], dataManifest: [], featureEvidence: [], inputHash: "input" },
    ruleAudit: {} as never, createdAt: new Date(), updatedAt: new Date(),
    signalSnapshot: { id: "signal-1", userId: "user-1", stockCode: "000001", stockName: "平安银行", asOfDate: "2026-07-28", sourceType: "single", sourceId: "run-1", timeframe: "DAILY", barsCount: 0, bars: [], barsByTimeframe: { WEEKLY: [] }, indicators: {} as never, signalContext: { engines: [], composite: {} as never }, createdAt: new Date() },
  };
}

describe("择时报告冻结预测", () => {
  it("报告与周期序列只读取本报告关联的预测快照", async () => {
    const service = new TimingReportService({
      researchReportRepository: { getByIdForUser: vi.fn(async () => report()) },
      signalSnapshotRepository: { updateFrozenBars: vi.fn() },
      marketContextSnapshotRepository: { getByAsOfDate: vi.fn(async () => null) },
      timingDataClient: { getBars: vi.fn(async () => ({ bars: [], stockCode: "000001", stockName: "平安银行", timeframe: "DAILY" as const, adjust: "qfq" })) },
    });

    const payload = await service.getTimingReport({ userId: "user-1", reportId: "report-1" });
    const weekly = await service.getTimingSeries({ userId: "user-1", reportId: "report-1", timeframe: "WEEKLY" });

    expect(payload?.modelOutlook?.modelVersion).toBe("frozen-v1");
    expect(payload?.modelOutlook?.summary.expectedReturnPct).toBe(6);
    expect(weekly?.modelOutlook?.summary.expectedReturnPct).toBe(4);
  });
});

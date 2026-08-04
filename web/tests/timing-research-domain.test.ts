import { describe, expect, it } from "vitest";
import { TimingAnalysisService } from "~/server/application/timing/timing-analysis-service";
import { synthesizeTimingResearchWithModel } from "~/server/domain/timing/services/timing-model-synthesis";
import { evaluateTimingResearchRules } from "~/server/domain/timing/services/timing-rule-engine";
import type { TimingFeatureEvidence, TimingResearchRuleConfig, TimingSignalData } from "~/server/domain/timing/types";

const config: TimingResearchRuleConfig = {
  schemaVersion: 3,
  setup: "TREND_CONTINUATION",
  timeframePlan: { template: "SWING", contextTimeframes: ["WEEKLY"], primaryTimeframe: "DAILY" },
  signalEngineWeights: {},
  dataPolicy: { asOfMode: "LATEST_COMPLETE", requiredMissing: "DATA_INCOMPLETE", unfinishedHigherTimeframe: "OBSERVATION_ONLY" },
  ruleGroups: [
    { role: "CORE", minSatisfied: 1, rules: [{ id: "core", name: "趋势", indicatorId: "trend", role: "CORE", timeframe: "DAILY", operator: ">", threshold: 0, confirmationBars: 1, required: true, explanation: "趋势证据", enabled: true }] },
    { role: "CONFIRMATION", minSatisfied: 1, rules: [{ id: "confirm", name: "动量", indicatorId: "momentum", role: "CONFIRMATION", timeframe: "DAILY", operator: ">", threshold: 0, confirmationBars: 1, required: true, explanation: "动量证据", enabled: true }] },
    { role: "RISK_OBSERVATION", minSatisfied: 0, rules: [{ id: "risk", name: "结构风险", indicatorId: "risk", role: "RISK_OBSERVATION", timeframe: "DAILY", operator: "==", threshold: true, confirmationBars: 1, required: false, severity: "CRITICAL", explanation: "风险证据", enabled: true }] },
  ],
};

const features: TimingFeatureEvidence[] = [
  { indicatorId: "trend", timeframe: "DAILY", value: 1, asOfDate: "2026-07-28", source: "test", status: "AVAILABLE" },
  { indicatorId: "momentum", timeframe: "DAILY", value: 1, asOfDate: "2026-07-28", source: "test", status: "AVAILABLE" },
  { indicatorId: "risk", timeframe: "DAILY", value: false, asOfDate: "2026-07-28", source: "test", status: "AVAILABLE" },
];

function signal(): TimingSignalData {
  const keys = ["multiTimeframeAlignment", "relativeStrength", "volatilityPercentile", "liquidityStructure", "breakoutFailure", "gapVolumeQuality"] as const;
  return {
    stockCode: "000001", stockName: "平安银行", asOfDate: "2026-07-28", barsCount: 120,
    indicators: { close: 12, ema5: 11.8, ema20: 11, ema60: 10, ema120: 9, atr14: 0.3, volumeRatio20: 1.2, realizedVol20: 0.2, realizedVol120: 0.18, macd: { dif: 0.2, dea: 0.1, histogram: 0.1 }, rsi: { value: 58 }, bollinger: { upper: 13, middle: 11, lower: 9, closePosition: 0.7 }, obv: { value: 100, slope: 1 } },
    signalContext: { engines: keys.map((key) => ({ key, label: key, direction: "bullish", score: 30, confidence: 0.8, weight: 1 / 6, detail: `${key} 证据`, metrics: {}, warnings: [] })), composite: { score: 30, confidence: 0.8, direction: "bullish", signalStrength: 30, participatingEngines: 6 } },
  };
}

describe("择时研究领域", () => {
  it("模型偏多不能把技术证据不足的研究升级为已确认", () => {
    const result = synthesizeTimingResearchWithModel({
      technicalState: "FORMING",
      technicalConfidence: 0.62,
      technicalDirection: "bullish",
      forecasts: { DAILY: { snapshotId: "forecast-1", forecast: { summary: { direction: "bullish", confidence: 0.9, expectedReturnPct: 8, maxDrawdownPct: -3 } } as never } },
    });
    expect(result.researchState).toBe("FORMING");
    expect(result.confidence).toBe(0.7);
    expect(result.evidence.alignment).toBe("CONFIRMING");
  });

  it("模型与已确认技术结构明显冲突时降级并降低置信度", () => {
    const result = synthesizeTimingResearchWithModel({
      technicalState: "CONFIRMED",
      technicalConfidence: 0.8,
      technicalDirection: "bullish",
      forecasts: { DAILY: { snapshotId: "forecast-1", forecast: { summary: { direction: "bearish", confidence: 0.8, expectedReturnPct: -6, maxDrawdownPct: -12 } } as never } },
    });
    expect(result.researchState).toBe("FORMING");
    expect(result.confidence).toBe(0.65);
    expect(result.evidence.alignment).toBe("CONFLICTING");
  });

  it("日线与中期模型方向分歧时明确记录周期不一致", () => {
    const result = synthesizeTimingResearchWithModel({
      technicalState: "CONFIRMED",
      technicalConfidence: 0.8,
      technicalDirection: "bullish",
      forecasts: {
        DAILY: { snapshotId: "daily", forecast: { summary: { direction: "bullish", confidence: 0.8, expectedReturnPct: 6, maxDrawdownPct: -4 } } as never },
        WEEKLY: { snapshotId: "weekly", forecast: { summary: { direction: "bearish" } } as never },
      },
    });
    expect(result.evidence.timeframeConsistency).toBe("DIVERGENT");
    expect(result.evidence.message).toContain("日线与中期模型方向存在分歧");
  });

  it("技术偏空而模型明显偏多时同样视为冲突", () => {
    const result = synthesizeTimingResearchWithModel({
      technicalState: "CONFIRMED",
      technicalConfidence: 0.8,
      technicalDirection: "bearish",
      forecasts: { DAILY: { snapshotId: "daily", forecast: { summary: { direction: "bullish", confidence: 0.8, expectedReturnPct: 6, maxDrawdownPct: -2 } } as never } },
    });
    expect(result.researchState).toBe("FORMING");
    expect(result.evidence.alignment).toBe("CONFLICTING");
  });

  it("缺失必选证据时降级为数据不完整", () => {
    expect(evaluateTimingResearchRules({ config, features: features.slice(0, 1) }).researchState).toBe("DATA_INCOMPLETE");
  });

  it("生成六类技术维度和纯观察条件", () => {
    const assessment = new TimingAnalysisService().buildTechnicalAssessments([signal()])[0];
    expect(assessment?.dimensions.map((item) => item.key)).toEqual(["multiTimeframe", "momentumTrend", "priceVolume", "relativeStrength", "volatility", "liquidity"]);
    expect(assessment?.observationConditions.every((item) => ["CONFIRMATION", "CHANGE", "RISK"].includes(item.kind))).toBe(true);
  });
});

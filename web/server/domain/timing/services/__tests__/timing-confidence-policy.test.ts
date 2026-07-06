import { describe, expect, it } from "vitest";
import { TimingConfidencePolicy } from "~/server/domain/timing/services/timing-confidence-policy";

describe("TimingConfidencePolicy", () => {
  it("gives higher confidence to aligned bullish factors", () => {
    const policy = new TimingConfidencePolicy();

    const confidence = policy.calculate({
      direction: "bullish",
      signalStrength: 78,
      factorBreakdown: [
        {
          key: "multiTimeframeAlignment",
          label: "多周期一致性",
          status: "positive",
          score: 18,
          confidence: 0.9,
          weight: 0.24,
          detail: "ok",
        },
        {
          key: "relativeStrength",
          label: "相对强弱",
          status: "positive",
          score: 16,
          confidence: 0.85,
          weight: 0.2,
          detail: "ok",
        },
        {
          key: "liquidityStructure",
          label: "流动性",
          status: "positive",
          score: 12,
          confidence: 0.8,
          weight: 0.14,
          detail: "ok",
        },
        {
          key: "volatilityPercentile",
          label: "波动率分位",
          status: "neutral",
          score: 0,
          confidence: 0.5,
          weight: 0.14,
          detail: "ok",
        },
      ],
      riskFlags: [],
    });

    expect(confidence).toBeGreaterThanOrEqual(68);
  });

  it("penalizes multiple risk flags", () => {
    const policy = new TimingConfidencePolicy();

    const base = policy.calculate({
      direction: "bullish",
      signalStrength: 72,
      factorBreakdown: [
        {
          key: "multiTimeframeAlignment",
          label: "多周期一致性",
          status: "positive",
          score: 18,
          confidence: 0.9,
          weight: 0.24,
          detail: "ok",
        },
        {
          key: "relativeStrength",
          label: "相对强弱",
          status: "positive",
          score: 16,
          confidence: 0.85,
          weight: 0.2,
          detail: "ok",
        },
      ],
      riskFlags: [],
    });
    const penalized = policy.calculate({
      direction: "bullish",
      signalStrength: 72,
      factorBreakdown: [
        {
          key: "multiTimeframeAlignment",
          label: "多周期一致性",
          status: "positive",
          score: 18,
          confidence: 0.9,
          weight: 0.24,
          detail: "ok",
        },
        {
          key: "relativeStrength",
          label: "相对强弱",
          status: "positive",
          score: 16,
          confidence: 0.85,
          weight: 0.2,
          detail: "ok",
        },
      ],
      riskFlags: ["HIGH_VOLATILITY", "TREND_WEAKENING"],
    });

    expect(penalized).toBeLessThan(base);
  });
});

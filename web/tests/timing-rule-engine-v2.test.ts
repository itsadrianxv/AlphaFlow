import { describe, expect, it } from "vitest";

import { evaluateTimingRules } from "~/server/domain/timing/services/timing-rule-engine";
import { createTimingPresetConfigV2 } from "~/server/domain/timing/strategy-v2";
import type {
  TimingFeatureEvidence,
  TimingPresetConfigV2,
} from "~/server/domain/timing/types";

function evidence(
  indicatorId: string,
  timeframe: TimingFeatureEvidence["timeframe"],
  value: TimingFeatureEvidence["value"],
  consecutiveBars = 1,
): TimingFeatureEvidence {
  return {
    indicatorId,
    timeframe,
    value,
    consecutiveBars,
    asOfDate: "2026-07-23",
    source: "test",
    status: "AVAILABLE",
  };
}

function trendFeatures(): TimingFeatureEvidence[] {
  return [
    evidence("trend.close_above_ema20", "WEEKLY", true),
    evidence("trend.close_above_ema20", "DAILY", true, 2),
    evidence("trend.ema20_above_ema60", "DAILY", true, 2),
    evidence("trend.adx", "DAILY", 24),
    evidence("relative_strength.return_20d", "DAILY", 3.2),
    evidence("momentum.macd_histogram", "DAILY", -0.1),
    evidence("trend.close_below_ema60", "DAILY", false, 2),
    evidence("market.tradable", "DAILY", true),
  ];
}

describe("择时v2确定性规则引擎", () => {
  it("主判据和确认法定数满足后生成候选股建仓动作", () => {
    const result = evaluateTimingRules({
      config: createTimingPresetConfigV2("TREND_CONTINUATION"),
      features: trendFeatures(),
      marketState: "RISK_ON",
      hasPosition: false,
    });

    expect(result.status).toBe("TRIGGERED");
    expect(result.potentialAction).toBe("ENTER");
    expect(result.finalAction).toBe("ENTER");
    expect(result.ruleEvaluations).toHaveLength(8);
  });

  it("NEUTRAL市场把建仓降级为试仓并留下门控记录", () => {
    const result = evaluateTimingRules({
      config: createTimingPresetConfigV2("TREND_CONTINUATION"),
      features: trendFeatures(),
      marketState: "NEUTRAL",
      hasPosition: false,
    });

    expect(result.finalAction).toBe("PROBE");
    expect(result.gateTrace).toContain("市场状态为NEUTRAL，ENTER降级为PROBE。");
  });

  it("主判据缺失时不产生动作", () => {
    const features = trendFeatures().filter(
      (item) =>
        !(
          item.indicatorId === "trend.close_above_ema20" &&
          item.timeframe === "WEEKLY"
        ),
    );
    const result = evaluateTimingRules({
      config: createTimingPresetConfigV2("TREND_CONTINUATION"),
      features,
      marketState: "RISK_ON",
      hasPosition: false,
    });

    expect(result.status).toBe("DATA_INCOMPLETE");
    expect(result.finalAction).toBeNull();
  });

  it("严重否决触发时已有持仓退出", () => {
    const features = trendFeatures().map((item) =>
      item.indicatorId === "trend.close_below_ema60"
        ? { ...item, value: true }
        : item,
    );
    const result = evaluateTimingRules({
      config: createTimingPresetConfigV2("TREND_CONTINUATION"),
      features,
      marketState: "RISK_ON",
      hasPosition: true,
    });

    expect(result.status).toBe("INVALIDATED");
    expect(result.finalAction).toBe("EXIT");
  });

  it("否决项缺失时阻止新增风险暴露", () => {
    const features = trendFeatures().filter(
      (item) => item.indicatorId !== "market.tradable",
    );
    const result = evaluateTimingRules({
      config: createTimingPresetConfigV2("TREND_CONTINUATION"),
      features,
      marketState: "RISK_ON",
      hasPosition: false,
    });

    expect(result.riskUnresolved).toBe(true);
    expect(result.potentialAction).toBe("ENTER");
    expect(result.finalAction).toBe("WATCH");
  });

  it("校验可覆盖的法定数和复盘周期", () => {
    const config = createTimingPresetConfigV2("BREAKOUT") as TimingPresetConfigV2;
    expect(config.reviewTradingDays).toEqual([5, 10, 20, 30]);
    expect(config.backtestPolicy).toMatchObject({
      minimumMonths: 24,
      minimumStocks: 5,
      minimumTriggeredEvents: 30,
      minimumPrimaryCompletenessPct: 95,
    });
  });
});

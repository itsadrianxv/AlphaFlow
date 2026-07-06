import { describe, expect, it } from "vitest";
import {
  formatTimingDirectionLabel,
  formatTimingMarketStateLabel,
  formatTimingMetricLabel,
  formatTimingSignalKeyLabel,
} from "~/app/timing/timing-labels";

describe("timing-labels", () => {
  it("formats core report labels in Chinese", () => {
    expect(formatTimingDirectionLabel("bullish")).toBe("看多");
    expect(formatTimingSignalKeyLabel("volatilityPercentile")).toBe("波动分位");
    expect(formatTimingMetricLabel("distanceTo60dHighPct")).toBe("距60日高点");
    expect(formatTimingMarketStateLabel("RISK_ON")).toBe("风险偏好");
    expect(formatTimingMetricLabel("stockReturn20d")).toBe("个股20日涨幅");
    expect(formatTimingMetricLabel("stockReturn60d")).toBe("个股60日涨幅");
    expect(formatTimingMetricLabel("atrRatio")).toBe("ATR 比率");
    expect(formatTimingMetricLabel("turnoverPercentile")).toBe("换手率分位");
    expect(formatTimingMetricLabel("sampleSize")).toBe("样本数");
  });

  it("falls back to the original value for unknown labels", () => {
    expect(formatTimingMetricLabel("unknownMetric")).toBe("unknownMetric");
  });
});

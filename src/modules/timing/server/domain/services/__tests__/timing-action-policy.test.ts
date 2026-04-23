import { describe, expect, it } from "vitest";
import { TimingActionPolicy } from "~/modules/timing/server/domain/services/timing-action-policy";

describe("TimingActionPolicy", () => {
  it("keeps stage one actions within WATCH/PROBE/ADD without portfolio context", () => {
    const policy = new TimingActionPolicy();

    expect(
      policy.decide({
        direction: "bearish",
        confidence: 88,
        signalStrength: 85,
        hasPortfolioContext: false,
      }),
    ).toBe("WATCH");
  });

  it("returns ADD when bullish conviction is strong", () => {
    const policy = new TimingActionPolicy();

    expect(
      policy.decide({
        direction: "bullish",
        confidence: 82,
        signalStrength: 76,
      }),
    ).toBe("ADD");
  });

  it("allows HOLD when portfolio context exists and signals are neutral", () => {
    const policy = new TimingActionPolicy();

    expect(
      policy.decide({
        direction: "neutral",
        confidence: 63,
        signalStrength: 58,
        hasPortfolioContext: true,
      }),
    ).toBe("HOLD");
  });
});

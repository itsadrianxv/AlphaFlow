import { describe, expect, it } from "vitest";
import { TimingReviewPolicy } from "~/server/domain/timing/services/timing-review-policy";
import type { TimingReviewRecord } from "~/server/domain/timing/types";

function createReviewRecord(
  overrides?: Partial<TimingReviewRecord>,
): TimingReviewRecord {
  return {
    id: "review-1",
    userId: "user-1",
    analysisCardId: "card-1",
    recommendationId: null,
    stockCode: "600519",
    stockName: "贵州茅台",
    sourceAsOfDate: "2026-03-01",
    reviewHorizon: "T10",
    scheduledAt: new Date("2026-03-15T00:00:00.000Z"),
    completedAt: null,
    expectedAction: "ADD",
    actualReturnPct: null,
    maxFavorableExcursionPct: null,
    maxAdverseExcursionPct: null,
    verdict: null,
    reviewSummary: null,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
    updatedAt: new Date("2026-03-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("TimingReviewPolicy", () => {
  it("marks bullish calls as success when return is positive and drawdown controlled", () => {
    const policy = new TimingReviewPolicy();
    const result = policy.evaluate({
      reviewRecord: createReviewRecord(),
      bars: [
        { close: 100, high: 101, low: 99 },
        { close: 105, high: 108, low: 100 },
      ],
      completedAt: new Date("2026-03-15T00:00:00.000Z"),
    });

    expect(result.actualReturnPct).toBe(5);
    expect(result.verdict).toBe("SUCCESS");
  });

  it("marks exit-style calls as success when price falls after the signal", () => {
    const policy = new TimingReviewPolicy();
    const result = policy.evaluate({
      reviewRecord: createReviewRecord({ expectedAction: "EXIT" }),
      bars: [
        { close: 100, high: 100, low: 99 },
        { close: 94, high: 96, low: 90 },
      ],
    });

    expect(result.actualReturnPct).toBe(-6);
    expect(result.verdict).toBe("SUCCESS");
  });
});

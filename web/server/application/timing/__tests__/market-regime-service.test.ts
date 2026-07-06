import { describe, expect, it } from "vitest";
import { MarketRegimeService } from "~/server/application/timing/market-regime-service";
import type { MarketContextSnapshot } from "~/server/domain/timing/types";

function buildSnapshot(
  overrides?: Partial<MarketContextSnapshot>,
): MarketContextSnapshot {
  return {
    asOfDate: "2026-03-06",
    indexes: [
      {
        code: "510300",
        name: "CSI 300 ETF",
        close: 4.1,
        changePct: 1.2,
        return5d: 3.5,
        return10d: 6.2,
        ema20: 4,
        ema60: 3.8,
        aboveEma20: true,
        aboveEma60: true,
        atrRatio: 0.02,
        signalDirection: "bullish",
      },
      {
        code: "510500",
        name: "CSI 500 ETF",
        close: 6.2,
        changePct: 0.9,
        return5d: 2.9,
        return10d: 5.4,
        ema20: 6,
        ema60: 5.7,
        aboveEma20: true,
        aboveEma60: true,
        atrRatio: 0.021,
        signalDirection: "bullish",
      },
    ],
    latestBreadth: {
      asOfDate: "2026-03-06",
      totalCount: 100,
      advancingCount: 68,
      decliningCount: 24,
      flatCount: 8,
      positiveRatio: 0.68,
      aboveThreePctRatio: 0.18,
      belowThreePctRatio: 0.04,
      medianChangePct: 1.1,
      averageTurnoverRate: 1.3,
    },
    latestVolatility: {
      asOfDate: "2026-03-06",
      highVolatilityCount: 8,
      highVolatilityRatio: 0.08,
      limitDownLikeCount: 0,
      indexAtrRatio: 0.022,
    },
    latestLeadership: {
      asOfDate: "2026-03-06",
      leaderCode: "510300",
      leaderName: "CSI 300 ETF",
      ranking5d: ["510300", "510500"],
      ranking10d: ["510300", "510500"],
      switched: false,
      previousLeaderCode: "510300",
    },
    breadthSeries: [
      {
        asOfDate: "2026-03-03",
        totalCount: 100,
        advancingCount: 55,
        decliningCount: 35,
        flatCount: 10,
        positiveRatio: 0.55,
        aboveThreePctRatio: 0.12,
        belowThreePctRatio: 0.07,
        medianChangePct: 0.4,
        averageTurnoverRate: 1.1,
      },
      {
        asOfDate: "2026-03-04",
        totalCount: 100,
        advancingCount: 60,
        decliningCount: 31,
        flatCount: 9,
        positiveRatio: 0.6,
        aboveThreePctRatio: 0.14,
        belowThreePctRatio: 0.06,
        medianChangePct: 0.6,
        averageTurnoverRate: 1.15,
      },
      {
        asOfDate: "2026-03-05",
        totalCount: 100,
        advancingCount: 63,
        decliningCount: 28,
        flatCount: 9,
        positiveRatio: 0.63,
        aboveThreePctRatio: 0.16,
        belowThreePctRatio: 0.05,
        medianChangePct: 0.8,
        averageTurnoverRate: 1.2,
      },
      {
        asOfDate: "2026-03-06",
        totalCount: 100,
        advancingCount: 68,
        decliningCount: 24,
        flatCount: 8,
        positiveRatio: 0.68,
        aboveThreePctRatio: 0.18,
        belowThreePctRatio: 0.04,
        medianChangePct: 1.1,
        averageTurnoverRate: 1.3,
      },
    ],
    volatilitySeries: [
      {
        asOfDate: "2026-03-03",
        highVolatilityCount: 18,
        highVolatilityRatio: 0.18,
        limitDownLikeCount: 1,
        indexAtrRatio: 0.026,
      },
      {
        asOfDate: "2026-03-04",
        highVolatilityCount: 15,
        highVolatilityRatio: 0.15,
        limitDownLikeCount: 1,
        indexAtrRatio: 0.024,
      },
      {
        asOfDate: "2026-03-05",
        highVolatilityCount: 11,
        highVolatilityRatio: 0.11,
        limitDownLikeCount: 0,
        indexAtrRatio: 0.023,
      },
      {
        asOfDate: "2026-03-06",
        highVolatilityCount: 8,
        highVolatilityRatio: 0.08,
        limitDownLikeCount: 0,
        indexAtrRatio: 0.022,
      },
    ],
    leadershipSeries: [
      {
        asOfDate: "2026-03-03",
        leaderCode: "510500",
        leaderName: "CSI 500 ETF",
        ranking5d: ["510500", "510300"],
        ranking10d: ["510500", "510300"],
        switched: false,
        previousLeaderCode: "510500",
      },
      {
        asOfDate: "2026-03-04",
        leaderCode: "510300",
        leaderName: "CSI 300 ETF",
        ranking5d: ["510300", "510500"],
        ranking10d: ["510300", "510500"],
        switched: true,
        previousLeaderCode: "510500",
      },
      {
        asOfDate: "2026-03-05",
        leaderCode: "510300",
        leaderName: "CSI 300 ETF",
        ranking5d: ["510300", "510500"],
        ranking10d: ["510300", "510500"],
        switched: false,
        previousLeaderCode: "510300",
      },
      {
        asOfDate: "2026-03-06",
        leaderCode: "510300",
        leaderName: "CSI 300 ETF",
        ranking5d: ["510300", "510500"],
        ranking10d: ["510300", "510500"],
        switched: false,
        previousLeaderCode: "510300",
      },
    ],
    features: {
      benchmarkStrength: 78,
      breadthScore: 72,
      riskScore: 22,
      stateScore: 75,
    },
    ...overrides,
  };
}

describe("MarketRegimeService", () => {
  it("classifies bullish breadth and trend as RISK_ON", () => {
    const service = new MarketRegimeService();

    const result = service.analyze(buildSnapshot());

    expect(result.state).toBe("RISK_ON");
    expect(result.transition).toBe("IMPROVING");
    expect(result.regimeConfidence).toBeGreaterThan(60);
  });

  it("classifies weak breadth and elevated volatility as RISK_OFF", () => {
    const service = new MarketRegimeService();

    const result = service.analyze(
      buildSnapshot({
        indexes: [
          {
            code: "510300",
            name: "CSI 300 ETF",
            close: 3.7,
            changePct: -1.8,
            return5d: -5.8,
            return10d: -8.4,
            ema20: 3.9,
            ema60: 4,
            aboveEma20: false,
            aboveEma60: false,
            atrRatio: 0.04,
            signalDirection: "bearish",
          },
        ],
        latestBreadth: {
          asOfDate: "2026-03-06",
          totalCount: 100,
          advancingCount: 28,
          decliningCount: 61,
          flatCount: 11,
          positiveRatio: 0.28,
          aboveThreePctRatio: 0.03,
          belowThreePctRatio: 0.16,
          medianChangePct: -1.5,
          averageTurnoverRate: 1.8,
        },
        latestVolatility: {
          asOfDate: "2026-03-06",
          highVolatilityCount: 34,
          highVolatilityRatio: 0.34,
          limitDownLikeCount: 4,
          indexAtrRatio: 0.04,
        },
        breadthSeries: [
          {
            asOfDate: "2026-03-03",
            totalCount: 100,
            advancingCount: 42,
            decliningCount: 49,
            flatCount: 9,
            positiveRatio: 0.42,
            aboveThreePctRatio: 0.08,
            belowThreePctRatio: 0.1,
            medianChangePct: -0.3,
            averageTurnoverRate: 1.5,
          },
          {
            asOfDate: "2026-03-04",
            totalCount: 100,
            advancingCount: 36,
            decliningCount: 55,
            flatCount: 9,
            positiveRatio: 0.36,
            aboveThreePctRatio: 0.05,
            belowThreePctRatio: 0.12,
            medianChangePct: -0.8,
            averageTurnoverRate: 1.6,
          },
          {
            asOfDate: "2026-03-05",
            totalCount: 100,
            advancingCount: 31,
            decliningCount: 60,
            flatCount: 9,
            positiveRatio: 0.31,
            aboveThreePctRatio: 0.04,
            belowThreePctRatio: 0.14,
            medianChangePct: -1.2,
            averageTurnoverRate: 1.7,
          },
          {
            asOfDate: "2026-03-06",
            totalCount: 100,
            advancingCount: 28,
            decliningCount: 61,
            flatCount: 11,
            positiveRatio: 0.28,
            aboveThreePctRatio: 0.03,
            belowThreePctRatio: 0.16,
            medianChangePct: -1.5,
            averageTurnoverRate: 1.8,
          },
        ],
        volatilitySeries: [
          {
            asOfDate: "2026-03-03",
            highVolatilityCount: 21,
            highVolatilityRatio: 0.21,
            limitDownLikeCount: 1,
            indexAtrRatio: 0.028,
          },
          {
            asOfDate: "2026-03-04",
            highVolatilityCount: 24,
            highVolatilityRatio: 0.24,
            limitDownLikeCount: 2,
            indexAtrRatio: 0.031,
          },
          {
            asOfDate: "2026-03-05",
            highVolatilityCount: 29,
            highVolatilityRatio: 0.29,
            limitDownLikeCount: 3,
            indexAtrRatio: 0.036,
          },
          {
            asOfDate: "2026-03-06",
            highVolatilityCount: 34,
            highVolatilityRatio: 0.34,
            limitDownLikeCount: 4,
            indexAtrRatio: 0.04,
          },
        ],
        features: {
          benchmarkStrength: 32,
          breadthScore: 26,
          riskScore: 76,
          stateScore: 28,
        },
      }),
    );

    expect(result.state).toBe("RISK_OFF");
    expect(result.constraints.length).toBeGreaterThan(0);
  });
});

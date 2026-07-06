import { describe, expect, it } from "vitest";
import { WatchlistPortfolioManagerService } from "~/server/application/timing/watchlist-portfolio-manager-service";
import type { TimingCardDraft } from "~/server/domain/timing/types";

const sampleIndicators = {
  close: 10,
  macd: { dif: 1, dea: 0.5, histogram: 0.5 },
  rsi: { value: 62 },
  bollinger: {
    upper: 10.8,
    middle: 10.2,
    lower: 9.6,
    closePosition: 0.7,
  },
  obv: { value: 10, slope: 1 },
  ema5: 9.9,
  ema20: 9.8,
  ema60: 9.3,
  ema120: 8.8,
  atr14: 0.3,
  volumeRatio20: 1.2,
  realizedVol20: 0.25,
  realizedVol120: 0.21,
  amount: 1_000_000,
  turnoverRate: 2.1,
};

const sampleSignalContext = {
  direction: "bullish" as const,
  compositeScore: 80,
  signalStrength: 80,
  confidence: 82,
  engineBreakdown: [],
  triggerNotes: ["trend aligned"],
  invalidationNotes: ["lose ema20"],
  riskFlags: [],
  explanation: "trend and momentum aligned",
  summary: "Composite 80，多子引擎整体偏多。",
};

const sampleCard = (overrides?: Partial<TimingCardDraft>): TimingCardDraft => ({
  userId: "u_1",
  workflowRunId: "run_1",
  watchListId: "wl_1",
  stockCode: "600519",
  stockName: "茅台",
  asOfDate: "2026-03-06",
  sourceType: "watchlist",
  sourceId: "wl_1",
  actionBias: "ADD",
  confidence: 82,
  marketState: "RISK_ON",
  marketTransition: "IMPROVING",
  summary: "Bullish setup",
  triggerNotes: ["trend aligned"],
  invalidationNotes: ["lose ema20"],
  riskFlags: [],
  reasoning: {
    signalContext: sampleSignalContext,
    actionRationale: "signals support adding",
    indicators: sampleIndicators,
  },
  ...overrides,
});

describe("WatchlistPortfolioManagerService", () => {
  it("boosts constructive Kronos forecasts without bypassing risk constraints", () => {
    const service = new WatchlistPortfolioManagerService();
    const result = service.buildRecommendations({
      userId: "u_1",
      workflowRunId: "run_1",
      watchListId: "wl_1",
      portfolioSnapshot: {
        id: "ps_1",
        userId: "u_1",
        name: "Core",
        baseCurrency: "CNY",
        cash: 100_000,
        totalCapital: 100_000,
        positions: [],
        riskPreferences: {
          maxSingleNamePct: 12,
          maxThemeExposurePct: 25,
          defaultProbePct: 3,
          maxPortfolioRiskBudgetPct: 3,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      timingCards: [
        sampleCard({
          actionBias: "WATCH",
          confidence: 64,
          reasoning: {
            ...sampleCard().reasoning,
            kronosForecast: {
              expectedReturnPct: 12,
              maxDrawdownPct: -2.5,
              upsidePct: 14,
              volatilityProxy: 0.18,
              direction: "bullish",
              confidence: 0.82,
            },
          },
        }),
      ],
      riskPlan: {
        portfolioRiskBudgetPct: 0,
        maxSingleNamePct: 8,
        defaultProbePct: 2,
        blockedActions: ["ADD", "PROBE"],
        correlationWarnings: [],
        notes: [],
      },
      marketContextAnalysis: {
        state: "RISK_ON",
        transition: "IMPROVING",
        regimeConfidence: 70,
        summary: "constructive market",
        constraints: [],
        breadthTrend: "EXPANDING",
        volatilityTrend: "FALLING",
        persistenceDays: 3,
        leadership: {
          leaderCode: "510300",
          leaderName: "CSI 300 ETF",
          switched: false,
          previousLeaderCode: null,
        },
        snapshot: {
          asOfDate: "2026-03-06",
          indexes: [],
          latestBreadth: {
            asOfDate: "2026-03-06",
            totalCount: 0,
            advancingCount: 0,
            decliningCount: 0,
            flatCount: 0,
            positiveRatio: 0,
            aboveThreePctRatio: 0,
            belowThreePctRatio: 0,
            medianChangePct: 0,
            averageTurnoverRate: null,
          },
          latestVolatility: {
            asOfDate: "2026-03-06",
            highVolatilityCount: 0,
            highVolatilityRatio: 0,
            limitDownLikeCount: 0,
            indexAtrRatio: 0,
          },
          latestLeadership: {
            asOfDate: "2026-03-06",
            leaderCode: "510300",
            leaderName: "CSI 300 ETF",
            ranking5d: ["510300"],
            ranking10d: ["510300"],
            switched: false,
            previousLeaderCode: null,
          },
          breadthSeries: [],
          volatilitySeries: [],
          leadershipSeries: [],
          features: {
            benchmarkStrength: 55,
            breadthScore: 50,
            riskScore: 48,
            stateScore: 52,
          },
        },
        stateScore: 52,
      },
    });

    expect(result[0]?.action).toBe("WATCH");
    expect(result[0]?.reasoning.kronosForecast?.direction).toBe("bullish");
    expect(result[0]?.reasoning.actionRationale).toContain("Kronos");
  });

  it("lowers add confidence when Kronos projects downside", () => {
    const service = new WatchlistPortfolioManagerService();
    const baseCard = sampleCard({ confidence: 82 });
    const bearishCard = sampleCard({
      confidence: 82,
      reasoning: {
        ...baseCard.reasoning,
        kronosForecast: {
          expectedReturnPct: -7.5,
          maxDrawdownPct: -12,
          upsidePct: 2,
          volatilityProxy: 0.42,
          direction: "bearish",
          confidence: 0.76,
        },
      },
    });

    const common = {
      userId: "u_1",
      workflowRunId: "run_1",
      watchListId: "wl_1",
      portfolioSnapshot: {
        id: "ps_1",
        userId: "u_1",
        name: "Core",
        baseCurrency: "CNY",
        cash: 100_000,
        totalCapital: 100_000,
        positions: [],
        riskPreferences: {
          maxSingleNamePct: 12,
          maxThemeExposurePct: 25,
          defaultProbePct: 3,
          maxPortfolioRiskBudgetPct: 10,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      riskPlan: {
        portfolioRiskBudgetPct: 10,
        maxSingleNamePct: 8,
        defaultProbePct: 2,
        blockedActions: [],
        correlationWarnings: [],
        notes: [],
      },
      marketContextAnalysis: {
        state: "RISK_ON" as const,
        transition: "IMPROVING" as const,
        regimeConfidence: 70,
        summary: "constructive market",
        constraints: [],
        breadthTrend: "EXPANDING" as const,
        volatilityTrend: "FALLING" as const,
        persistenceDays: 3,
        leadership: {
          leaderCode: "510300",
          leaderName: "CSI 300 ETF",
          switched: false,
          previousLeaderCode: null,
        },
        snapshot: {
          asOfDate: "2026-03-06",
          indexes: [],
          latestBreadth: {
            asOfDate: "2026-03-06",
            totalCount: 0,
            advancingCount: 0,
            decliningCount: 0,
            flatCount: 0,
            positiveRatio: 0,
            aboveThreePctRatio: 0,
            belowThreePctRatio: 0,
            medianChangePct: 0,
            averageTurnoverRate: null,
          },
          latestVolatility: {
            asOfDate: "2026-03-06",
            highVolatilityCount: 0,
            highVolatilityRatio: 0,
            limitDownLikeCount: 0,
            indexAtrRatio: 0,
          },
          latestLeadership: {
            asOfDate: "2026-03-06",
            leaderCode: "510300",
            leaderName: "CSI 300 ETF",
            ranking5d: ["510300"],
            ranking10d: ["510300"],
            switched: false,
            previousLeaderCode: null,
          },
          breadthSeries: [],
          volatilitySeries: [],
          leadershipSeries: [],
          features: {
            benchmarkStrength: 55,
            breadthScore: 50,
            riskScore: 48,
            stateScore: 52,
          },
        },
        stateScore: 52,
      },
    };

    const base = service.buildRecommendations({
      ...common,
      timingCards: [baseCard],
    });
    const bearish = service.buildRecommendations({
      ...common,
      timingCards: [bearishCard],
    });

    expect(bearish[0]?.confidence).toBeLessThan(base[0]?.confidence ?? 0);
    expect(bearish[0]?.reasoning.actionRationale).toContain("Kronos");
  });

  it("keeps recommendations flowing and records a warning when Kronos is missing", () => {
    const service = new WatchlistPortfolioManagerService();

    const result = service.buildRecommendations({
      userId: "u_1",
      workflowRunId: "run_1",
      watchListId: "wl_1",
      portfolioSnapshot: {
        id: "ps_1",
        userId: "u_1",
        name: "Core",
        baseCurrency: "CNY",
        cash: 100_000,
        totalCapital: 100_000,
        positions: [],
        riskPreferences: {
          maxSingleNamePct: 12,
          maxThemeExposurePct: 25,
          defaultProbePct: 3,
          maxPortfolioRiskBudgetPct: 10,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      timingCards: [sampleCard({ confidence: 72 })],
      riskPlan: {
        portfolioRiskBudgetPct: 10,
        maxSingleNamePct: 8,
        defaultProbePct: 2,
        blockedActions: [],
        correlationWarnings: [],
        notes: [],
      },
      marketContextAnalysis: {
        state: "NEUTRAL",
        transition: "STABLE",
        regimeConfidence: 58,
        summary: "mixed market",
        constraints: [],
        breadthTrend: "STALLING",
        volatilityTrend: "STABLE",
        persistenceDays: 3,
        leadership: {
          leaderCode: "510300",
          leaderName: "CSI 300 ETF",
          switched: false,
          previousLeaderCode: "510300",
        },
        snapshot: {
          asOfDate: "2026-03-06",
          indexes: [],
          latestBreadth: {
            asOfDate: "2026-03-06",
            totalCount: 0,
            advancingCount: 0,
            decliningCount: 0,
            flatCount: 0,
            positiveRatio: 0,
            aboveThreePctRatio: 0,
            belowThreePctRatio: 0,
            medianChangePct: 0,
            averageTurnoverRate: null,
          },
          latestVolatility: {
            asOfDate: "2026-03-06",
            highVolatilityCount: 0,
            highVolatilityRatio: 0,
            limitDownLikeCount: 0,
            indexAtrRatio: 0,
          },
          latestLeadership: {
            asOfDate: "2026-03-06",
            leaderCode: "510300",
            leaderName: "CSI 300 ETF",
            ranking5d: ["510300"],
            ranking10d: ["510300"],
            switched: false,
            previousLeaderCode: "510300",
          },
          breadthSeries: [],
          volatilitySeries: [],
          leadershipSeries: [],
          features: {
            benchmarkStrength: 55,
            breadthScore: 50,
            riskScore: 48,
            stateScore: 52,
          },
        },
        stateScore: 52,
      },
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.reasoning.kronosWarnings).toContain(
      "Kronos forecast unavailable; auxiliary weight treated as 0.",
    );
  });

  it("downgrades aggressive adds when risk budget is exhausted", () => {
    const service = new WatchlistPortfolioManagerService();

    const result = service.buildRecommendations({
      userId: "u_1",
      workflowRunId: "run_1",
      watchListId: "wl_1",
      portfolioSnapshot: {
        id: "ps_1",
        userId: "u_1",
        name: "Core",
        baseCurrency: "CNY",
        cash: 2_000,
        totalCapital: 100_000,
        positions: [],
        riskPreferences: {
          maxSingleNamePct: 12,
          maxThemeExposurePct: 25,
          defaultProbePct: 3,
          maxPortfolioRiskBudgetPct: 3,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      timingCards: [
        sampleCard({ stockCode: "600519", stockName: "茅台" }),
        sampleCard({ stockCode: "000858", stockName: "五粮液" }),
      ],
      riskPlan: {
        portfolioRiskBudgetPct: 2,
        maxSingleNamePct: 8,
        defaultProbePct: 2,
        blockedActions: [],
        correlationWarnings: [],
        notes: [],
      },
      marketContextAnalysis: {
        state: "NEUTRAL",
        transition: "STABLE",
        regimeConfidence: 58,
        summary: "mixed market",
        constraints: [],
        breadthTrend: "STALLING",
        volatilityTrend: "STABLE",
        persistenceDays: 3,
        leadership: {
          leaderCode: "510300",
          leaderName: "CSI 300 ETF",
          switched: false,
          previousLeaderCode: "510300",
        },
        snapshot: {
          asOfDate: "2026-03-06",
          indexes: [],
          latestBreadth: {
            asOfDate: "2026-03-06",
            totalCount: 0,
            advancingCount: 0,
            decliningCount: 0,
            flatCount: 0,
            positiveRatio: 0,
            aboveThreePctRatio: 0,
            belowThreePctRatio: 0,
            medianChangePct: 0,
            averageTurnoverRate: null,
          },
          latestVolatility: {
            asOfDate: "2026-03-06",
            highVolatilityCount: 0,
            highVolatilityRatio: 0,
            limitDownLikeCount: 0,
            indexAtrRatio: 0,
          },
          latestLeadership: {
            asOfDate: "2026-03-06",
            leaderCode: "510300",
            leaderName: "CSI 300 ETF",
            ranking5d: ["510300"],
            ranking10d: ["510300"],
            switched: false,
            previousLeaderCode: "510300",
          },
          breadthSeries: [],
          volatilitySeries: [],
          leadershipSeries: [],
          features: {
            benchmarkStrength: 55,
            breadthScore: 50,
            riskScore: 48,
            stateScore: 52,
          },
        },
        stateScore: 52,
      },
      feedbackContext: {
        presetId: "preset-1",
        learningSummary: "暂无反馈建议",
        pendingSuggestionCount: 0,
        adoptedSuggestionCount: 0,
        highlights: [],
      },
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.suggestedMaxPct).toBeLessThanOrEqual(2);
    expect(result[1]?.action).toBe("WATCH");
  });
});

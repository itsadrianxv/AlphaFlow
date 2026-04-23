import { describe, expect, it } from "vitest";
import { WatchlistPortfolioManagerService } from "~/modules/timing/server/application/watchlist-portfolio-manager-service";
import type { TimingCardDraft } from "~/modules/timing/server/domain/types";

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

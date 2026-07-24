import { describe, expect, it } from "vitest";
import { WatchlistPortfolioManagerV2Service } from "~/server/application/timing/watchlist-portfolio-manager-v2-service";
import type {
  MarketContextAnalysis,
  PortfolioRiskPlan,
  PortfolioSnapshotRecord,
  TimingCardDraft,
} from "~/server/domain/timing/types";

const market = {
  state: "RISK_OFF",
  transition: "PIVOT_DOWN",
  regimeConfidence: 80,
  summary: "防守",
  constraints: [],
  breadthTrend: "CONTRACTING",
  volatilityTrend: "RISING",
  persistenceDays: 3,
  stateScore: -20,
  leadership: {
    leaderCode: "",
    leaderName: "",
    switched: false,
    previousLeaderCode: null,
  },
  snapshot: {
    asOfDate: "2026-07-23",
    indexes: [],
    latestBreadth: {
      asOfDate: "2026-07-23",
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
      asOfDate: "2026-07-23",
      highVolatilityCount: 0,
      highVolatilityRatio: 0,
      limitDownLikeCount: 0,
      indexAtrRatio: 0,
    },
    latestLeadership: {
      asOfDate: "2026-07-23",
      leaderCode: "",
      leaderName: "",
      ranking5d: [],
      ranking10d: [],
      switched: false,
      previousLeaderCode: null,
    },
    breadthSeries: [],
    volatilitySeries: [],
    leadershipSeries: [],
    features: {
      benchmarkStrength: 0,
      breadthScore: 0,
      riskScore: 0,
      stateScore: -20,
    },
  },
} satisfies MarketContextAnalysis;

const portfolio = {
  id: "portfolio-1",
  userId: "user-1",
  name: "测试组合",
  baseCurrency: "CNY",
  cash: 30_000,
  totalCapital: 100_000,
  positions: [],
  riskPreferences: {
    maxSingleNamePct: 12,
    maxThemeExposurePct: 30,
    defaultProbePct: 3,
    maxPortfolioRiskBudgetPct: 20,
  },
  createdAt: new Date(),
  updatedAt: new Date(),
} satisfies PortfolioSnapshotRecord;

const riskPlan = {
  portfolioRiskBudgetPct: 10,
  maxSingleNamePct: 8,
  defaultProbePct: 2,
  blockedActions: ["PROBE", "ENTER", "ADD"],
  correlationWarnings: [],
  notes: [],
} satisfies PortfolioRiskPlan;

function card(action: TimingCardDraft["actionBias"]): TimingCardDraft {
  return {
    userId: "user-1",
    workflowRunId: "run-1",
    watchListId: "watchlist-1",
    presetRevisionId: "revision-1",
    stockCode: "000001",
    stockName: "平安银行",
    asOfDate: "2026-07-23",
    sourceType: "watchlist",
    sourceId: "watchlist-1",
    actionBias: action,
    confidence: 0,
    marketState: "RISK_OFF",
    summary: "规则审计",
    triggerNotes: [],
    invalidationNotes: [],
    riskFlags: [],
    decisionStatus: "TRIGGERED",
    reasoning: {
      signalContext: {
        direction: "neutral",
        compositeScore: 0,
        signalStrength: 0,
        confidence: 0,
        engineBreakdown: [],
        triggerNotes: [],
        invalidationNotes: [],
        riskFlags: [],
        explanation: "v2",
        summary: "v2",
      },
      actionRationale: "确定性规则",
      indicators: {
        close: 0,
        macd: { dif: 0, dea: 0, histogram: 0 },
        rsi: { value: 50 },
        bollinger: { upper: 0, middle: 0, lower: 0, closePosition: 0.5 },
        obv: { value: 0, slope: 0 },
        ema5: 0,
        ema20: 0,
        ema60: 0,
        ema120: 0,
        atr14: 0,
        volumeRatio20: 0,
        realizedVol20: 0,
        realizedVol120: 0,
      },
    },
  };
}

describe("v2 组合预算映射", () => {
  it("不因组合预算或市场状态二次改写确定性动作", () => {
    const [recommendation] = new WatchlistPortfolioManagerV2Service()
      .buildRecommendations({
        userId: "user-1",
        workflowRunId: "run-1",
        watchListId: "watchlist-1",
        portfolioSnapshot: portfolio,
        timingCards: [card("ENTER")],
        riskPlan,
        marketContextAnalysis: market,
      });

    expect(recommendation?.action).toBe("ENTER");
    expect(recommendation?.confidence).toBe(0);
    expect(recommendation?.suggestedMaxPct).toBe(8);
  });
});

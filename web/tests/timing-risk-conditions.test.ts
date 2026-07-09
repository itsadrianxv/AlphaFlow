import { describe, expect, it } from "vitest";

import { TimingAnalysisService } from "~/server/application/timing/timing-analysis-service";
import { WatchlistPortfolioManagerService } from "~/server/application/timing/watchlist-portfolio-manager-service";
import type {
  MarketContextAnalysis,
  PortfolioSnapshotRecord,
  TimingCardDraft,
  TimingSignalData,
} from "~/server/domain/timing/types";

const indicators = {
  close: 9.5,
  macd: { dif: -0.2, dea: -0.1, histogram: -0.2 },
  rsi: { value: 32 },
  bollinger: { upper: 12, middle: 10, lower: 8, closePosition: 0.3 },
  obv: { value: 1000, slope: -120 },
  ema5: 9.8,
  ema20: 10,
  ema60: 10.5,
  ema120: 11,
  atr14: 0.6,
  volumeRatio20: 0.8,
  realizedVol20: 0.35,
  realizedVol120: 0.28,
  amount: 100_000,
  turnoverRate: 1.2,
};

const signal: TimingSignalData = {
  stockCode: "600519",
  stockName: "贵州茅台",
  asOfDate: "2026-07-06",
  barsCount: 260,
  indicators,
  signalContext: {
    engines: [
      {
        key: "multiTimeframeAlignment",
        label: "多周期一致性",
        direction: "bearish",
        score: -65,
        confidence: 0.9,
        weight: 0.24,
        detail: "均线结构转弱。",
        metrics: {},
        warnings: ["TREND_WEAKENING"],
      },
      {
        key: "relativeStrength",
        label: "相对强弱",
        direction: "bearish",
        score: -45,
        confidence: 0.8,
        weight: 0.2,
        detail: "相对基准走弱。",
        metrics: {},
        warnings: ["WEAK_RELATIVE_STRENGTH"],
      },
    ],
    composite: {
      score: -58,
      confidence: 0.8,
      direction: "bearish",
      signalStrength: 58,
      participatingEngines: 2,
    },
  },
};

function marketContext(): MarketContextAnalysis {
  return {
    state: "NEUTRAL",
    transition: "STABLE",
    regimeConfidence: 60,
    persistenceDays: 2,
    summary: "市场中性。",
    constraints: [],
    breadthTrend: "STALLING",
    volatilityTrend: "STABLE",
    leadership: { leaderCode: "000300.SH", leaderName: "沪深300", switched: false },
    snapshot: {
      asOfDate: "2026-07-06",
      indexes: [],
      latestBreadth: {
        asOfDate: "2026-07-06",
        totalCount: 1,
        advancingCount: 0,
        decliningCount: 1,
        flatCount: 0,
        positiveRatio: 0,
        aboveThreePctRatio: 0,
        belowThreePctRatio: 0,
        medianChangePct: 0,
      },
      latestVolatility: {
        asOfDate: "2026-07-06",
        highVolatilityCount: 0,
        highVolatilityRatio: 0,
        limitDownLikeCount: 0,
        indexAtrRatio: 0,
      },
      latestLeadership: {
        asOfDate: "2026-07-06",
        leaderCode: "000300.SH",
        leaderName: "沪深300",
        ranking5d: [],
        ranking10d: [],
        switched: false,
      },
      breadthSeries: [],
      volatilitySeries: [],
      leadershipSeries: [],
      features: {
        benchmarkStrength: 50,
        breadthScore: 50,
        riskScore: 50,
        stateScore: 50,
      },
    },
    stateScore: 50,
  };
}

describe("择时执行风控条件", () => {
  it("生成结构化触发和失效条件，并继续保留说明文本", () => {
    const [assessment] = new TimingAnalysisService().buildTechnicalAssessments([
      signal,
    ]);

    expect(assessment?.signalContext.invalidationConditions?.length).toBeGreaterThan(0);
    expect(assessment?.invalidationNotes.length).toBeGreaterThan(0);
    expect(
      assessment?.signalContext.invalidationConditions?.some(
        (condition) =>
          condition.id === "invalidation:close-below-ema20" &&
          condition.status === "TRIGGERED",
      ),
    ).toBe(true);
  });

  it("critical 失效条件触发时会把未持仓进攻动作降级为观望", () => {
    const card: TimingCardDraft = {
      userId: "user-1",
      workflowRunId: "run-1",
      watchListId: "watch-1",
      presetId: "preset-1",
      stockCode: "600519",
      stockName: "贵州茅台",
      asOfDate: "2026-07-06",
      sourceType: "watchlist",
      sourceId: "watch-1",
      actionBias: "ADD",
      confidence: 85,
      summary: "测试卡片",
      triggerNotes: [],
      invalidationNotes: [],
      riskFlags: [],
      reasoning: {
        signalContext: {
          direction: "bullish",
          compositeScore: 80,
          signalStrength: 80,
          confidence: 85,
          engineBreakdown: [],
          triggerNotes: [],
          invalidationNotes: [],
          invalidationConditions: [
            {
              id: "invalidation:close-below-ema20",
              kind: "INVALIDATION",
              category: "PRICE_LEVEL",
              label: "跌破 EMA20",
              metric: "close_vs_ema20",
              operator: "<",
              threshold: 10,
              actual: 9.5,
              status: "TRIGGERED",
              severity: "CRITICAL",
              explanation: "收盘价已经跌破 EMA20。",
            },
          ],
          riskFlags: [],
          explanation: "测试",
          summary: "测试",
        },
        actionRationale: "测试",
        indicators,
      },
    };
    const portfolio: PortfolioSnapshotRecord = {
      id: "portfolio-1",
      userId: "user-1",
      name: "默认组合",
      baseCurrency: "CNY",
      cash: 100,
      totalCapital: 100,
      positions: [],
      riskPreferences: {
        maxSingleNamePct: 12,
        maxThemeExposurePct: 30,
        defaultProbePct: 3,
        maxPortfolioRiskBudgetPct: 20,
      },
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };

    const [recommendation] =
      new WatchlistPortfolioManagerService().buildRecommendations({
        userId: "user-1",
        workflowRunId: "run-1",
        watchListId: "watch-1",
        portfolioSnapshot: portfolio,
        timingCards: [card],
        riskPlan: {
          portfolioRiskBudgetPct: 20,
          maxSingleNamePct: 12,
          defaultProbePct: 3,
          blockedActions: [],
          correlationWarnings: [],
          notes: [],
        },
        marketContextAnalysis: marketContext(),
      });

    expect(recommendation?.action).toBe("WATCH");
    expect(recommendation?.riskFlags).toContain("NEAR_INVALIDATION");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { describe, expect, it } from "vitest";

import { TimingReportPanels } from "~/app/timing/reports/[cardId]/timing-report-view";
import { TimingExecutionPlanService } from "~/server/application/timing/timing-execution-plan-service";
import type {
  MarketContextAnalysis,
  TimingAnalysisCardRecord,
  TimingChartLevels,
  TimingRecommendationRecord,
  TimingReportPayload,
} from "~/server/domain/timing/types";

const now = new Date("2026-07-06T00:00:00.000Z");

const chartLevels: TimingChartLevels = {
  ema5: [],
  ema20: [],
  ema60: [],
  ema120: [],
  recentHigh60d: 12,
  recentLow20d: 9.6,
  avgVolume20: 1000,
  volumeSpikeDates: [],
};

const marketContext: MarketContextAnalysis = {
  state: "NEUTRAL",
  transition: "STABLE",
  regimeConfidence: 60,
  persistenceDays: 2,
  summary: "市场中性。",
  constraints: [],
  breadthTrend: "STALLING",
  volatilityTrend: "STABLE",
  leadership: {
    leaderCode: "000300.SH",
    leaderName: "沪深300",
    switched: false,
    previousLeaderCode: null,
  },
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
      averageTurnoverRate: null,
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
      previousLeaderCode: null,
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

function card(
  overrides: Partial<TimingAnalysisCardRecord> = {},
): TimingAnalysisCardRecord {
  return {
    id: "card-1",
    userId: "user-1",
    workflowRunId: "run-1",
    watchListId: "watch-1",
    presetId: "preset-1",
    stockCode: "600519",
    stockName: "贵州茅台",
    asOfDate: "2026-07-06",
    sourceType: "watchlist",
    sourceId: "watch-1",
    signalSnapshotId: "snapshot-1",
    actionBias: "ADD",
    confidence: 85,
    marketState: "NEUTRAL",
    marketTransition: "STABLE",
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
        triggerConditions: [],
        invalidationConditions: [
          {
            id: "invalidation:close-below-ema20",
            kind: "INVALIDATION",
            category: "PRICE_LEVEL",
            label: "跌破 EMA20",
            metric: "close_vs_ema20",
            operator: "<",
            threshold: 10,
            actual: 10.5,
            status: "PENDING",
            severity: "WARNING",
            explanation: "若跌破 EMA20，需要重新评估。",
          },
        ],
        riskFlags: [],
        explanation: "测试",
        summary: "测试",
      },
      actionRationale: "测试",
      indicators: {
        close: 10.5,
        macd: { dif: 0.2, dea: 0.1, histogram: 0.1 },
        rsi: { value: 60 },
        bollinger: { upper: 12, middle: 10, lower: 8, closePosition: 0.6 },
        obv: { value: 1000, slope: 120 },
        ema5: 10.4,
        ema20: 10,
        ema60: 9.5,
        ema120: 9,
        atr14: 0.6,
        volumeRatio20: 1.2,
        realizedVol20: 0.25,
        realizedVol120: 0.3,
        amount: 100_000,
        turnoverRate: 1.2,
      },
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function recommendation(
  sourceCard: TimingAnalysisCardRecord,
): TimingRecommendationRecord {
  return {
    id: "rec-1",
    userId: sourceCard.userId,
    workflowRunId: sourceCard.workflowRunId,
    portfolioSnapshotId: "portfolio-1",
    watchListId: sourceCard.watchListId ?? "watch-1",
    presetId: sourceCard.presetId,
    stockCode: sourceCard.stockCode,
    stockName: sourceCard.stockName,
    action: "PROBE",
    priority: 1,
    confidence: 78,
    suggestedMinPct: 1.5,
    suggestedMaxPct: 3,
    riskBudgetPct: 12,
    marketState: "NEUTRAL",
    marketTransition: "STABLE",
    riskFlags: ["NEAR_INVALIDATION"],
    reasoning: {
      signalContext: sourceCard.reasoning.signalContext,
      marketContext: {
        state: "NEUTRAL",
        transition: "STABLE",
        summary: "市场中性。",
        constraints: [],
        breadthTrend: "STALLING",
        volatilityTrend: "STABLE",
        persistenceDays: 2,
        leadership: marketContext.leadership,
      },
      positionContext: {
        held: false,
        currentWeightPct: 0,
        targetDeltaPct: 3,
        availableCashPct: 20,
        costZone: "NEAR_COST",
        pnlZone: "SMALL_GAIN",
        holdingStage: "EARLY",
        invalidationRisk: "TIGHT",
      },
      feedbackContext: {
        presetId: sourceCard.presetId,
        learningSummary: "暂无样本。",
        pendingSuggestionCount: 0,
        adoptedSuggestionCount: 0,
        highlights: [],
      },
      riskPlan: {
        portfolioRiskBudgetPct: 12,
        maxSingleNamePct: 8,
        defaultProbePct: 3,
        blockedActions: ["ADD"],
        correlationWarnings: ["同主题暴露偏高。"],
        notes: [],
      },
      actionRationale: "市场中性，先试仓。",
      triggerConditions: sourceCard.reasoning.signalContext.triggerConditions,
      invalidationConditions:
        sourceCard.reasoning.signalContext.invalidationConditions,
    },
    createdAt: now,
    updatedAt: now,
  };
}

describe("择时执行计划", () => {
  it("有推荐记录时使用风控后的动作和建议仓位", () => {
    const sourceCard = card();
    const rec = recommendation(sourceCard);

    const plan = new TimingExecutionPlanService().build({
      card: sourceCard,
      bars: [],
      chartLevels,
      marketContext,
      recommendation: rec,
    });

    expect(plan.decision.rawAction).toBe("ADD");
    expect(plan.decision.finalAction).toBe("PROBE");
    expect(plan.budget.suggestedMaxPct).toBe(3);
    expect(plan.constraints.blockedActions).toContain("ADD");
    expect(plan.constraints.portfolioWarnings).toContain("同主题暴露偏高。");
  });

  it("critical 失效条件触发且无推荐记录时降级为观察", () => {
    const sourceCard = card({
      reasoning: {
        ...card().reasoning,
        signalContext: {
          ...card().reasoning.signalContext,
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
              explanation: "已经跌破 EMA20。",
            },
          ],
        },
      },
    });

    const plan = new TimingExecutionPlanService().build({
      card: sourceCard,
      bars: [],
      chartLevels,
      marketContext,
    });

    expect(plan.decision.finalAction).toBe("WATCH");
    expect(plan.budget.dataStatus).toBe("FALLBACK");
    expect(plan.constraints.missingContext).toContain("同轮组合推荐记录");
  });

  it("执行风控页渲染四个新模块，不再使用旧主模块", () => {
    const sourceCard = card();
    const rec = recommendation(sourceCard);
    const executionPlan = new TimingExecutionPlanService().build({
      card: sourceCard,
      bars: [],
      chartLevels,
      marketContext,
      recommendation: rec,
    });
    const report: TimingReportPayload = {
      card: sourceCard,
      bars: [],
      chartLevels,
      evidence: {
        multiTimeframeAlignment: {
          key: "multiTimeframeAlignment",
          label: "多周期一致性",
          direction: "bullish",
          score: 50,
          confidence: 0.8,
          weight: 0.2,
          detail: "测试",
          metrics: {},
          warnings: [],
        },
        relativeStrength: {
          key: "relativeStrength",
          label: "相对强弱",
          direction: "neutral",
          score: 0,
          confidence: 0,
          weight: 0,
          detail: "测试",
          metrics: {},
          warnings: [],
        },
        volatilityPercentile: {
          key: "volatilityPercentile",
          label: "波动率分位",
          direction: "neutral",
          score: 0,
          confidence: 0,
          weight: 0,
          detail: "测试",
          metrics: {},
          warnings: [],
        },
        liquidityStructure: {
          key: "liquidityStructure",
          label: "流动性结构",
          direction: "neutral",
          score: 0,
          confidence: 0,
          weight: 0,
          detail: "测试",
          metrics: {},
          warnings: [],
        },
        breakoutFailure: {
          key: "breakoutFailure",
          label: "突破失败率",
          direction: "neutral",
          score: 0,
          confidence: 0,
          weight: 0,
          detail: "测试",
          metrics: {},
          warnings: [],
        },
        gapVolumeQuality: {
          key: "gapVolumeQuality",
          label: "缺口与放量质量",
          direction: "neutral",
          score: 0,
          confidence: 0,
          weight: 0,
          detail: "测试",
          metrics: {},
          warnings: [],
        },
        kronosForecast: {
          key: "kronosForecast",
          label: "Kronos 预测",
          direction: "neutral",
          score: 0,
          confidence: 0,
          weight: 0,
          detail: "测试",
          metrics: {},
          warnings: [],
        },
      },
      marketContext,
      recommendation: rec,
      executionPlan,
      reviewTimeline: [],
    };

    const html = renderToStaticMarkup(
      React.createElement(TimingReportPanels, {
        report,
        activeTabId: "execution",
      }),
    );

    expect(html).toContain("执行结论");
    expect(html).toContain("仓位预算");
    expect(html).toContain("订单计划");
    expect(html).toContain("组合约束");
    expect(html).not.toContain("触发条件");
    expect(html).not.toContain("失效条件");
    expect(html).not.toContain("风险标签");
  });
});

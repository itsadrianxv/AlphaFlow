import { describe, expect, it, vi } from "vitest";
import type {
  PortfolioSnapshotRecord,
  TimingCardDraft,
  TimingSignalData,
} from "~/server/domain/timing/types";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";
import type { WatchlistTimingPipelineGraphState } from "~/server/domain/workflow/types";
import { WatchlistTimingPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/watchlist-timing-graph";

function buildSignalData(stockCode: string): TimingSignalData {
  return {
    stockCode,
    stockName: `Stock-${stockCode}`,
    asOfDate: "2026-03-06",
    barsCount: 240,
    bars: [
      {
        tradeDate: "2026-03-05",
        open: 10,
        high: 10.5,
        low: 9.8,
        close: 10.2,
        volume: 1000000,
        amount: 10200000,
        turnoverRate: 1.1,
      },
    ],
    indicators: {
      close: 10.2,
      macd: { dif: 0.2, dea: 0.1, histogram: 0.2 },
      rsi: { value: 62 },
      bollinger: {
        upper: 10.8,
        middle: 10,
        lower: 9.2,
        closePosition: 0.7,
      },
      obv: { value: 100, slope: 8 },
      ema5: 10,
      ema20: 9.8,
      ema60: 9.4,
      ema120: 9,
      atr14: 0.3,
      volumeRatio20: 1.2,
      realizedVol20: 0.24,
      realizedVol120: 0.2,
      amount: 10200000,
      turnoverRate: 1.1,
    },
    signalContext: {
      engines: [],
      composite: {
        score: 76,
        confidence: 0.82,
        direction: "bullish",
        signalStrength: 76,
        participatingEngines: 6,
      },
    },
  };
}

function buildCardDraft(stockCode: string): TimingCardDraft {
  const signalData = buildSignalData(stockCode);

  return {
    userId: "user_1",
    workflowRunId: "run_1",
    watchListId: "watch_1",
    stockCode,
    stockName: signalData.stockName,
    asOfDate: signalData.asOfDate,
    sourceType: "watchlist",
    sourceId: "watch_1",
    actionBias: "ADD",
    confidence: 76,
    summary: `${stockCode} summary`,
    triggerNotes: [],
    invalidationNotes: [],
    riskFlags: [],
    reasoning: {
      signalContext: {
        direction: "bullish",
        compositeScore: 76,
        signalStrength: 76,
        confidence: 82,
        engineBreakdown: [],
        triggerNotes: [],
        invalidationNotes: [],
        riskFlags: [],
        explanation: "supportive",
        summary: "supportive",
      },
      actionRationale: "act",
      indicators: signalData.indicators,
    },
  };
}

function buildPortfolioSnapshot(): PortfolioSnapshotRecord {
  return {
    id: "portfolio_1",
    userId: "user_1",
    name: "Core",
    baseCurrency: "CNY",
    cash: 300000,
    totalCapital: 1000000,
    positions: [],
    riskPreferences: {
      maxSingleNamePct: 12,
      maxThemeExposurePct: 30,
      defaultProbePct: 3,
      maxPortfolioRiskBudgetPct: 20,
    },
    createdAt: new Date("2026-03-06T00:00:00.000Z"),
    updatedAt: new Date("2026-03-06T00:00:00.000Z"),
  };
}

describe("WatchlistTimingPipelineLangGraph market context fallback", () => {
  it("keeps the workflow moving when live market context is unavailable", async () => {
    const getSignalsBatch = vi.fn().mockResolvedValue({
      items: [buildSignalData("600519"), buildSignalData("000001")],
      errors: [],
    });
    const getMarketContext = vi
      .fn()
      .mockRejectedValue(
        new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.TIMING_DATA_UNAVAILABLE,
          "Timing 数据服务请求超时 (60000ms)",
        ),
      );
    const upsert = vi.fn();
    const buildRiskPlan = vi.fn().mockReturnValue({
      portfolioRiskBudgetPct: 5,
      maxSingleNamePct: 10,
      defaultProbePct: 2,
      blockedActions: [],
      correlationWarnings: [],
      notes: [],
    });
    const buildRecommendations = vi.fn().mockImplementation((params) => [
      {
        userId: params.userId,
        workflowRunId: params.workflowRunId,
        portfolioSnapshotId: params.portfolioSnapshot.id,
        watchListId: params.watchListId,
        presetId: null,
        stockCode: "600519",
        stockName: "Stock-600519",
        action: "WATCH",
        priority: 1,
        confidence: 68,
        suggestedMinPct: 0,
        suggestedMaxPct: 3,
        riskBudgetPct: params.riskPlan.portfolioRiskBudgetPct,
        marketState: params.marketContextAnalysis.state,
        marketTransition: params.marketContextAnalysis.transition,
        riskFlags: [],
        reasoning: {
          signalContext: buildCardDraft("600519").reasoning.signalContext,
          marketContext: {
            state: params.marketContextAnalysis.state,
            transition: params.marketContextAnalysis.transition,
            summary: params.marketContextAnalysis.summary,
            constraints: params.marketContextAnalysis.constraints,
            breadthTrend: params.marketContextAnalysis.breadthTrend,
            volatilityTrend: params.marketContextAnalysis.volatilityTrend,
            persistenceDays: params.marketContextAnalysis.persistenceDays,
            leadership: params.marketContextAnalysis.leadership,
          },
          positionContext: {
            held: false,
            currentWeightPct: 0,
            targetDeltaPct: 0,
            availableCashPct: 30,
            costZone: "NEUTRAL",
            pnlZone: "FLAT",
            holdingStage: "ENTRY",
            invalidationRisk: "SAFE",
          },
          feedbackContext: {
            presetId: null,
            learningSummary: "No feedback yet.",
            pendingSuggestionCount: 0,
            adoptedSuggestionCount: 0,
            highlights: [],
          },
          riskPlan: params.riskPlan,
          actionRationale: "fallback rationale",
        },
      },
    ]);
    const createMany = vi.fn().mockImplementation(async ({ items }) =>
      items.map((item: Record<string, unknown>, index: number) => ({
        ...item,
        id: `recommendation_${index + 1}`,
        createdAt: new Date("2026-03-06T00:00:00.000Z"),
        updatedAt: new Date("2026-03-06T00:00:00.000Z"),
      })),
    );

    const graph = new WatchlistTimingPipelineLangGraph({
      watchListRepository: {
        findById: vi.fn().mockResolvedValue({
          id: "watch_1",
          userId: "user_1",
          name: "Focus",
          stocks: [
            {
              stockCode: { value: "600519" },
              stockName: "Stock-600519",
            },
            {
              stockCode: { value: "000001" },
              stockName: "Stock-000001",
            },
          ],
        }),
      },
      portfolioSnapshotRepository: {
        getByIdForUser: vi.fn().mockResolvedValue(buildPortfolioSnapshot()),
      },
      timingDataClient: {
        getSignalsBatch,
        getMarketContext,
      },
      analysisService: {
        buildTechnicalAssessments: vi.fn().mockReturnValue([]),
        buildCards: vi
          .fn()
          .mockReturnValue([
            buildCardDraft("600519"),
            buildCardDraft("000001"),
          ]),
      },
      presetRepository: {
        getByIdForUser: vi.fn().mockResolvedValue(null),
      },
      marketContextSnapshotRepository: {
        getByAsOfDate: vi.fn().mockResolvedValue(null),
        getLatest: vi.fn().mockResolvedValue(null),
        listRecent: vi.fn().mockResolvedValue([]),
        upsert,
      },
      marketRegimeService: {
        analyze: vi.fn(),
      },
      feedbackService: {
        buildContext: vi.fn().mockResolvedValue({
          presetId: null,
          learningSummary: "No feedback yet.",
          pendingSuggestionCount: 0,
          adoptedSuggestionCount: 0,
          highlights: [],
        }),
      },
      riskManagerService: {
        buildRiskPlan,
      },
      portfolioManagerService: {
        buildRecommendations,
      },
      recommendationRepository: {
        createMany,
      },
      reviewSchedulingService: {
        scheduleForRecommendations: vi.fn().mockResolvedValue({
          records: [],
          reminderIds: [],
        }),
      },
    } as never);

    const initialState = graph.buildInitialState({
      runId: "run_1",
      userId: "user_1",
      query: "watchlist timing",
      input: {
        watchListId: "watch_1",
        portfolioSnapshotId: "portfolio_1",
      },
      progressPercent: 0,
    });

    const finalState = (await graph.execute({
      initialState,
    })) as WatchlistTimingPipelineGraphState;

    expect(getMarketContext).toHaveBeenCalledWith({
      asOfDate: undefined,
    });
    expect(buildRiskPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        marketContextAnalysis: expect.objectContaining({
          state: "NEUTRAL",
          transition: "STABLE",
          summary: expect.stringContaining("市场环境快照暂不可用"),
        }),
      }),
    );
    expect(upsert).not.toHaveBeenCalled();
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(finalState.persistedRecommendations).toHaveLength(1);
    expect(finalState.marketContextAnalysis?.state).toBe("NEUTRAL");
    expect(finalState.marketContextAnalysis?.transition).toBe("STABLE");
    expect(finalState.marketContextAnalysis?.snapshot.asOfDate).toBe(
      "2026-03-06",
    );
  });
});

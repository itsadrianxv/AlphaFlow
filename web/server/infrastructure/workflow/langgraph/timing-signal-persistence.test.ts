import { describe, expect, it, vi } from "vitest";
import type {
  TimingAnalysisCardRecord,
  TimingCardDraft,
  TimingSignalData,
  TimingSignalSnapshotRecord,
} from "~/server/domain/timing/types";
import type {
  TimingSignalPipelineGraphState,
  WatchlistTimingCardsPipelineGraphState,
} from "~/server/domain/workflow/types";
import { TimingSignalPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/timing-signal-graph";
import { WatchlistTimingCardsPipelineLangGraph } from "~/server/infrastructure/workflow/langgraph/watchlist-timing-cards-graph";

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

function buildCardDraft(params: {
  stockCode: string;
  sourceType: "single" | "watchlist";
  sourceId: string;
}): TimingCardDraft {
  const signalData = buildSignalData(params.stockCode);

  return {
    userId: "user_1",
    workflowRunId: "run_1",
    stockCode: params.stockCode,
    stockName: signalData.stockName,
    asOfDate: signalData.asOfDate,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    actionBias: "ADD",
    confidence: 76,
    summary: `${params.stockCode} summary`,
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

function buildSnapshotRecord(params: {
  stockCode: string;
  sourceType: "single" | "watchlist";
  sourceId: string;
}): TimingSignalSnapshotRecord {
  const signalData = buildSignalData(params.stockCode);

  return {
    id: `snapshot-${params.stockCode}`,
    userId: "user_1",
    workflowRunId: "run_1",
    stockCode: params.stockCode,
    stockName: signalData.stockName,
    asOfDate: signalData.asOfDate,
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    timeframe: "DAILY",
    barsCount: signalData.barsCount,
    bars: signalData.bars,
    indicators: signalData.indicators,
    signalContext: signalData.signalContext,
    createdAt: new Date("2026-03-06T00:00:00.000Z"),
  };
}

function buildPersistedCard(params: {
  stockCode: string;
  sourceType: "single" | "watchlist";
  sourceId: string;
}): TimingAnalysisCardRecord {
  return {
    id: `card-${params.stockCode}`,
    userId: "user_1",
    workflowRunId: "run_1",
    watchListId: params.sourceType === "watchlist" ? params.sourceId : null,
    presetId: null,
    stockCode: params.stockCode,
    stockName: `Stock-${params.stockCode}`,
    asOfDate: "2026-03-06",
    sourceType: params.sourceType,
    sourceId: params.sourceId,
    signalSnapshotId: `snapshot-${params.stockCode}`,
    actionBias: "ADD",
    confidence: 76,
    marketState: null,
    marketTransition: null,
    summary: `${params.stockCode} summary`,
    triggerNotes: [],
    invalidationNotes: [],
    riskFlags: [],
    reasoning: buildCardDraft(params).reasoning,
    createdAt: new Date("2026-03-06T00:00:00.000Z"),
    updatedAt: new Date("2026-03-06T00:00:00.000Z"),
  };
}

describe("timing signal persistence graphs", () => {
  it("requests bars for single-stock timing cards and persists them", async () => {
    const getSignal = vi.fn().mockResolvedValue(buildSignalData("600519"));
    const createManySnapshots = vi.fn().mockResolvedValue([
      buildSnapshotRecord({
        stockCode: "600519",
        sourceType: "single",
        sourceId: "600519",
      }),
    ]);
    const createManyCards = vi.fn().mockResolvedValue([
      buildPersistedCard({
        stockCode: "600519",
        sourceType: "single",
        sourceId: "600519",
      }),
    ]);

    const graph = new TimingSignalPipelineLangGraph({
      timingDataClient: {
        getSignal,
      },
      analysisService: {
        buildTechnicalAssessments: vi.fn().mockReturnValue([]),
        buildCards: vi.fn().mockReturnValue([
          buildCardDraft({
            stockCode: "600519",
            sourceType: "single",
            sourceId: "600519",
          }),
        ]),
      },
      presetRepository: {
        getByIdForUser: vi.fn().mockResolvedValue(null),
      },
      signalSnapshotRepository: {
        createMany: createManySnapshots,
      },
      analysisCardRepository: {
        createMany: createManyCards,
      },
    } as never);

    const initialState = graph.buildInitialState({
      runId: "run_1",
      userId: "user_1",
      query: "timing 600519",
      input: {
        stockCode: "600519",
        asOfDate: "2026-03-06",
      },
      progressPercent: 0,
    });

    const finalState = (await graph.execute({
      initialState,
    })) as TimingSignalPipelineGraphState;

    expect(getSignal).toHaveBeenCalledWith({
      stockCode: "600519",
      asOfDate: "2026-03-06",
      includeBars: true,
    });
    expect(createManySnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            stockCode: "600519",
            bars: buildSignalData("600519").bars,
          }),
        ],
      }),
    );
    expect(finalState.persistedSignalSnapshots[0]?.bars).toEqual(
      buildSignalData("600519").bars,
    );
  });

  it("requests bars for watchlist timing cards and persists them", async () => {
    const getSignalsBatch = vi.fn().mockResolvedValue({
      items: [buildSignalData("600519"), buildSignalData("000001")],
      errors: [],
    });
    const createManySnapshots = vi.fn().mockResolvedValue([
      buildSnapshotRecord({
        stockCode: "600519",
        sourceType: "watchlist",
        sourceId: "watch_1",
      }),
      buildSnapshotRecord({
        stockCode: "000001",
        sourceType: "watchlist",
        sourceId: "watch_1",
      }),
    ]);
    const createManyCards = vi.fn().mockResolvedValue([
      buildPersistedCard({
        stockCode: "600519",
        sourceType: "watchlist",
        sourceId: "watch_1",
      }),
      buildPersistedCard({
        stockCode: "000001",
        sourceType: "watchlist",
        sourceId: "watch_1",
      }),
    ]);

    const graph = new WatchlistTimingCardsPipelineLangGraph({
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
      timingDataClient: {
        getSignalsBatch,
      },
      analysisService: {
        buildTechnicalAssessments: vi.fn().mockReturnValue([]),
        buildCards: vi.fn().mockReturnValue([
          buildCardDraft({
            stockCode: "600519",
            sourceType: "watchlist",
            sourceId: "watch_1",
          }),
          buildCardDraft({
            stockCode: "000001",
            sourceType: "watchlist",
            sourceId: "watch_1",
          }),
        ]),
      },
      presetRepository: {
        getByIdForUser: vi.fn().mockResolvedValue(null),
      },
      signalSnapshotRepository: {
        createMany: createManySnapshots,
      },
      analysisCardRepository: {
        createMany: createManyCards,
      },
    } as never);

    const initialState = graph.buildInitialState({
      runId: "run_1",
      userId: "user_1",
      query: "watchlist timing",
      input: {
        watchListId: "watch_1",
        asOfDate: "2026-03-06",
      },
      progressPercent: 0,
    });

    const finalState = (await graph.execute({
      initialState,
    })) as WatchlistTimingCardsPipelineGraphState;

    expect(getSignalsBatch).toHaveBeenCalledWith({
      stockCodes: ["600519", "000001"],
      asOfDate: "2026-03-06",
      includeBars: true,
    });
    expect(createManySnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            stockCode: "600519",
            bars: buildSignalData("600519").bars,
          }),
          expect.objectContaining({
            stockCode: "000001",
            bars: buildSignalData("000001").bars,
          }),
        ],
      }),
    );
    expect(finalState.persistedSignalSnapshots).toHaveLength(2);
  });
});

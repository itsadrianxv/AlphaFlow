import { describe, expect, it, vi } from "vitest";
import { TimingReportService } from "~/modules/timing/server/application/timing-report-service";
import type {
  MarketContextAnalysis,
  MarketContextSnapshot,
  TimingAnalysisCardRecord,
  TimingBar,
  TimingReviewRecord,
} from "~/modules/timing/server/domain/types";

function buildBars(count: number): TimingBar[] {
  const start = new Date("2025-12-17T00:00:00.000Z");

  return Array.from({ length: count }, (_value, index) => {
    const tradeDate = new Date(start);
    tradeDate.setUTCDate(start.getUTCDate() + index);

    return {
      tradeDate: tradeDate.toISOString().slice(0, 10),
      open: 100 + index,
      high: 101 + index,
      low: 99 + index,
      close: 100 + index,
      volume: index === count - 1 ? 6_000 : 1_000 + index * 10,
      amount:
        (index === count - 1 ? 6_000 : 1_000 + index * 10) * (100 + index),
      turnoverRate: 1.2,
    };
  });
}

function buildAnalysis(): MarketContextAnalysis {
  const snapshot: MarketContextSnapshot = {
    asOfDate: "2026-03-06",
    indexes: [],
    latestBreadth: {
      asOfDate: "2026-03-06",
      totalCount: 10,
      advancingCount: 6,
      decliningCount: 3,
      flatCount: 1,
      positiveRatio: 0.6,
      aboveThreePctRatio: 0.2,
      belowThreePctRatio: 0.1,
      medianChangePct: 0.8,
      averageTurnoverRate: 1.4,
    },
    latestVolatility: {
      asOfDate: "2026-03-06",
      highVolatilityCount: 1,
      highVolatilityRatio: 0.1,
      limitDownLikeCount: 0,
      indexAtrRatio: 0.02,
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
      benchmarkStrength: 72,
      breadthScore: 68,
      riskScore: 30,
      stateScore: 70,
    },
  };

  return {
    state: "RISK_ON",
    transition: "IMPROVING",
    regimeConfidence: 78,
    persistenceDays: 4,
    summary: "Market breadth and trend remain constructive.",
    constraints: ["Prioritize stronger names first."],
    breadthTrend: "EXPANDING",
    volatilityTrend: "FALLING",
    leadership: {
      leaderCode: "510300",
      leaderName: "CSI 300 ETF",
      switched: false,
      previousLeaderCode: null,
    },
    snapshot,
    stateScore: 70,
  };
}

function buildCard(): TimingAnalysisCardRecord {
  return {
    id: "card_1",
    userId: "user_1",
    workflowRunId: "run_1",
    watchListId: null,
    presetId: null,
    stockCode: "600519",
    stockName: "贵州茅台",
    asOfDate: "2026-03-06",
    sourceType: "single",
    sourceId: "600519",
    signalSnapshotId: "snapshot_1",
    actionBias: "ADD",
    confidence: 83,
    marketState: "RISK_ON",
    marketTransition: "IMPROVING",
    summary:
      "Trend structure and relative strength both support a constructive stance.",
    triggerNotes: ["Trend alignment remains intact."],
    invalidationNotes: ["A decisive loss of EMA20 would weaken the setup."],
    riskFlags: ["HIGH_VOLATILITY"],
    reasoning: {
      signalContext: {
        direction: "bullish",
        compositeScore: 76,
        signalStrength: 76,
        confidence: 83,
        engineBreakdown: [
          {
            key: "multiTimeframeAlignment",
            label: "多周期一致性",
            status: "positive",
            score: 76,
            confidence: 0.84,
            weight: 0.24,
            detail: "Trend alignment remains strong.",
          },
        ],
        triggerNotes: ["Trend alignment remains intact."],
        invalidationNotes: ["A decisive loss of EMA20 would weaken the setup."],
        riskFlags: ["HIGH_VOLATILITY"],
        explanation: "Trend and relative strength remain supportive.",
        summary: "Composite 76, bullish structure remains intact.",
      },
      actionRationale:
        "The structure remains constructive and supports adding risk on confirmation.",
      indicators: {
        close: 1680,
        macd: { dif: 12, dea: 8, histogram: 8 },
        rsi: { value: 64 },
        bollinger: {
          upper: 1700,
          middle: 1620,
          lower: 1540,
          closePosition: 0.78,
        },
        obv: { value: 12_000, slope: 450 },
        ema5: 1668,
        ema20: 1628,
        ema60: 1542,
        ema120: 1488,
        atr14: 32,
        volumeRatio20: 1.64,
        realizedVol20: 0.28,
        realizedVol120: 0.23,
        amount: 2_450_000_000,
        turnoverRate: 2.6,
      },
    },
    createdAt: new Date("2026-03-06T10:00:00.000Z"),
    updatedAt: new Date("2026-03-06T10:00:00.000Z"),
    signalSnapshot: {
      id: "snapshot_1",
      userId: "user_1",
      workflowRunId: "run_1",
      stockCode: "600519",
      stockName: "贵州茅台",
      asOfDate: "2026-03-06",
      sourceType: "single",
      sourceId: "600519",
      timeframe: "DAILY",
      barsCount: 260,
      bars: undefined,
      indicators: {
        close: 1680,
        macd: { dif: 12, dea: 8, histogram: 8 },
        rsi: { value: 64 },
        bollinger: {
          upper: 1700,
          middle: 1620,
          lower: 1540,
          closePosition: 0.78,
        },
        obv: { value: 12_000, slope: 450 },
        ema5: 1668,
        ema20: 1628,
        ema60: 1542,
        ema120: 1488,
        atr14: 32,
        volumeRatio20: 1.64,
        realizedVol20: 0.28,
        realizedVol120: 0.23,
        amount: 2_450_000_000,
        turnoverRate: 2.6,
      },
      signalContext: {
        engines: [
          {
            key: "multiTimeframeAlignment",
            label: "多周期一致性",
            direction: "bullish",
            score: 76,
            confidence: 0.84,
            weight: 0.24,
            detail: "EMA stack and medium-term returns remain supportive.",
            metrics: {
              bullishChecks: 6,
              bearishChecks: 1,
              return20d: 12.4,
            },
            warnings: [],
          },
          {
            key: "relativeStrength",
            label: "相对强弱",
            direction: "bullish",
            score: 66,
            confidence: 0.78,
            weight: 0.2,
            detail:
              "Relative returns remain positive against benchmark proxies.",
            metrics: {
              excess20d: 4.8,
              excess60d: 9.2,
            },
            warnings: [],
          },
          {
            key: "volatilityPercentile",
            label: "波动环境",
            direction: "neutral",
            score: 12,
            confidence: 0.52,
            weight: 0.14,
            detail: "Volatility remains manageable.",
            metrics: {
              volatilityPercentile: 46,
              atrPercentile: 48,
            },
            warnings: ["HIGH_VOLATILITY"],
          },
          {
            key: "liquidityStructure",
            label: "流动性结构",
            direction: "bullish",
            score: 58,
            confidence: 0.71,
            weight: 0.14,
            detail: "Turnover and amount percentiles remain healthy.",
            metrics: {
              volumeRatio20: 1.64,
              amountPercentile: 81,
              turnoverRate: 2.6,
            },
            warnings: [],
          },
          {
            key: "breakoutFailure",
            label: "突破有效性",
            direction: "bullish",
            score: 55,
            confidence: 0.69,
            weight: 0.14,
            detail: "Recent breakout failure rate remains low.",
            metrics: {
              failureRate: 18,
              distanceTo60dHighPct: -1.2,
            },
            warnings: [],
          },
          {
            key: "gapVolumeQuality",
            label: "缺口与放量质量",
            direction: "neutral",
            score: 16,
            confidence: 0.51,
            weight: 0.14,
            detail: "Recent gap activity is constructive but not decisive.",
            metrics: {
              recentGapCount: 2,
              latestVolumeRatio20: 1.64,
            },
            warnings: [],
          },
        ],
        composite: {
          score: 76,
          confidence: 0.83,
          direction: "bullish",
          signalStrength: 76,
          participatingEngines: 6,
        },
      },
      createdAt: new Date("2026-03-06T10:00:00.000Z"),
    },
  };
}

function buildReviewRecord(index: number): TimingReviewRecord {
  const date = new Date("2026-03-01T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + index);

  return {
    id: `review_${index}`,
    userId: "user_1",
    analysisCardId: "card_1",
    recommendationId: null,
    stockCode: "600519",
    stockName: "贵州茅台",
    sourceAsOfDate: "2026-03-06",
    reviewHorizon: "T5",
    scheduledAt: date,
    completedAt: date,
    expectedAction: "ADD",
    actualReturnPct: 4.2 + index,
    maxFavorableExcursionPct: 6 + index,
    maxAdverseExcursionPct: -2 + index * 0.1,
    verdict: "SUCCESS",
    reviewSummary: `Review ${index}`,
    createdAt: date,
    updatedAt: date,
  };
}

describe("TimingReportService", () => {
  it("prefers persisted snapshot bars and skips live timing bars requests", async () => {
    const persistedBars = buildBars(60);
    const analysis = buildAnalysis();
    const card = buildCard();
    const signalSnapshot = card.signalSnapshot;
    if (!signalSnapshot) {
      throw new Error("signal snapshot is required for this test");
    }
    card.signalSnapshot = {
      ...signalSnapshot,
      bars: persistedBars,
    };

    const getBars = vi.fn();
    const updateFrozenBars = vi.fn();
    const service = new TimingReportService({
      analysisCardRepository: {
        getByIdForUser: vi.fn().mockResolvedValue(card),
      },
      signalSnapshotRepository: {
        updateFrozenBars,
      },
      reviewRecordRepository: {
        listForUser: vi.fn().mockResolvedValue([]),
      },
      marketContextSnapshotRepository: {
        getByAsOfDate: vi.fn().mockResolvedValue({
          id: "market_1",
          asOfDate: "2026-03-06",
          state: analysis.state,
          transition: analysis.transition,
          persistenceDays: analysis.persistenceDays,
          snapshot: analysis.snapshot,
          analysis,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        listRecent: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
      },
      timingDataClient: {
        getBars,
        getMarketContext: vi.fn(),
      },
      marketRegimeService: {
        analyze: vi.fn(),
      },
    });

    const report = await service.getTimingReport({
      userId: "user_1",
      cardId: "card_1",
    });

    expect(report?.bars).toEqual(persistedBars);
    expect(getBars).not.toHaveBeenCalled();
    expect(updateFrozenBars).not.toHaveBeenCalled();
  });

  it("aggregates a timing report with aligned bars, evidence, and completed review timeline", async () => {
    const bars = buildBars(80);
    const analysis = buildAnalysis();
    const service = new TimingReportService({
      analysisCardRepository: {
        getByIdForUser: vi.fn().mockResolvedValue(buildCard()),
      },
      signalSnapshotRepository: {
        updateFrozenBars: vi.fn(),
      },
      reviewRecordRepository: {
        listForUser: vi
          .fn()
          .mockResolvedValue(
            Array.from({ length: 5 }, (_value, index) =>
              buildReviewRecord(index),
            ),
          ),
      },
      marketContextSnapshotRepository: {
        getByAsOfDate: vi.fn().mockResolvedValue({
          id: "market_1",
          asOfDate: "2026-03-06",
          state: analysis.state,
          transition: analysis.transition,
          persistenceDays: analysis.persistenceDays,
          snapshot: analysis.snapshot,
          analysis,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        listRecent: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
      },
      timingDataClient: {
        getBars: vi.fn().mockResolvedValue({
          stockCode: "600519",
          stockName: "贵州茅台",
          timeframe: "DAILY",
          adjust: "qfq",
          bars,
        }),
        getMarketContext: vi.fn(),
      },
      marketRegimeService: {
        analyze: vi.fn(),
      },
    });

    const report = await service.getTimingReport({
      userId: "user_1",
      cardId: "card_1",
    });

    expect(report).not.toBeNull();
    expect(report?.card.id).toBe("card_1");
    expect(report?.bars).toHaveLength(80);
    expect(report?.bars.at(-1)?.tradeDate).toBe("2026-03-06");
    expect(report?.chartLevels.recentHigh60d).toBe(180);
    expect(report?.chartLevels.recentLow20d).toBe(159);
    expect(report?.chartLevels.volumeSpikeDates).toContain("2026-03-06");
    expect(report?.evidence.multiTimeframeAlignment.metrics.bullishChecks).toBe(
      6,
    );
    expect(report?.evidence.relativeStrength.metrics.excess60d).toBe(9.2);
    expect(report?.marketContext.state).toBe("RISK_ON");
    expect(report?.reviewTimeline).toHaveLength(5);
    expect(report?.reviewTimeline[0]?.completedAt).not.toBeNull();
  });

  it("builds a fallback market context when no aligned snapshot exists", async () => {
    const bars = buildBars(80);
    const upsert = vi.fn();
    const getMarketContext = vi.fn();
    const analyze = vi.fn();
    const service = new TimingReportService({
      analysisCardRepository: {
        getByIdForUser: vi.fn().mockResolvedValue(buildCard()),
      },
      signalSnapshotRepository: {
        updateFrozenBars: vi.fn(),
      },
      reviewRecordRepository: {
        listForUser: vi.fn().mockResolvedValue([]),
      },
      marketContextSnapshotRepository: {
        getByAsOfDate: vi.fn().mockResolvedValue(null),
        listRecent: vi.fn().mockResolvedValue([]),
        upsert,
      },
      timingDataClient: {
        getBars: vi.fn().mockResolvedValue({
          stockCode: "600519",
          stockName: "贵州茅台",
          timeframe: "DAILY",
          adjust: "qfq",
          bars,
        }),
        getMarketContext,
      },
      marketRegimeService: {
        analyze,
      },
    });

    const report = await service.getTimingReport({
      userId: "user_1",
      cardId: "card_1",
    });

    expect(getMarketContext).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(report?.marketContext.state).toBe("RISK_ON");
    expect(report?.marketContext.transition).toBe("IMPROVING");
    expect(report?.marketContext.summary).toContain("市场环境快照");
  });

  it("backfills frozen bars when falling back to live timing data", async () => {
    const bars = buildBars(80);
    const analysis = buildAnalysis();
    const updateFrozenBars = vi.fn().mockResolvedValue(undefined);
    const service = new TimingReportService({
      analysisCardRepository: {
        getByIdForUser: vi.fn().mockResolvedValue(buildCard()),
      },
      signalSnapshotRepository: {
        updateFrozenBars,
      },
      reviewRecordRepository: {
        listForUser: vi.fn().mockResolvedValue([]),
      },
      marketContextSnapshotRepository: {
        getByAsOfDate: vi.fn().mockResolvedValue({
          id: "market_1",
          asOfDate: "2026-03-06",
          state: analysis.state,
          transition: analysis.transition,
          persistenceDays: analysis.persistenceDays,
          snapshot: analysis.snapshot,
          analysis,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        listRecent: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
      },
      timingDataClient: {
        getBars: vi.fn().mockResolvedValue({
          stockCode: "600519",
          stockName: "璐靛窞鑼呭彴",
          timeframe: "DAILY",
          adjust: "qfq",
          bars,
        }),
        getMarketContext: vi.fn(),
      },
      marketRegimeService: {
        analyze: vi.fn(),
      },
    });

    const report = await service.getTimingReport({
      userId: "user_1",
      cardId: "card_1",
    });

    expect(report?.bars).toEqual(bars);
    expect(updateFrozenBars).toHaveBeenCalledWith({
      signalSnapshotId: "snapshot_1",
      bars,
    });
  });

  it("uses a neutral fallback market posture when the card itself has no market posture", async () => {
    const card = buildCard();
    card.marketState = null;
    card.marketTransition = null;
    const signalSnapshot = card.signalSnapshot;
    if (!signalSnapshot) {
      throw new Error("signal snapshot is required for this test");
    }
    card.signalSnapshot = {
      ...signalSnapshot,
      bars: buildBars(60),
    };

    const service = new TimingReportService({
      analysisCardRepository: {
        getByIdForUser: vi.fn().mockResolvedValue(card),
      },
      signalSnapshotRepository: {
        updateFrozenBars: vi.fn(),
      },
      reviewRecordRepository: {
        listForUser: vi.fn().mockResolvedValue([]),
      },
      marketContextSnapshotRepository: {
        getByAsOfDate: vi.fn().mockResolvedValue(null),
        listRecent: vi.fn().mockResolvedValue([]),
        upsert: vi.fn(),
      },
      timingDataClient: {
        getBars: vi.fn(),
        getMarketContext: vi.fn(),
      },
      marketRegimeService: {
        analyze: vi.fn(),
      },
    });

    const report = await service.getTimingReport({
      userId: "user_1",
      cardId: "card_1",
    });

    expect(report).not.toBeNull();
    expect(report?.marketContext.state).toBe("NEUTRAL");
    expect(report?.marketContext.transition).toBe("STABLE");
    expect(report?.marketContext.summary).toContain("市场环境快照");
    expect(report?.marketContext.constraints).not.toHaveLength(0);
  });
});

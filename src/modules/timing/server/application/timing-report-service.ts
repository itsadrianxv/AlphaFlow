import type { MarketRegimeService } from "~/modules/timing/server/application/market-regime-service";
import type {
  MarketContextAnalysis,
  TimingAnalysisCardRecord,
  TimingBar,
  TimingChartLevels,
  TimingChartLinePoint,
  TimingReportEvidence,
  TimingReportPayload,
  TimingSignalEngineKey,
  TimingSignalEngineResult,
} from "~/modules/timing/server/domain/types";
import type { PrismaTimingAnalysisCardRepository } from "~/modules/timing/server/infrastructure/prisma-timing-analysis-card-repository";
import type { PrismaTimingMarketContextSnapshotRepository } from "~/modules/timing/server/infrastructure/prisma-timing-market-context-snapshot-repository";
import type { PrismaTimingReviewRecordRepository } from "~/modules/timing/server/infrastructure/prisma-timing-review-record-repository";
import type { PrismaTimingSignalSnapshotRepository } from "~/modules/timing/server/infrastructure/prisma-timing-signal-snapshot-repository";
import type { PythonTimingDataClient } from "~/modules/timing/server/infrastructure/python-timing-data-client";

const TIMING_REPORT_EVIDENCE_KEYS: TimingSignalEngineKey[] = [
  "multiTimeframeAlignment",
  "relativeStrength",
  "volatilityPercentile",
  "liquidityStructure",
  "breakoutFailure",
  "gapVolumeQuality",
];

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function hasFrozenBars(bars?: TimingBar[]) {
  return Array.isArray(bars) && bars.length > 0;
}

function calculateEmaSeries(
  bars: TimingBar[],
  period: number,
): TimingChartLinePoint[] {
  if (bars.length === 0) {
    return [];
  }

  const multiplier = 2 / (period + 1);
  let previous = bars[0]?.close ?? 0;

  return bars.map((bar, index) => {
    if (index === 0) {
      previous = bar.close;
    } else {
      previous = (bar.close - previous) * multiplier + previous;
    }

    return {
      tradeDate: bar.tradeDate,
      value: Math.round(previous * 10_000) / 10_000,
    };
  });
}

function computeChartLevels(bars: TimingBar[]): TimingChartLevels {
  const last60 = bars.slice(-60);
  const last20 = bars.slice(-20);
  const avgVolume20 = average(last20.map((bar) => bar.volume));

  const volumeSpikeDates = bars
    .map((bar, index) => {
      const window = bars.slice(Math.max(0, index - 19), index + 1);
      const windowAverage = average(window.map((item) => item.volume));

      return windowAverage > 0 && bar.volume >= windowAverage * 1.5
        ? bar.tradeDate
        : null;
    })
    .filter((value): value is string => Boolean(value));

  return {
    ema5: calculateEmaSeries(bars, 5),
    ema20: calculateEmaSeries(bars, 20),
    ema60: calculateEmaSeries(bars, 60),
    ema120: calculateEmaSeries(bars, 120),
    recentHigh60d:
      Math.max(...last60.map((bar) => bar.high), bars.at(-1)?.high ?? 0) || 0,
    recentLow20d:
      Math.min(...last20.map((bar) => bar.low), bars.at(-1)?.low ?? 0) || 0,
    avgVolume20: Math.round(avgVolume20 * 10_000) / 10_000,
    volumeSpikeDates,
  };
}

function toPlaceholderEvidence(
  key: TimingSignalEngineKey,
): TimingSignalEngineResult {
  return {
    key,
    label: key,
    direction: "neutral",
    score: 0,
    confidence: 0,
    weight: 0,
    detail: "No evidence available.",
    metrics: {},
    warnings: [],
  };
}

function buildEvidence(
  engines: TimingSignalEngineResult[],
): TimingReportEvidence {
  const engineByKey = new Map(engines.map((engine) => [engine.key, engine]));

  return TIMING_REPORT_EVIDENCE_KEYS.reduce((record, key) => {
    record[key] = engineByKey.get(key) ?? toPlaceholderEvidence(key);
    return record;
  }, {} as TimingReportEvidence);
}

function buildFallbackMarketContext(params: {
  card: TimingAnalysisCardRecord;
  asOfDate: string;
}): MarketContextAnalysis {
  const state = params.card.marketState ?? "NEUTRAL";
  const transition = params.card.marketTransition ?? "STABLE";

  return {
    state,
    transition,
    regimeConfidence: params.card.confidence,
    persistenceDays: 0,
    summary:
      "市场环境快照暂不可用，当前报告先使用降级市场上下文占位展示，不阻塞择时报告详情加载。",
    constraints: [
      `未找到 ${params.asOfDate} 的市场环境快照，详情页未再同步请求实时 market context。`,
      "市场广度、波动与领涨代理数据恢复后，可由后续任务重新生成完整市场环境快照。",
    ],
    breadthTrend:
      state === "RISK_ON"
        ? "EXPANDING"
        : state === "RISK_OFF"
          ? "CONTRACTING"
          : "STALLING",
    volatilityTrend:
      state === "RISK_ON"
        ? "FALLING"
        : state === "RISK_OFF"
          ? "RISING"
          : "STABLE",
    leadership: {
      leaderCode: "",
      leaderName: "N/A",
      switched: false,
      previousLeaderCode: null,
    },
    snapshot: {
      asOfDate: params.asOfDate,
      indexes: [],
      latestBreadth: {
        asOfDate: params.asOfDate,
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
        asOfDate: params.asOfDate,
        highVolatilityCount: 0,
        highVolatilityRatio: 0,
        limitDownLikeCount: 0,
        indexAtrRatio: 0,
      },
      latestLeadership: {
        asOfDate: params.asOfDate,
        leaderCode: "",
        leaderName: "N/A",
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
        stateScore: 0,
      },
    },
    stateScore: 0,
  };
}

export class TimingReportService {
  constructor(
    private readonly deps: {
      analysisCardRepository: Pick<
        PrismaTimingAnalysisCardRepository,
        "getByIdForUser"
      >;
      signalSnapshotRepository: Pick<
        PrismaTimingSignalSnapshotRepository,
        "updateFrozenBars"
      >;
      reviewRecordRepository: Pick<
        PrismaTimingReviewRecordRepository,
        "listForUser"
      >;
      marketContextSnapshotRepository: Pick<
        PrismaTimingMarketContextSnapshotRepository,
        "getByAsOfDate" | "listRecent" | "upsert"
      >;
      timingDataClient: Pick<
        PythonTimingDataClient,
        "getBars" | "getMarketContext"
      >;
      marketRegimeService: Pick<MarketRegimeService, "analyze">;
    },
  ) {}

  async getTimingReport(params: {
    userId: string;
    cardId: string;
  }): Promise<TimingReportPayload | null> {
    const card = await this.deps.analysisCardRepository.getByIdForUser(
      params.userId,
      params.cardId,
    );

    if (!card) {
      return null;
    }

    const asOfDate = card.asOfDate ?? card.signalSnapshot?.asOfDate;
    if (!asOfDate) {
      return null;
    }

    const [bars, reviewTimeline, marketSnapshot] = await Promise.all([
      hasFrozenBars(card.signalSnapshot?.bars)
        ? Promise.resolve(card.signalSnapshot?.bars ?? [])
        : this.deps.timingDataClient
            .getBars({
              stockCode: card.stockCode,
              end: asOfDate,
            })
            .then(async (barsResponse) => {
              if (card.signalSnapshotId) {
                await this.deps.signalSnapshotRepository.updateFrozenBars({
                  signalSnapshotId: card.signalSnapshotId,
                  bars: barsResponse.bars,
                });
              }

              return barsResponse.bars;
            }),
      this.deps.reviewRecordRepository.listForUser({
        userId: params.userId,
        stockCode: card.stockCode,
        limit: 5,
        completedOnly: true,
      }),
      this.deps.marketContextSnapshotRepository.getByAsOfDate(asOfDate),
    ]);

    const marketContext =
      marketSnapshot?.analysis ??
      buildFallbackMarketContext({
        card,
        asOfDate,
      });

    return {
      card,
      bars,
      chartLevels: computeChartLevels(bars),
      evidence: buildEvidence(card.signalSnapshot?.signalContext.engines ?? []),
      marketContext,
      reviewTimeline,
    };
  }
}

import type { MarketRegimeService } from "~/server/application/timing/market-regime-service";
import type {
  TimingBar,
  TimingChartLevels,
  TimingChartLinePoint,
  TimingReportEvidence,
  TimingReportPayload,
  TimingSignalEngineKey,
  TimingSignalEngineResult,
} from "~/server/domain/timing/types";
import type { PrismaTimingAnalysisCardRepository } from "~/server/infrastructure/timing/prisma-timing-analysis-card-repository";
import type { PrismaTimingMarketContextSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-market-context-snapshot-repository";
import type { PrismaTimingReviewRecordRepository } from "~/server/infrastructure/timing/prisma-timing-review-record-repository";
import type { PythonTimingDataClient } from "~/server/infrastructure/timing/python-timing-data-client";

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

export class TimingReportService {
  constructor(
    private readonly deps: {
      analysisCardRepository: Pick<
        PrismaTimingAnalysisCardRepository,
        "getByIdForUser"
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

    const [barsResponse, reviewTimeline, marketSnapshot] = await Promise.all([
      this.deps.timingDataClient.getBars({
        stockCode: card.stockCode,
        end: asOfDate,
      }),
      this.deps.reviewRecordRepository.listForUser({
        userId: params.userId,
        stockCode: card.stockCode,
        limit: 5,
        completedOnly: true,
      }),
      this.deps.marketContextSnapshotRepository.getByAsOfDate(asOfDate),
    ]);

    let marketContext = marketSnapshot?.analysis;
    if (!marketContext) {
      const snapshot = await this.deps.timingDataClient.getMarketContext({
        asOfDate,
      });
      const recent =
        await this.deps.marketContextSnapshotRepository.listRecent(20);
      marketContext = this.deps.marketRegimeService.analyze(
        snapshot,
        recent.filter(
          (item: { asOfDate: string }) => item.asOfDate !== asOfDate,
        ),
      );
      await this.deps.marketContextSnapshotRepository.upsert({
        asOfDate,
        snapshot,
        analysis: marketContext,
      });
    }

    return {
      card,
      bars: barsResponse.bars,
      chartLevels: computeChartLevels(barsResponse.bars),
      evidence: buildEvidence(card.signalSnapshot?.signalContext.engines ?? []),
      marketContext,
      reviewTimeline,
    };
  }
}

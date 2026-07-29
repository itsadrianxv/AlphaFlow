import type {
  MarketContextAnalysis,
  TimingBar,
  TimingChartLevels,
  TimingChartLinePoint,
  TimingReportEvidence,
  TimingReportPayload,
  TimingReportSeriesPayload,
  TimingSignalEngineKey,
  TimingTimeframe,
} from "~/server/domain/timing/types";
import type { PrismaTimingKronosForecastSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-kronos-forecast-snapshot-repository";
import type { PrismaTimingMarketContextSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-market-context-snapshot-repository";
import type { PrismaTimingResearchReportRepository } from "~/server/infrastructure/timing/prisma-timing-research-report-repository";
import type { PrismaTimingSignalSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-signal-snapshot-repository";
import type { PythonTimingDataClient } from "~/server/infrastructure/timing/python-timing-data-client";

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function calculateEmaSeries(bars: TimingBar[], period: number): TimingChartLinePoint[] {
  const multiplier = 2 / (period + 1);
  let previous = bars[0]?.close ?? 0;
  return bars.map((bar, index) => {
    previous = index === 0 ? bar.close : (bar.close - previous) * multiplier + previous;
    return { tradeDate: bar.tradeDate, value: Math.round(previous * 10_000) / 10_000 };
  });
}

export function computeTimingChartLevels(bars: TimingBar[]): TimingChartLevels {
  const last60 = bars.slice(-60);
  const last20 = bars.slice(-20);
  return {
    ema5: calculateEmaSeries(bars, 5),
    ema20: calculateEmaSeries(bars, 20),
    ema60: calculateEmaSeries(bars, 60),
    ema120: calculateEmaSeries(bars, 120),
    recentHigh60d: Math.max(...last60.map((bar) => bar.high), bars.at(-1)?.high ?? 0) || 0,
    recentLow20d: Math.min(...last20.map((bar) => bar.low), bars.at(-1)?.low ?? 0) || 0,
    avgVolume20: Math.round(average(last20.map((bar) => bar.volume)) * 10_000) / 10_000,
    volumeSpikeDates: bars.flatMap((bar, index) => {
      const windowAverage = average(bars.slice(Math.max(0, index - 19), index + 1).map((item) => item.volume));
      return windowAverage > 0 && bar.volume >= windowAverage * 1.5 ? [bar.tradeDate] : [];
    }),
  };
}

function buildEvidence(engines: NonNullable<TimingReportPayload["report"]["signalSnapshot"]>["signalContext"]["engines"]): TimingReportEvidence {
  return Object.fromEntries(engines.map((engine) => [engine.key, engine])) as TimingReportEvidence;
}

function fallbackMarketContext(asOfDate: string): MarketContextAnalysis {
  return {
    state: "NEUTRAL",
    transition: "STABLE",
    regimeConfidence: 0,
    persistenceDays: 0,
    summary: "市场环境快照不可用，本报告不据此调整个股研究状态。",
    constraints: ["市场广度、波动与领涨结构暂不可用。"],
    breadthTrend: "STALLING",
    volatilityTrend: "STABLE",
    leadership: { leaderCode: "", leaderName: "暂无", switched: false, previousLeaderCode: null },
    snapshot: {
      asOfDate,
      indexes: [],
      latestBreadth: { asOfDate, totalCount: 0, advancingCount: 0, decliningCount: 0, flatCount: 0, positiveRatio: 0, aboveThreePctRatio: 0, belowThreePctRatio: 0, medianChangePct: 0, averageTurnoverRate: null },
      latestVolatility: { asOfDate, highVolatilityCount: 0, highVolatilityRatio: 0, limitDownLikeCount: 0, indexAtrRatio: 0 },
      latestLeadership: { asOfDate, leaderCode: "", leaderName: "暂无", ranking5d: [], ranking10d: [], switched: false, previousLeaderCode: null },
      breadthSeries: [],
      volatilitySeries: [],
      leadershipSeries: [],
      features: { benchmarkStrength: 0, breadthScore: 0, riskScore: 0, stateScore: 0 },
    },
    stateScore: 0,
  };
}

export class TimingReportService {
  constructor(private readonly deps: {
    researchReportRepository: Pick<PrismaTimingResearchReportRepository, "getByIdForUser">;
    signalSnapshotRepository: Pick<PrismaTimingSignalSnapshotRepository, "updateFrozenBars">;
    marketContextSnapshotRepository: Pick<PrismaTimingMarketContextSnapshotRepository, "getByAsOfDate">;
    kronosForecastSnapshotRepository?: Pick<PrismaTimingKronosForecastSnapshotRepository, "getLatestForStock">;
    timingDataClient: Pick<PythonTimingDataClient, "getBars">;
  }) {}

  async getTimingReport(params: { userId: string; reportId: string }): Promise<TimingReportPayload | null> {
    const report = await this.deps.researchReportRepository.getByIdForUser(params.userId, params.reportId);
    if (!report) return null;
    const asOfDate = report.asOfDate ?? report.signalSnapshot?.asOfDate;
    if (!asOfDate) return null;
    let bars = report.signalSnapshot?.bars ?? [];
    if (!bars.length) {
      bars = (await this.deps.timingDataClient.getBars({ stockCode: report.stockCode, end: asOfDate })).bars;
      if (report.signalSnapshotId) await this.deps.signalSnapshotRepository.updateFrozenBars({ signalSnapshotId: report.signalSnapshotId, bars });
    }
    const [marketSnapshot, forecastSnapshot] = await Promise.all([
      this.deps.marketContextSnapshotRepository.getByAsOfDate(asOfDate),
      this.deps.kronosForecastSnapshotRepository?.getLatestForStock({ userId: params.userId, stockCode: report.stockCode, asOfDate, timeframe: "DAILY" }) ?? Promise.resolve(null),
    ]);
    return {
      report,
      bars,
      chartLevels: computeTimingChartLevels(bars),
      evidence: buildEvidence(report.signalSnapshot?.signalContext.engines ?? []),
      marketContext: marketSnapshot?.analysis ?? fallbackMarketContext(asOfDate),
      modelOutlook: forecastSnapshot?.forecast,
    };
  }

  async getTimingSeries(params: { userId: string; reportId: string; timeframe: TimingTimeframe }): Promise<TimingReportSeriesPayload | null> {
    const report = await this.deps.researchReportRepository.getByIdForUser(params.userId, params.reportId);
    if (!report) return null;
    const asOfDate = report.asOfDate ?? report.signalSnapshot?.asOfDate;
    if (!asOfDate) return null;
    const frozen = report.signalSnapshot?.barsByTimeframe?.[params.timeframe];
    const response = frozen?.length ? null : await this.deps.timingDataClient.getBars({ stockCode: report.stockCode, end: asOfDate, timeframe: params.timeframe });
    const bars = frozen ?? response?.bars ?? [];
    const forecast = await this.deps.kronosForecastSnapshotRepository?.getLatestForStock({ userId: params.userId, stockCode: report.stockCode, asOfDate, timeframe: params.timeframe });
    return {
      stockCode: report.stockCode,
      stockName: report.stockName,
      timeframe: params.timeframe,
      adjust: params.timeframe.startsWith("MINUTE_") ? "none" : "qfq",
      bars,
      chartLevels: computeTimingChartLevels(bars),
      modelOutlook: forecast?.forecast,
      warnings: forecast?.warnings ?? [],
    };
  }
}

import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  TimingBar,
  TimingEvidenceData,
  TimingSignalData,
  TimingSignalSnapshotRecord,
  TimingSourceType,
} from "~/server/domain/timing/types";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function mapRecord(record: {
  id: string;
  userId: string;
  workflowRunId: string | null;
  stockCode: string;
  stockName: string;
  asOfDate: Date;
  sourceType: string;
  sourceId: string;
  timeframe: string;
  barsCount: number;
  bars: unknown;
  barsByTimeframe: unknown;
  indicators: unknown;
  signalContext: unknown;
  presetRevisionId: string | null;
  featureEvidence: unknown;
  dataManifest: unknown;
  featureVersion: string | null;
  inputHash: string | null;
  createdAt: Date;
}): TimingSignalSnapshotRecord {
  return {
    id: record.id,
    userId: record.userId,
    workflowRunId: record.workflowRunId,
    stockCode: record.stockCode,
    stockName: record.stockName,
    asOfDate: record.asOfDate.toISOString().slice(0, 10),
    sourceType: record.sourceType as TimingSourceType,
    sourceId: record.sourceId,
    timeframe: record.timeframe as "DAILY",
    barsCount: record.barsCount,
    bars: (record.bars as TimingBar[] | null | undefined) ?? undefined,
    barsByTimeframe:
      record.barsByTimeframe as TimingSignalSnapshotRecord["barsByTimeframe"],
    indicators: record.indicators as TimingSignalData["indicators"],
    signalContext: record.signalContext as TimingSignalData["signalContext"],
    presetRevisionId: record.presetRevisionId,
    featureEvidence:
      (record.featureEvidence as TimingSignalSnapshotRecord["featureEvidence"]) ??
      undefined,
    dataManifest:
      (record.dataManifest as TimingSignalSnapshotRecord["dataManifest"]) ??
      undefined,
    featureVersion: record.featureVersion,
    inputHash: record.inputHash,
    createdAt: record.createdAt,
  };
}

export class PrismaTimingSignalSnapshotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createMany(params: {
    userId: string;
    workflowRunId?: string;
    sourceType: TimingSourceType;
    sourceId: string;
    presetRevisionId?: string;
    items: Array<TimingSignalData | TimingEvidenceData>;
  }) {
    const records = await this.prisma.$transaction(
      params.items.map((item) => {
        const isEvidence = "features" in item;
        const dailyBars = isEvidence ? item.barsByTimeframe.DAILY : item.bars;
        return this.prisma.timingSignalSnapshot.create({
          data: {
            userId: params.userId,
            workflowRunId: params.workflowRunId,
            stockCode: item.stockCode,
            stockName: item.stockName,
            asOfDate: toDateOnly(item.asOfDate),
            sourceType: params.sourceType,
            sourceId: params.sourceId,
            timeframe: "DAILY",
            barsCount: isEvidence ? (dailyBars?.length ?? 0) : item.barsCount,
            bars: dailyBars ? toJson(dailyBars) : undefined,
            barsByTimeframe: item.barsByTimeframe
              ? toJson(item.barsByTimeframe)
              : undefined,
            indicators: toJson(
              isEvidence
                ? {
                    close: 0, macd: { dif: 0, dea: 0, histogram: 0 },
                    rsi: { value: 50 }, bollinger: { upper: 0, middle: 0, lower: 0, closePosition: 0.5 },
                    obv: { value: 0, slope: 0 }, ema5: 0, ema20: 0, ema60: 0, ema120: 0,
                    atr14: 0, volumeRatio20: 0, realizedVol20: 0, realizedVol120: 0,
                  }
                : item.indicators,
            ),
            signalContext: toJson(
              isEvidence
                ? {
                    engines: [],
                    composite: { score: 0, confidence: 0, direction: "neutral", signalStrength: 0, participatingEngines: 0 },
                  }
                : item.signalContext,
            ),
            presetRevisionId: params.presetRevisionId,
            featureEvidence: isEvidence ? toJson(item.features) : undefined,
            dataManifest: isEvidence ? toJson(item.dataManifest) : undefined,
            featureVersion: isEvidence ? item.featureVersion : undefined,
            inputHash: isEvidence ? item.inputHash : undefined,
          },
        });
      }),
    );

    return records.map((record) => mapRecord(record));
  }

  async updateFrozenBars(params: {
    signalSnapshotId: string;
    bars: TimingBar[];
  }) {
    const record = await this.prisma.timingSignalSnapshot.update({
      where: {
        id: params.signalSnapshotId,
      },
      data: {
        barsCount: params.bars.length,
        bars: toJson(params.bars),
      },
    });

    return mapRecord(record);
  }
}

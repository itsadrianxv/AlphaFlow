import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  TimingBar,
  TimingSignalData,
  TimingSignalSnapshotRecord,
  TimingSourceType,
} from "~/modules/timing/server/domain/types";

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
  indicators: unknown;
  signalContext: unknown;
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
    indicators: record.indicators as TimingSignalData["indicators"],
    signalContext: record.signalContext as TimingSignalData["signalContext"],
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
    items: TimingSignalData[];
  }) {
    const records = await this.prisma.$transaction(
      params.items.map((item) =>
        this.prisma.timingSignalSnapshot.create({
          data: {
            userId: params.userId,
            workflowRunId: params.workflowRunId,
            stockCode: item.stockCode,
            stockName: item.stockName,
            asOfDate: toDateOnly(item.asOfDate),
            sourceType: params.sourceType,
            sourceId: params.sourceId,
            timeframe: "DAILY",
            barsCount: item.barsCount,
            bars: item.bars ? toJson(item.bars) : undefined,
            indicators: toJson(item.indicators),
            signalContext: toJson(item.signalContext),
          },
        }),
      ),
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

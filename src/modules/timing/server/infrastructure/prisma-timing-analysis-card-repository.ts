import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  TimingAnalysisCardRecord,
  TimingBar,
  TimingCardDraft,
  TimingCardReasoning,
  TimingRiskFlag,
  TimingSignalSnapshotRecord,
  TimingSourceType,
} from "~/modules/timing/server/domain/types";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

function mapSignalSnapshot(record: {
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
    indicators: record.indicators as TimingSignalSnapshotRecord["indicators"],
    signalContext:
      record.signalContext as TimingSignalSnapshotRecord["signalContext"],
    createdAt: record.createdAt,
  };
}

function mapCard(record: {
  id: string;
  userId: string;
  workflowRunId: string | null;
  watchListId: string | null;
  presetId: string | null;
  stockCode: string;
  stockName: string;
  sourceType: string;
  sourceId: string;
  signalSnapshotId: string;
  actionBias: string;
  confidence: number;
  marketState: string | null;
  marketTransition: string | null;
  summary: string;
  triggerNotes: string[];
  invalidationNotes: string[];
  riskFlags: string[];
  reasoning: unknown;
  createdAt: Date;
  updatedAt: Date;
  signalSnapshot?: {
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
  } | null;
}): TimingAnalysisCardRecord {
  return {
    id: record.id,
    userId: record.userId,
    workflowRunId: record.workflowRunId,
    watchListId: record.watchListId,
    presetId: record.presetId,
    stockCode: record.stockCode,
    stockName: record.stockName,
    sourceType: record.sourceType as TimingSourceType,
    sourceId: record.sourceId,
    signalSnapshotId: record.signalSnapshotId,
    actionBias: record.actionBias as TimingAnalysisCardRecord["actionBias"],
    confidence: record.confidence,
    asOfDate: record.signalSnapshot?.asOfDate.toISOString().slice(0, 10),
    marketState: record.marketState as TimingAnalysisCardRecord["marketState"],
    marketTransition:
      record.marketTransition as TimingAnalysisCardRecord["marketTransition"],
    summary: record.summary,
    triggerNotes: record.triggerNotes,
    invalidationNotes: record.invalidationNotes,
    riskFlags: record.riskFlags as TimingRiskFlag[],
    reasoning: record.reasoning as TimingCardReasoning,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    signalSnapshot: record.signalSnapshot
      ? mapSignalSnapshot(record.signalSnapshot)
      : undefined,
  };
}

export class PrismaTimingAnalysisCardRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createMany(params: {
    items: Array<TimingCardDraft & { signalSnapshotId: string }>;
  }) {
    const records = await this.prisma.$transaction(
      params.items.map((item) =>
        this.prisma.timingAnalysisCard.create({
          data: {
            userId: item.userId,
            workflowRunId: item.workflowRunId,
            watchListId: item.watchListId,
            presetId: item.presetId,
            stockCode: item.stockCode,
            stockName: item.stockName,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            signalSnapshotId: item.signalSnapshotId,
            actionBias: item.actionBias,
            confidence: item.confidence,
            marketState: item.marketState,
            marketTransition: item.marketTransition,
            summary: item.summary,
            triggerNotes: item.triggerNotes,
            invalidationNotes: item.invalidationNotes,
            riskFlags: item.riskFlags,
            reasoning: toJson(item.reasoning),
          },
          include: {
            signalSnapshot: true,
          },
        }),
      ),
    );

    return records.map((record) => mapCard(record));
  }

  async getByIdForUser(userId: string, id: string) {
    const record = await this.prisma.timingAnalysisCard.findFirst({
      where: {
        id,
        userId,
      },
      include: {
        signalSnapshot: true,
      },
    });

    return record ? mapCard(record) : null;
  }

  async listForUser(params: {
    userId: string;
    limit: number;
    stockCode?: string;
    sourceType?: TimingSourceType;
    watchListId?: string;
  }) {
    const records = await this.prisma.timingAnalysisCard.findMany({
      where: {
        userId: params.userId,
        stockCode: params.stockCode,
        sourceType: params.sourceType,
        watchListId: params.watchListId,
      },
      include: {
        signalSnapshot: true,
      },
      take: params.limit,
      orderBy: {
        createdAt: "desc",
      },
    });

    return records.map((record) => mapCard(record));
  }

  async getByIds(ids: string[]) {
    if (!ids.length) {
      return [];
    }

    const records = await this.prisma.timingAnalysisCard.findMany({
      where: {
        id: {
          in: ids,
        },
      },
      include: {
        signalSnapshot: true,
      },
    });

    return records.map((record) => mapCard(record));
  }
}

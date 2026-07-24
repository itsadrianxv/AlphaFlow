import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  type EvidenceCitation,
  sanitizeEvidenceRawValue,
} from "~/server/domain/evidence-context/types";
import type {
  TimingAnalysisCardRecord,
  TimingBar,
  TimingCardDraft,
  TimingCardReasoning,
  TimingRiskFlag,
  TimingSignalSnapshotRecord,
  TimingSourceType,
} from "~/server/domain/timing/types";

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
  barsByTimeframe: unknown;
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
    barsByTimeframe:
      record.barsByTimeframe as TimingSignalSnapshotRecord["barsByTimeframe"],
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
    barsByTimeframe: unknown;
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
    const records = await this.prisma.$transaction(async (tx) =>
      Promise.all(
        params.items.map(async (item) => {
          const context = buildTimingEvidenceContext(item);
          await tx.evidenceContext.create({
            data: context.data,
          });

          return tx.timingAnalysisCard.create({
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
              reasoning: toJson({
                ...item.reasoning,
                evidenceCitations: context.citations,
              }),
            },
            include: {
              signalSnapshot: true,
            },
          });
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

function buildTimingEvidenceContext(
  item: TimingCardDraft & { signalSnapshotId: string },
) {
  const signalContext = item.reasoning.signalContext;
  const indicators = item.reasoning.indicators;
  const contextId = randomUUID();
  const blockId = randomUUID();
  const summaryItemId = randomUUID();
  const indicatorsItemId = randomUUID();
  const citations: EvidenceCitation[] = [
    { evidenceItemId: summaryItemId, relation: "support", label: "技术信号" },
    {
      evidenceItemId: indicatorsItemId,
      relation: "support",
      label: "技术指标",
    },
  ];

  return {
    citations,
    data: {
      id: contextId,
      userId: item.userId,
      workflowRunId: item.workflowRunId,
      schemaVersion: "1.0",
      subjectType: "stock",
      subjectId: item.stockCode,
      subjectLabel: item.stockName,
      phase: "timing",
      metadataJson: toJson({ source: "timing-analysis-card" }),
      blocks: {
        create: [
          {
            id: blockId,
            blockKey: "technical",
            status: "available",
            sourceType: "timing_signal_snapshot",
            sourceId: item.signalSnapshotId,
            sourceName: "择时信号快照",
            observedAt: new Date(item.asOfDate),
            fetchedAt: new Date(),
            warnings: [],
            limitations: [],
            metadataJson: toJson({ timeframe: "DAILY" }),
            items: {
              create: [
                {
                  id: summaryItemId,
                  context: { connect: { id: contextId } },
                  user: { connect: { id: item.userId } },
                  itemKey: "signal_summary",
                  status: "available",
                  extractedFact: signalContext.summary,
                  snippet: signalContext.explanation,
                  valueJson: toJson(signalContext),
                  rawValueJson: toJson(sanitizeEvidenceRawValue(signalContext)),
                  sourceType: "timing_signal_snapshot",
                  sourceId: item.signalSnapshotId,
                  sourceName: "择时信号快照",
                  observedAt: new Date(item.asOfDate),
                  fetchedAt: new Date(),
                  warnings: [],
                  limitations: [],
                  metadataJson: toJson({ derived: true }),
                },
                {
                  id: indicatorsItemId,
                  context: { connect: { id: contextId } },
                  user: { connect: { id: item.userId } },
                  itemKey: "indicators",
                  status: "available",
                  extractedFact: "技术指标快照",
                  valueJson: toJson(indicators),
                  rawValueJson: toJson(sanitizeEvidenceRawValue(indicators)),
                  sourceType: "timing_signal_snapshot",
                  sourceId: item.signalSnapshotId,
                  sourceName: "择时信号快照",
                  observedAt: new Date(item.asOfDate),
                  fetchedAt: new Date(),
                  warnings: [],
                  limitations: [],
                  metadataJson: toJson({ derived: true }),
                },
              ],
            },
          },
        ],
      },
    },
  };
}

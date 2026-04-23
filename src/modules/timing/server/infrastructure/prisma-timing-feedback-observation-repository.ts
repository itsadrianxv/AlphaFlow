import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  TimingFeedbackObservationDraft,
  TimingFeedbackObservationRecord,
  TimingReviewHorizon,
  TimingReviewVerdict,
} from "~/modules/timing/server/domain/types";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function mapRecord(record: {
  id: string;
  userId: string;
  reviewRecordId: string;
  recommendationId: string | null;
  presetId: string | null;
  stockCode: string;
  stockName: string;
  observedAt: Date;
  sourceAsOfDate: Date;
  reviewHorizon: string;
  expectedAction: string;
  signalContext: unknown;
  marketContext: unknown | null;
  positionContext: unknown | null;
  actualReturnPct: number;
  maxFavorableExcursionPct: number;
  maxAdverseExcursionPct: number;
  verdict: string;
  createdAt: Date;
  updatedAt: Date;
}): TimingFeedbackObservationRecord {
  return {
    id: record.id,
    userId: record.userId,
    reviewRecordId: record.reviewRecordId,
    recommendationId: record.recommendationId,
    presetId: record.presetId,
    stockCode: record.stockCode,
    stockName: record.stockName,
    observedAt: record.observedAt,
    sourceAsOfDate: record.sourceAsOfDate.toISOString().slice(0, 10),
    reviewHorizon: record.reviewHorizon as TimingReviewHorizon,
    expectedAction:
      record.expectedAction as TimingFeedbackObservationRecord["expectedAction"],
    signalContext:
      record.signalContext as TimingFeedbackObservationRecord["signalContext"],
    marketContext:
      record.marketContext as TimingFeedbackObservationRecord["marketContext"],
    positionContext:
      record.positionContext as TimingFeedbackObservationRecord["positionContext"],
    actualReturnPct: record.actualReturnPct,
    maxFavorableExcursionPct: record.maxFavorableExcursionPct,
    maxAdverseExcursionPct: record.maxAdverseExcursionPct,
    verdict: record.verdict as TimingReviewVerdict,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class PrismaTimingFeedbackObservationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertMany(params: { items: TimingFeedbackObservationDraft[] }) {
    const records = await this.prisma.$transaction(
      params.items.map((item) =>
        this.prisma.timingFeedbackObservation.upsert({
          where: {
            reviewRecordId: item.reviewRecordId,
          },
          create: {
            userId: item.userId,
            reviewRecordId: item.reviewRecordId,
            recommendationId: item.recommendationId,
            presetId: item.presetId,
            stockCode: item.stockCode,
            stockName: item.stockName,
            observedAt: item.observedAt,
            sourceAsOfDate: toDateOnly(item.sourceAsOfDate),
            reviewHorizon: item.reviewHorizon,
            expectedAction: item.expectedAction,
            signalContext: toJson(item.signalContext),
            marketContext: item.marketContext
              ? toJson(item.marketContext)
              : Prisma.JsonNull,
            positionContext: item.positionContext
              ? toJson(item.positionContext)
              : Prisma.JsonNull,
            actualReturnPct: item.actualReturnPct,
            maxFavorableExcursionPct: item.maxFavorableExcursionPct,
            maxAdverseExcursionPct: item.maxAdverseExcursionPct,
            verdict: item.verdict,
          },
          update: {
            recommendationId: item.recommendationId,
            presetId: item.presetId,
            observedAt: item.observedAt,
            signalContext: toJson(item.signalContext),
            marketContext: item.marketContext
              ? toJson(item.marketContext)
              : Prisma.JsonNull,
            positionContext: item.positionContext
              ? toJson(item.positionContext)
              : Prisma.JsonNull,
            actualReturnPct: item.actualReturnPct,
            maxFavorableExcursionPct: item.maxFavorableExcursionPct,
            maxAdverseExcursionPct: item.maxAdverseExcursionPct,
            verdict: item.verdict,
          },
        }),
      ),
    );

    return records.map((record) => mapRecord(record));
  }

  async listForPreset(params: {
    userId: string;
    presetId?: string | null;
    lookbackDays: number;
  }) {
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - params.lookbackDays);

    const records = await this.prisma.timingFeedbackObservation.findMany({
      where: {
        userId: params.userId,
        presetId: params.presetId ?? null,
        observedAt: {
          gte: startDate,
        },
      },
      orderBy: {
        observedAt: "desc",
      },
    });

    return records.map((record) => mapRecord(record));
  }

  async countAppliedHighlights(params: {
    userId: string;
    presetId?: string | null;
  }) {
    return this.prisma.timingPresetAdjustmentSuggestion.count({
      where: {
        userId: params.userId,
        presetId: params.presetId ?? null,
        status: "APPLIED",
      },
    });
  }
}

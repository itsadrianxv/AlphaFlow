import type { PrismaClient } from "@prisma/client";
import type {
  TimingAction,
  TimingReviewCompletionDraft,
  TimingReviewDraft,
  TimingReviewHorizon,
  TimingReviewRecord,
  TimingReviewVerdict,
} from "~/modules/timing/server/domain/types";

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function mapRecord(record: {
  id: string;
  userId: string;
  analysisCardId: string | null;
  recommendationId: string | null;
  stockCode: string;
  stockName: string;
  sourceAsOfDate: Date;
  reviewHorizon: string;
  scheduledAt: Date;
  completedAt: Date | null;
  expectedAction: string;
  actualReturnPct: number | null;
  maxFavorableExcursionPct: number | null;
  maxAdverseExcursionPct: number | null;
  verdict: string | null;
  reviewSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
}): TimingReviewRecord {
  return {
    id: record.id,
    userId: record.userId,
    analysisCardId: record.analysisCardId,
    recommendationId: record.recommendationId,
    stockCode: record.stockCode,
    stockName: record.stockName,
    sourceAsOfDate: record.sourceAsOfDate.toISOString().slice(0, 10),
    reviewHorizon: record.reviewHorizon as TimingReviewHorizon,
    scheduledAt: record.scheduledAt,
    completedAt: record.completedAt,
    expectedAction: record.expectedAction as TimingAction,
    actualReturnPct: record.actualReturnPct,
    maxFavorableExcursionPct: record.maxFavorableExcursionPct,
    maxAdverseExcursionPct: record.maxAdverseExcursionPct,
    verdict: record.verdict as TimingReviewVerdict | null,
    reviewSummary: record.reviewSummary,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class PrismaTimingReviewRecordRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createMany(params: { items: TimingReviewDraft[] }) {
    const records = await this.prisma.$transaction(
      params.items.map((item) =>
        this.prisma.timingReviewRecord.create({
          data: {
            userId: item.userId,
            analysisCardId: item.analysisCardId,
            recommendationId: item.recommendationId,
            stockCode: item.stockCode,
            stockName: item.stockName,
            sourceAsOfDate: toDateOnly(item.sourceAsOfDate),
            reviewHorizon: item.reviewHorizon,
            scheduledAt: item.scheduledAt,
            expectedAction: item.expectedAction,
          },
        }),
      ),
    );

    return records.map((record) => mapRecord(record));
  }

  async completeMany(params: { items: TimingReviewCompletionDraft[] }) {
    const records = await this.prisma.$transaction(
      params.items.map((item) =>
        this.prisma.timingReviewRecord.update({
          where: { id: item.id },
          data: {
            actualReturnPct: item.actualReturnPct,
            maxFavorableExcursionPct: item.maxFavorableExcursionPct,
            maxAdverseExcursionPct: item.maxAdverseExcursionPct,
            verdict: item.verdict,
            reviewSummary: item.reviewSummary,
            completedAt: item.completedAt ?? new Date(),
          },
        }),
      ),
    );

    return records.map((record) => mapRecord(record));
  }

  async listForUser(params: {
    userId: string;
    limit: number;
    stockCode?: string;
    completedOnly?: boolean;
  }) {
    const records = await this.prisma.timingReviewRecord.findMany({
      where: {
        userId: params.userId,
        stockCode: params.stockCode,
        completedAt: params.completedOnly ? { not: null } : undefined,
      },
      take: params.limit,
      orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }],
    });

    return records.map((record) => mapRecord(record));
  }

  async listDuePending(params: {
    userId?: string;
    targetDate: Date;
    limit: number;
  }) {
    const records = await this.prisma.timingReviewRecord.findMany({
      where: {
        userId: params.userId,
        completedAt: null,
        scheduledAt: {
          lte: params.targetDate,
        },
      },
      take: params.limit,
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "asc" }],
    });

    return records.map((record) => mapRecord(record));
  }
}

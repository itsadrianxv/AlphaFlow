import type { PrismaClient } from "@prisma/client";

import type { TimingExecutionRecordDecision } from "~/server/domain/timing/types";

export class PrismaTimingExecutionRecordRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(params: {
    userId: string;
    presetRevisionId: string;
    analysisCardId?: string;
    recommendationId?: string;
    decision: TimingExecutionRecordDecision;
    executedAt?: Date;
    price?: number;
    quantity?: number;
    fees?: number;
    notes?: string;
  }) {
    return this.prisma.timingExecutionRecord.create({ data: params });
  }

  async listForRevision(userId: string, presetRevisionId: string) {
    return this.prisma.timingExecutionRecord.findMany({
      where: { userId, presetRevisionId },
      orderBy: { createdAt: "desc" },
    });
  }
}

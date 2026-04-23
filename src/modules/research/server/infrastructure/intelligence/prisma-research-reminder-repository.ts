import type { Prisma, PrismaClient } from "@prisma/client";
import { ResearchReminder } from "~/modules/research/server/domain/intelligence/entities/research-reminder";
import type { IReminderRepository } from "~/modules/research/server/domain/intelligence/repositories/reminder-repository";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

export class PrismaResearchReminderRepository implements IReminderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(reminder: ResearchReminder): Promise<void> {
    if (
      reminder.targetType !== "TIMING_REVIEW" ||
      !reminder.timingReviewRecordId
    ) {
      throw new Error(
        "PrismaResearchReminderRepository only supports TIMING_REVIEW reminders.",
      );
    }

    await this.prisma.researchReminder.upsert({
      where: { id: reminder.id },
      create: {
        id: reminder.id,
        userId: reminder.userId,
        timingReviewRecordId: reminder.timingReviewRecordId,
        stockCode: reminder.stockCode,
        reminderType: reminder.reminderType,
        targetType: "TIMING_REVIEW",
        scheduledAt: reminder.scheduledAt,
        status: reminder.status,
        payload: toJson(reminder.payload),
        triggeredAt: reminder.triggeredAt,
        createdAt: reminder.createdAt,
        updatedAt: reminder.updatedAt,
      },
      update: {
        timingReviewRecordId: reminder.timingReviewRecordId,
        scheduledAt: reminder.scheduledAt,
        status: reminder.status,
        targetType: "TIMING_REVIEW",
        payload: toJson(reminder.payload),
        triggeredAt: reminder.triggeredAt,
        updatedAt: reminder.updatedAt,
      },
    });
  }

  async findById(id: string): Promise<ResearchReminder | null> {
    const record = await this.prisma.researchReminder.findUnique({
      where: { id },
    });

    return record ? this.toDomain(record) : null;
  }

  async findByInsightId(insightId: string): Promise<ResearchReminder[]> {
    return this.findByScreeningInsightId(insightId);
  }

  async findByScreeningInsightId(
    _insightId: string,
  ): Promise<ResearchReminder[]> {
    return [];
  }

  async findByTimingReviewRecordId(
    reviewRecordId: string,
  ): Promise<ResearchReminder[]> {
    const records = await this.prisma.researchReminder.findMany({
      where: { timingReviewRecordId: reviewRecordId },
      orderBy: { scheduledAt: "asc" },
    });

    return records.map((record) => this.toDomain(record));
  }

  async findPendingByUserId(
    userId: string,
    limit = 20,
    offset = 0,
  ): Promise<ResearchReminder[]> {
    const records = await this.prisma.researchReminder.findMany({
      where: {
        userId,
        status: "PENDING",
      },
      orderBy: { scheduledAt: "asc" },
      take: limit,
      skip: offset,
    });

    return records.map((record) => this.toDomain(record));
  }

  private toDomain(record: {
    id: string;
    userId: string;
    timingReviewRecordId: string | null;
    stockCode: string;
    reminderType: string;
    targetType: string;
    scheduledAt: Date;
    status: string;
    payload: unknown;
    triggeredAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): ResearchReminder {
    return ResearchReminder.create({
      id: record.id,
      userId: record.userId,
      timingReviewRecordId: record.timingReviewRecordId ?? undefined,
      stockCode: record.stockCode,
      reminderType: record.reminderType as ResearchReminder["reminderType"],
      targetType: record.targetType as ResearchReminder["targetType"],
      scheduledAt: record.scheduledAt,
      status: record.status as ResearchReminder["status"],
      payload: record.payload as Record<string, unknown>,
      triggeredAt: record.triggeredAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    });
  }
}

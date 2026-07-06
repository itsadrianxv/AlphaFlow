import type { ScreeningInsight } from "~/server/domain/intelligence/aggregates/screening-insight";
import { ResearchReminder } from "~/server/domain/intelligence/entities/research-reminder";
import type { IReminderRepository } from "~/server/domain/intelligence/repositories/reminder-repository";
import type { TimingReviewRecord } from "~/server/domain/timing/types";

export type ReminderSchedulingServiceDependencies = {
  reminderRepository: IReminderRepository;
};

export class ReminderSchedulingService {
  private readonly reminderRepository: IReminderRepository;

  constructor(dependencies: ReminderSchedulingServiceDependencies) {
    this.reminderRepository = dependencies.reminderRepository;
  }

  async scheduleReviewReminder(
    insight: ScreeningInsight,
  ): Promise<ResearchReminder> {
    const existingReminders =
      await this.reminderRepository.findByScreeningInsightId(insight.id);
    const targetTime = insight.reviewPlan.nextReviewAt.getTime();

    for (const reminder of existingReminders) {
      if (reminder.reminderType !== "REVIEW") {
        continue;
      }

      if (reminder.scheduledAt.getTime() === targetTime) {
        if (reminder.status === "CANCELLED") {
          const restored = ResearchReminder.create({
            id: reminder.id,
            userId: reminder.userId,
            screeningInsightId: reminder.screeningInsightId ?? undefined,
            stockCode: reminder.stockCode,
            reminderType: reminder.reminderType,
            targetType: reminder.targetType,
            scheduledAt: reminder.scheduledAt,
            status: "PENDING",
            payload: reminder.payload,
            triggeredAt: null,
            createdAt: reminder.createdAt,
            updatedAt: new Date(),
          });
          await this.reminderRepository.save(restored);
          return restored;
        }

        return reminder;
      }

      if (reminder.status === "PENDING") {
        reminder.cancel();
        await this.reminderRepository.save(reminder);
      }
    }

    const reminder = ResearchReminder.create({
      userId: insight.userId,
      screeningInsightId: insight.id,
      stockCode: insight.stockCode,
      reminderType: "REVIEW",
      targetType: "SCREENING_INSIGHT",
      scheduledAt: insight.reviewPlan.nextReviewAt,
      payload: {
        summary: insight.summary,
        reviewReason: insight.reviewPlan.reviewReason,
        suggestedChecks: [...insight.reviewPlan.suggestedChecks],
        urgency: insight.reviewPlan.urgency,
      },
    });

    await this.reminderRepository.save(reminder);
    return reminder;
  }

  async scheduleTimingReviewReminder(
    reviewRecord: TimingReviewRecord,
  ): Promise<ResearchReminder> {
    const existingReminders =
      await this.reminderRepository.findByTimingReviewRecordId(reviewRecord.id);
    const targetTime = reviewRecord.scheduledAt.getTime();

    for (const reminder of existingReminders) {
      if (reminder.reminderType !== "REVIEW") {
        continue;
      }

      if (reminder.scheduledAt.getTime() === targetTime) {
        if (reminder.status === "CANCELLED") {
          const restored = ResearchReminder.create({
            id: reminder.id,
            userId: reminder.userId,
            timingReviewRecordId: reminder.timingReviewRecordId ?? undefined,
            stockCode: reminder.stockCode,
            reminderType: reminder.reminderType,
            targetType: reminder.targetType,
            scheduledAt: reminder.scheduledAt,
            status: "PENDING",
            payload: reminder.payload,
            triggeredAt: null,
            createdAt: reminder.createdAt,
            updatedAt: new Date(),
          });
          await this.reminderRepository.save(restored);
          return restored;
        }

        return reminder;
      }

      if (reminder.status === "PENDING") {
        reminder.cancel();
        await this.reminderRepository.save(reminder);
      }
    }

    const reminder = ResearchReminder.create({
      userId: reviewRecord.userId,
      timingReviewRecordId: reviewRecord.id,
      stockCode: reviewRecord.stockCode,
      reminderType: "REVIEW",
      targetType: "TIMING_REVIEW",
      scheduledAt: reviewRecord.scheduledAt,
      payload: {
        stockName: reviewRecord.stockName,
        reviewHorizon: reviewRecord.reviewHorizon,
        expectedAction: reviewRecord.expectedAction,
        sourceAsOfDate: reviewRecord.sourceAsOfDate,
      },
    });

    await this.reminderRepository.save(reminder);
    return reminder;
  }
}

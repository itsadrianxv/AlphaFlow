import type { ReminderSchedulingService } from "~/server/application/intelligence/reminder-scheduling-service";
import { resolveTimingPresetConfig } from "~/server/domain/timing/preset";
import type {
  TimingAnalysisCardRecord,
  TimingPresetConfig,
  TimingRecommendationRecord,
  TimingReviewDraft,
  TimingReviewHorizon,
} from "~/server/domain/timing/types";
import type { PrismaTimingReviewRecordRepository } from "~/server/infrastructure/timing/prisma-timing-review-record-repository";

const HORIZON_TO_CALENDAR_DAYS: Record<TimingReviewHorizon, number> = {
  T5: 7,
  T10: 14,
  T20: 28,
};

function scheduleAtFromSourceDate(
  sourceAsOfDate: string,
  horizon: TimingReviewHorizon,
) {
  const base = new Date(`${sourceAsOfDate}T00:00:00.000Z`);
  const result = new Date(base);
  result.setUTCDate(result.getUTCDate() + HORIZON_TO_CALENDAR_DAYS[horizon]);
  return result;
}

export type TimingReviewSchedulingServiceDependencies = {
  reviewRecordRepository: PrismaTimingReviewRecordRepository;
  reminderSchedulingService: ReminderSchedulingService;
};

export class TimingReviewSchedulingService {
  private readonly reviewRecordRepository: PrismaTimingReviewRecordRepository;

  private readonly reminderSchedulingService: ReminderSchedulingService;

  constructor(dependencies: TimingReviewSchedulingServiceDependencies) {
    this.reviewRecordRepository = dependencies.reviewRecordRepository;
    this.reminderSchedulingService = dependencies.reminderSchedulingService;
  }

  async scheduleForCards(params: {
    cards: TimingAnalysisCardRecord[];
    presetConfig?: TimingPresetConfig;
  }) {
    const horizons =
      resolveTimingPresetConfig(params.presetConfig).reviewSchedule?.horizons ??
      [];

    const drafts: TimingReviewDraft[] = [];
    for (const card of params.cards) {
      const sourceAsOfDate = card.signalSnapshot?.asOfDate;

      if (!sourceAsOfDate) {
        continue;
      }

      for (const horizon of horizons) {
        drafts.push({
          userId: card.userId,
          analysisCardId: card.id,
          stockCode: card.stockCode,
          stockName: card.stockName,
          sourceAsOfDate,
          reviewHorizon: horizon,
          scheduledAt: scheduleAtFromSourceDate(sourceAsOfDate, horizon),
          expectedAction: card.actionBias,
        });
      }
    }

    const records = drafts.length
      ? await this.reviewRecordRepository.createMany({ items: drafts })
      : [];

    const reminders = [];
    for (const record of records) {
      reminders.push(
        await this.reminderSchedulingService.scheduleTimingReviewReminder(
          record,
        ),
      );
    }

    return {
      records,
      reminderIds: reminders.map((item) => item.id),
    };
  }

  async scheduleForRecommendations(params: {
    recommendations: TimingRecommendationRecord[];
    sourceAsOfDateByStockCode: Map<string, string>;
    presetConfig?: TimingPresetConfig;
  }) {
    const horizons =
      resolveTimingPresetConfig(params.presetConfig).reviewSchedule?.horizons ??
      [];

    const drafts: TimingReviewDraft[] = [];
    for (const recommendation of params.recommendations) {
      const sourceAsOfDate = params.sourceAsOfDateByStockCode.get(
        recommendation.stockCode,
      );

      if (!sourceAsOfDate) {
        continue;
      }

      for (const horizon of horizons) {
        drafts.push({
          userId: recommendation.userId,
          recommendationId: recommendation.id,
          stockCode: recommendation.stockCode,
          stockName: recommendation.stockName,
          sourceAsOfDate,
          reviewHorizon: horizon,
          scheduledAt: scheduleAtFromSourceDate(sourceAsOfDate, horizon),
          expectedAction: recommendation.action,
        });
      }
    }

    const records = drafts.length
      ? await this.reviewRecordRepository.createMany({ items: drafts })
      : [];

    const reminders = [];
    for (const record of records) {
      reminders.push(
        await this.reminderSchedulingService.scheduleTimingReviewReminder(
          record,
        ),
      );
    }

    return {
      records,
      reminderIds: reminders.map((item) => item.id),
    };
  }
}

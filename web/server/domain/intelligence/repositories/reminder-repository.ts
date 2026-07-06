import type { ResearchReminder } from "~/server/domain/intelligence/entities/research-reminder";

export interface IReminderRepository {
  save(reminder: ResearchReminder): Promise<void>;
  findById(id: string): Promise<ResearchReminder | null>;
  findByInsightId(insightId: string): Promise<ResearchReminder[]>;
  findByScreeningInsightId(insightId: string): Promise<ResearchReminder[]>;
  findByTimingReviewRecordId(
    reviewRecordId: string,
  ): Promise<ResearchReminder[]>;
  findPendingByUserId(
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<ResearchReminder[]>;
}

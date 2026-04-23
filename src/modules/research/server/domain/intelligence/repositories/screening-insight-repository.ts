import type { ScreeningInsight } from "~/modules/research/server/domain/intelligence/aggregates/screening-insight";
import type { ScreeningInsightVersion } from "~/modules/research/server/domain/intelligence/entities/screening-insight-version";

export interface IScreeningInsightRepository {
  save(insight: ScreeningInsight): Promise<ScreeningInsight>;
  findById(id: string): Promise<ScreeningInsight | null>;
  findByUserId(
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<ScreeningInsight[]>;
  findByScreeningSessionId(
    screeningSessionId: string,
  ): Promise<ScreeningInsight[]>;
  findBySessionAndStockCode(
    screeningSessionId: string,
    stockCode: string,
  ): Promise<ScreeningInsight | null>;
  findVersions(insightId: string): Promise<ScreeningInsightVersion[]>;
}

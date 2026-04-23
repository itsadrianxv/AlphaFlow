import type { ConfidenceAnalysisService } from "~/modules/research/server/application/intelligence/confidence-analysis-service";
import {
  buildInsightEvidenceRefs,
  mapScreeningStockToFactsBundle,
} from "~/modules/research/server/application/intelligence/insight-pipeline-support";
import type { InsightSynthesisService } from "~/modules/research/server/application/intelligence/insight-synthesis-service";
import type { ReminderSchedulingService } from "~/modules/research/server/application/intelligence/reminder-scheduling-service";
import { ScreeningInsight } from "~/modules/research/server/domain/intelligence/aggregates/screening-insight";
import type { IScreeningInsightRepository } from "~/modules/research/server/domain/intelligence/repositories/screening-insight-repository";
import type { CompanyEvidence } from "~/modules/research/server/domain/intelligence/types";
import type { ScreeningSession } from "~/modules/screening/server/domain/aggregates/screening-session";

export interface InsightDataClient {
  getEvidence(stockCode: string, concept?: string): Promise<CompanyEvidence>;
}

export type InsightArchiveServiceDependencies = {
  insightRepository: IScreeningInsightRepository;
  dataClient: InsightDataClient;
  synthesisService: InsightSynthesisService;
  confidenceAnalysisService: ConfidenceAnalysisService;
  reminderSchedulingService: ReminderSchedulingService;
  maxInsightsPerSession?: number;
};

export class InsightArchiveService {
  private readonly insightRepository: IScreeningInsightRepository;
  private readonly dataClient: InsightDataClient;
  private readonly synthesisService: InsightSynthesisService;
  private readonly confidenceAnalysisService: ConfidenceAnalysisService;
  private readonly reminderSchedulingService: ReminderSchedulingService;
  private readonly maxInsightsPerSession: number;

  constructor(dependencies: InsightArchiveServiceDependencies) {
    this.insightRepository = dependencies.insightRepository;
    this.dataClient = dependencies.dataClient;
    this.synthesisService = dependencies.synthesisService;
    this.confidenceAnalysisService = dependencies.confidenceAnalysisService;
    this.reminderSchedulingService = dependencies.reminderSchedulingService;
    this.maxInsightsPerSession = dependencies.maxInsightsPerSession ?? 10;
  }

  async archiveSessionInsights(
    session: ScreeningSession,
  ): Promise<ScreeningInsight[]> {
    if (session.topStocks.length === 0) {
      return [];
    }

    const savedInsights: ScreeningInsight[] = [];

    for (const stock of session.topStocks.slice(
      0,
      this.maxInsightsPerSession,
    )) {
      const evidence = await this.safeGetEvidence(stock.stockCode.value);
      const factsBundle = mapScreeningStockToFactsBundle(
        session,
        stock,
        evidence,
      );
      const evidenceRefs = buildInsightEvidenceRefs(session, stock, evidence);
      const draft = await this.synthesisService.synthesize({
        factsBundle,
        evidenceRefs,
      });
      const confidenceAnalysis =
        await this.confidenceAnalysisService.analyzeScreeningInsight({
          stockCode: stock.stockCode.value,
          stockName: stock.stockName,
          thesis: draft.thesis,
          risks: draft.risks,
          catalysts: draft.catalysts,
          evidenceRefs,
        });
      const existing = await this.insightRepository.findBySessionAndStockCode(
        session.id,
        stock.stockCode.value,
      );

      const insight = ScreeningInsight.create({
        id: existing?.id,
        userId: session.userId,
        screeningSessionId: session.id,
        watchListId: existing?.watchListId,
        stockCode: stock.stockCode.value,
        stockName: stock.stockName,
        score: stock.score,
        thesis: draft.thesis,
        risks: draft.risks,
        catalysts: draft.catalysts,
        reviewPlan: draft.reviewPlan,
        evidenceRefs: draft.evidenceRefs,
        qualityFlags: draft.qualityFlags,
        confidenceAnalysis,
        status: draft.status,
        version: existing?.version ?? 1,
        latestVersionId: existing?.latestVersionId,
        createdAt: existing?.createdAt,
      });

      const saved = await this.insightRepository.save(insight);
      await this.reminderSchedulingService.scheduleReviewReminder(saved);
      savedInsights.push(saved);
    }

    return savedInsights;
  }

  private async safeGetEvidence(
    stockCode: string,
  ): Promise<CompanyEvidence | null> {
    try {
      return await this.dataClient.getEvidence(stockCode);
    } catch {
      return null;
    }
  }
}

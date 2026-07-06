export type ThemeNewsItem = {
  id: string;
  title: string;
  summary: string;
  source: string;
  publishedAt: string;
  sentiment: "positive" | "neutral" | "negative";
  relevanceScore: number;
  relatedStocks: string[];
};

export type CompanyEvidence = {
  stockCode: string;
  companyName: string;
  concept: string;
  evidenceSummary: string;
  catalysts: string[];
  risks: string[];
  credibilityScore: number;
  updatedAt: string;
};

export type CompanyEvidenceBatchRequest = {
  stockCodes: string[];
  concept: string;
};

export type CompanyResearchPackReferenceItem = {
  id: string;
  title: string;
  sourceName: string;
  snippet: string;
  extractedFact: string;
  url?: string;
  publishedAt?: string;
  credibilityScore?: number;
  sourceType: string;
};

export type CompanyResearchPack = {
  stockCode: string;
  companyName: string;
  concept: string;
  financialHighlights: string[];
  referenceItems: CompanyResearchPackReferenceItem[];
  summaryNotes: string[];
};

export type InsightConfidence = "high" | "medium" | "low";

export type RiskSeverity = "high" | "medium" | "low";

export type CatalystWindowType =
  | "event"
  | "earnings"
  | "policy"
  | "product"
  | "order";

export type ReviewUrgency = "high" | "medium" | "low";

export type InsightQualityFlag =
  | "INSUFFICIENT_EVIDENCE"
  | "MISSING_RISK_DISCLOSURE"
  | "STALE_EVIDENCE"
  | "LOW_CONCEPT_CONFIDENCE"
  | "MISSING_KEY_FIELDS"
  | "LOW_CONFIDENCE";

export type ScreeningInsightStatus = "ACTIVE" | "NEEDS_REVIEW" | "ARCHIVED";

export type ResearchReminderType = "REVIEW";

export type ResearchReminderTargetType = "SCREENING_INSIGHT" | "TIMING_REVIEW";

export type ResearchReminderStatus = "PENDING" | "TRIGGERED" | "CANCELLED";

export type InsightConceptMatch = {
  concept: string;
  confidence: InsightConfidence;
  rationale: string;
};

export type InsightEvidenceFact = {
  title: string;
  sourceName: string;
  url?: string;
  snippet: string;
  extractedFact: string;
  publishedAt?: string;
  credibilityScore?: number;
};

export type ScreeningFactsBundle = {
  stock: {
    stockCode: string;
    stockName: string;
  };
  screening: {
    screeningSessionId: string;
    strategyId: string | null;
    strategyName: string;
    executedAt: string;
    score: number;
    scorePercent: number;
    matchedConditions: Array<{
      field: string;
      operator: string;
      value: Record<string, unknown>;
    }>;
    scoreBreakdown: Record<string, number>;
    scoreContributions: Record<string, number>;
    indicatorValues: Record<string, unknown>;
    scoreExplanations: string[];
  };
  marketSignals: {
    totalScanned: number;
    matchedCount: number;
    executionTimeMs: number;
    evidenceCredibilityScore?: number;
  };
  conceptMatches: InsightConceptMatch[];
  news: ThemeNewsItem[];
  companyEvidence: InsightEvidenceFact[];
  asOf: string;
};

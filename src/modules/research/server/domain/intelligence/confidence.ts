export type ConfidenceAnalysisStatus = "COMPLETE" | "PARTIAL" | "UNAVAILABLE";

export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";

export type ConfidenceClaimLabel =
  | "supported"
  | "insufficient"
  | "contradicted"
  | "abstain";

export type ConfidenceTriplet = [string, string, string];

export type ConfidenceClaimAnalysis = {
  claimId: string;
  claimText: string;
  triplet?: ConfidenceTriplet;
  attributedSentenceIds: string[];
  matchedReferenceIds: string[];
  label: ConfidenceClaimLabel;
  explanation: string;
};

export type ConfidenceAnalysis = {
  status: ConfidenceAnalysisStatus;
  finalScore: number | null;
  level: ConfidenceLevel;
  claimCount: number;
  supportedCount: number;
  insufficientCount: number;
  contradictedCount: number;
  abstainCount: number;
  supportRate: number;
  insufficientRate: number;
  contradictionRate: number;
  abstainRate: number;
  evidenceCoverageScore: number;
  freshnessScore: number;
  sourceDiversityScore: number;
  notes: string[];
  claims: ConfidenceClaimAnalysis[];
};

export type ConfidenceReferenceItem = {
  id: string;
  title: string;
  sourceName: string;
  excerpt: string;
  url?: string;
  publishedAt?: string;
  sourceType?: string;
  credibilityScore?: number;
};

export type ConfidenceCheckModule =
  | "screening_insight"
  | "company_research"
  | "quick_research";

export type ConfidenceCheckRequest = {
  module: ConfidenceCheckModule;
  question?: string;
  responseText: string;
  referenceItems: ConfidenceReferenceItem[];
};

export type ConfidenceSummary = {
  confidenceScore: number | null;
  confidenceLevel: ConfidenceLevel;
  confidenceStatus: ConfidenceAnalysisStatus;
  supportedClaimCount: number;
  insufficientClaimCount: number;
  contradictedClaimCount: number;
};

export function createUnavailableConfidenceAnalysis(
  notes: string[] = ["Confidence analysis unavailable."],
): ConfidenceAnalysis {
  return {
    status: "UNAVAILABLE",
    finalScore: null,
    level: "unknown",
    claimCount: 0,
    supportedCount: 0,
    insufficientCount: 0,
    contradictedCount: 0,
    abstainCount: 0,
    supportRate: 0,
    insufficientRate: 0,
    contradictionRate: 0,
    abstainRate: 0,
    evidenceCoverageScore: 0,
    freshnessScore: 0,
    sourceDiversityScore: 0,
    notes,
    claims: [],
  };
}

export function summarizeConfidenceAnalysis(
  analysis?: ConfidenceAnalysis | null,
): ConfidenceSummary {
  if (!analysis) {
    return {
      confidenceScore: null,
      confidenceLevel: "unknown",
      confidenceStatus: "UNAVAILABLE",
      supportedClaimCount: 0,
      insufficientClaimCount: 0,
      contradictedClaimCount: 0,
    };
  }

  return {
    confidenceScore: analysis.finalScore,
    confidenceLevel: analysis.level,
    confidenceStatus: analysis.status,
    supportedClaimCount: analysis.supportedCount,
    insufficientClaimCount: analysis.insufficientCount,
    contradictedClaimCount: analysis.contradictedCount,
  };
}

export function normalizeExternalCredibilityScore(
  score?: number | null,
): number | undefined {
  if (typeof score !== "number" || Number.isNaN(score)) {
    return undefined;
  }

  if (score <= 1) {
    return Math.max(0, Math.min(1, score));
  }

  return Math.max(0, Math.min(1, score / 100));
}

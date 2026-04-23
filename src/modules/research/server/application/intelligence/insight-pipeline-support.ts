import { normalizeExternalCredibilityScore } from "~/modules/research/server/domain/intelligence/confidence";
import { EvidenceReference } from "~/modules/research/server/domain/intelligence/entities/evidence-reference";
import type {
  CompanyEvidence,
  ScreeningFactsBundle,
} from "~/modules/research/server/domain/intelligence/types";
import type { ScreeningSession } from "~/modules/screening/server/domain/aggregates/screening-session";
import type { ScoredStock } from "~/modules/screening/server/domain/value-objects/scored-stock";

function mapConfidence(score?: number) {
  const normalized = normalizeExternalCredibilityScore(score) ?? 0;

  if (normalized >= 0.75) {
    return "high" as const;
  }

  if (normalized >= 0.45) {
    return "medium" as const;
  }

  return "low" as const;
}

export function mapScreeningStockToFactsBundle(
  session: ScreeningSession,
  stock: ScoredStock,
  evidence: CompanyEvidence | null,
): ScreeningFactsBundle {
  const stockData = stock.toDict();
  const scoreBreakdown = stockData.scoreBreakdown as Record<string, number>;
  const scoreContributions = stockData.scoreContributions as Record<
    string,
    number
  >;
  const indicatorValues = stockData.indicatorValues as Record<string, unknown>;
  const matchedConditions = stockData.matchedConditions as Array<{
    field: string;
    operator: string;
    value: Record<string, unknown>;
  }>;
  const scoreExplanations = stockData.scoreExplanations as string[];
  const normalizedEvidenceScore = normalizeExternalCredibilityScore(
    evidence?.credibilityScore,
  );

  return {
    stock: {
      stockCode: stock.stockCode.value,
      stockName: stock.stockName,
    },
    screening: {
      screeningSessionId: session.id,
      strategyId: session.strategyId,
      strategyName: session.strategyName,
      executedAt: session.executedAt.toISOString(),
      score: stock.score,
      scorePercent: stock.score * 100,
      matchedConditions,
      scoreBreakdown,
      scoreContributions,
      indicatorValues,
      scoreExplanations,
    },
    marketSignals: {
      totalScanned: session.totalScanned,
      matchedCount: session.countMatched(),
      executionTimeMs: session.executionTime,
      evidenceCredibilityScore: normalizedEvidenceScore,
    },
    conceptMatches: evidence?.concept
      ? [
          {
            concept: evidence.concept,
            confidence: mapConfidence(evidence.credibilityScore),
            rationale: evidence.evidenceSummary,
          },
        ]
      : [],
    news: [],
    companyEvidence: evidence
      ? [
          {
            title: `${evidence.companyName} evidence summary`,
            sourceName: "python-intelligence-service",
            snippet: evidence.evidenceSummary,
            extractedFact: evidence.evidenceSummary,
            publishedAt: evidence.updatedAt,
            credibilityScore: normalizedEvidenceScore,
          },
        ]
      : [],
    asOf: new Date().toISOString(),
  };
}

export function buildInsightEvidenceRefs(
  session: ScreeningSession,
  stock: ScoredStock,
  evidence: CompanyEvidence | null,
) {
  const refs = [
    EvidenceReference.create({
      title: `${stock.stockName} screening snapshot`,
      sourceName: "screening-session",
      snippet:
        stock.scoreExplanations[0] ??
        `${stock.stockName} ranked near the top in ${session.strategyName}.`,
      extractedFact: [
        `Score ${Math.round(stock.score * 100)}`,
        `${stock.matchedConditions.length} matched conditions`,
      ].join("; "),
      publishedAt:
        session.completedAt?.toISOString() ?? session.executedAt.toISOString(),
      credibilityScore: stock.score,
    }),
  ];

  if (evidence) {
    refs.push(
      EvidenceReference.create({
        title: `${evidence.companyName} external evidence`,
        sourceName: "python-intelligence-service",
        snippet: evidence.evidenceSummary,
        extractedFact: evidence.evidenceSummary,
        publishedAt: evidence.updatedAt,
        credibilityScore: normalizeExternalCredibilityScore(
          evidence.credibilityScore,
        ),
      }),
    );
  }

  return refs;
}

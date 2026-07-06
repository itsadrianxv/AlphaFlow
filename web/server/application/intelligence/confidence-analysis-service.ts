import {
  type ConfidenceAnalysis,
  type ConfidenceCheckRequest,
  type ConfidenceReferenceItem,
  createUnavailableConfidenceAnalysis,
  normalizeExternalCredibilityScore,
} from "~/server/domain/intelligence/confidence";
import type { EvidenceReference } from "~/server/domain/intelligence/entities/evidence-reference";
import type {
  CompanyEvidence,
  ThemeNewsItem,
} from "~/server/domain/intelligence/types";
import type { Catalyst } from "~/server/domain/intelligence/value-objects/catalyst";
import type { InvestmentThesis } from "~/server/domain/intelligence/value-objects/investment-thesis";
import type { RiskPoint } from "~/server/domain/intelligence/value-objects/risk-point";
import type {
  CompanyEvidenceNote,
  CompanyQuestionFinding,
  CompanyResearchBrief,
  CompanyResearchReferenceItem,
  CompanyResearchVerdict,
  QuickResearchCandidate,
  QuickResearchCredibility,
} from "~/server/domain/workflow/types";
import type { PythonConfidenceAnalysisClient } from "~/server/infrastructure/intelligence/python-confidence-analysis-client";

export type ConfidenceAnalysisServiceDependencies = {
  client: PythonConfidenceAnalysisClient;
};

function sanitizeLines(items: Array<string | undefined | null>) {
  return items
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item));
}

function dedupeReferences(items: ConfidenceReferenceItem[]) {
  const references = new Map<string, ConfidenceReferenceItem>();

  for (const item of items) {
    if (!item.excerpt.trim()) {
      continue;
    }

    if (!references.has(item.id)) {
      references.set(item.id, item);
    }
  }

  return [...references.values()];
}

function buildEvidenceReferenceItem(
  item: EvidenceReference,
): ConfidenceReferenceItem {
  return {
    id: item.id,
    title: item.title,
    sourceName: item.sourceName,
    excerpt: sanitizeLines([item.extractedFact, item.snippet]).join("\n"),
    url: item.url,
    publishedAt: item.publishedAt,
    sourceType: item.sourceName,
    credibilityScore: item.credibilityScore,
  };
}

function buildCompanyEvidenceNoteReference(
  item: CompanyEvidenceNote,
  index: number,
): ConfidenceReferenceItem {
  return {
    id: item.referenceId || `${index}:${item.url ?? item.title}`,
    title: item.title,
    sourceName: item.sourceName,
    excerpt: sanitizeLines([
      item.extractedFact,
      item.snippet,
      item.relevance,
    ]).join("\n"),
    url: item.url,
    sourceType: item.sourceType,
  };
}

function buildCompanyResearchReference(
  item: CompanyResearchReferenceItem,
): ConfidenceReferenceItem {
  return {
    id: item.id,
    title: item.title,
    sourceName: item.sourceName,
    excerpt: sanitizeLines([item.extractedFact, item.snippet]).join("\n"),
    url: item.url,
    publishedAt: item.publishedAt,
    sourceType: item.sourceType,
    credibilityScore: item.credibilityScore,
  };
}

function buildThemeNewsReference(item: ThemeNewsItem): ConfidenceReferenceItem {
  return {
    id: item.id,
    title: item.title,
    sourceName: item.source,
    excerpt: sanitizeLines([item.title, item.summary]).join("\n"),
    publishedAt: item.publishedAt,
    sourceType: "news",
  };
}

function buildCompanyEvidenceReference(
  item: CompanyEvidence,
): ConfidenceReferenceItem {
  return {
    id: `${item.stockCode}:${item.updatedAt}`,
    title: `${item.companyName} evidence summary`,
    sourceName: "python-intelligence-service",
    excerpt: sanitizeLines([
      item.evidenceSummary,
      item.catalysts.join("; "),
      item.risks.join("; "),
    ]).join("\n"),
    publishedAt: item.updatedAt,
    sourceType: "aggregated_evidence",
    credibilityScore: normalizeExternalCredibilityScore(item.credibilityScore),
  };
}

function buildScreeningInsightText(params: {
  thesis: InvestmentThesis;
  risks: RiskPoint[];
  catalysts: Catalyst[];
}) {
  return sanitizeLines([
    `Summary: ${params.thesis.summary}`,
    `Why now: ${params.thesis.whyNow}`,
    params.thesis.drivers.length > 0
      ? `Drivers: ${params.thesis.drivers.join("; ")}`
      : undefined,
    ...params.risks.map((item) => `Risk: ${item.description}`),
    ...params.catalysts.map((item) => `Catalyst: ${item.description}`),
  ]).join("\n");
}

function buildCompanyResearchText(params: {
  findings: CompanyQuestionFinding[];
  verdict: CompanyResearchVerdict;
}) {
  return sanitizeLines([
    ...params.findings.map(
      (item) => `Finding: ${item.question}\nAnswer: ${item.answer}`,
    ),
    `Verdict summary: ${params.verdict.summary}`,
    ...params.verdict.bullPoints.map((item) => `Bull point: ${item}`),
    ...params.verdict.bearPoints.map((item) => `Bear point: ${item}`),
  ]).join("\n");
}

function buildQuickResearchCandidateText(params: {
  candidate: QuickResearchCandidate;
  credibility: QuickResearchCredibility;
}) {
  return sanitizeLines([
    `Candidate: ${params.candidate.stockName} (${params.candidate.stockCode})`,
    `Reason: ${params.candidate.reason}`,
    ...params.credibility.highlights.map((item) => `Highlight: ${item}`),
    ...params.credibility.risks.map((item) => `Risk: ${item}`),
  ]).join("\n");
}

function buildQuickResearchOverallText(params: {
  overview: string;
  heatConclusion: string;
  candidates: QuickResearchCandidate[];
  credibility: QuickResearchCredibility[];
  competitionSummary: string;
}) {
  const credibilityByCode = new Map(
    params.credibility.map((item) => [item.stockCode, item]),
  );

  return sanitizeLines([
    `Overview: ${params.overview}`,
    `Heat conclusion: ${params.heatConclusion}`,
    ...params.candidates.map((item) => {
      const credibility = credibilityByCode.get(item.stockCode);
      return sanitizeLines([
        `Candidate ${item.stockName} (${item.stockCode})`,
        `Reason: ${item.reason}`,
        credibility?.highlights[0]
          ? `Highlight: ${credibility.highlights[0]}`
          : undefined,
        credibility?.risks[0] ? `Risk: ${credibility.risks[0]}` : undefined,
      ]).join("\n");
    }),
    `Competition summary: ${params.competitionSummary}`,
  ]).join("\n");
}

export class ConfidenceAnalysisService {
  private readonly client: PythonConfidenceAnalysisClient;

  constructor(dependencies: ConfidenceAnalysisServiceDependencies) {
    this.client = dependencies.client;
  }

  async analyzeScreeningInsight(params: {
    stockCode: string;
    stockName: string;
    thesis: InvestmentThesis;
    risks: RiskPoint[];
    catalysts: Catalyst[];
    evidenceRefs: EvidenceReference[];
  }): Promise<ConfidenceAnalysis> {
    return this.analyzeRequest({
      module: "screening_insight",
      question: `${params.stockName} (${params.stockCode}) screening insight`,
      responseText: buildScreeningInsightText(params),
      referenceItems: dedupeReferences(
        params.evidenceRefs.map((item) => buildEvidenceReferenceItem(item)),
      ),
    });
  }

  async analyzeCompanyResearch(params: {
    brief: CompanyResearchBrief;
    findings: CompanyQuestionFinding[];
    verdict: CompanyResearchVerdict;
    evidence: CompanyEvidenceNote[];
    references?: CompanyResearchReferenceItem[];
  }): Promise<ConfidenceAnalysis> {
    return this.analyzeRequest({
      module: "company_research",
      question: params.brief.researchGoal,
      responseText: buildCompanyResearchText(params),
      referenceItems: dedupeReferences(
        params.references && params.references.length > 0
          ? params.references.map((item) => buildCompanyResearchReference(item))
          : params.evidence.map((item, index) =>
              buildCompanyEvidenceNoteReference(item, index),
            ),
      ),
    });
  }

  async analyzeQuickResearchCandidates(params: {
    query: string;
    candidates: QuickResearchCandidate[];
    credibility: QuickResearchCredibility[];
    evidenceList: CompanyEvidence[];
  }): Promise<Map<string, ConfidenceAnalysis>> {
    const credibilityByCode = new Map(
      params.credibility.map((item) => [item.stockCode, item]),
    );
    const evidenceByCode = new Map(
      params.evidenceList.map((item) => [item.stockCode, item]),
    );

    const requests: ConfidenceCheckRequest[] = params.candidates.map(
      (candidate) => {
        const credibility = credibilityByCode.get(candidate.stockCode) ?? {
          stockCode: candidate.stockCode,
          credibilityScore: candidate.score,
          highlights: [candidate.reason],
          risks: [],
        };
        const evidence = evidenceByCode.get(candidate.stockCode);

        return {
          module: "quick_research",
          question: params.query,
          responseText: buildQuickResearchCandidateText({
            candidate,
            credibility,
          }),
          referenceItems: dedupeReferences(
            evidence ? [buildCompanyEvidenceReference(evidence)] : [],
          ),
        };
      },
    );

    const analyses = await this.analyzeBatchRequests(requests);

    return new Map(
      analyses.map((item, index) => [
        params.candidates[index]?.stockCode ?? "",
        item,
      ]),
    );
  }

  async analyzeQuickResearchOverall(params: {
    query: string;
    overview: string;
    heatConclusion: string;
    candidates: QuickResearchCandidate[];
    credibility: QuickResearchCredibility[];
    competitionSummary: string;
    news: ThemeNewsItem[];
    evidenceList: CompanyEvidence[];
  }): Promise<ConfidenceAnalysis> {
    return this.analyzeRequest({
      module: "quick_research",
      question: params.query,
      responseText: buildQuickResearchOverallText(params),
      referenceItems: dedupeReferences([
        ...params.news.map((item) => buildThemeNewsReference(item)),
        ...params.evidenceList.map((item) =>
          buildCompanyEvidenceReference(item),
        ),
      ]),
    });
  }

  private async analyzeBatchRequests(
    requests: ConfidenceCheckRequest[],
  ): Promise<ConfidenceAnalysis[]> {
    try {
      return await this.client.checkBatch(requests);
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "Confidence analysis request failed.";

      return requests.map(() => createUnavailableConfidenceAnalysis([reason]));
    }
  }

  private async analyzeRequest(
    request: ConfidenceCheckRequest,
  ): Promise<ConfidenceAnalysis> {
    try {
      return await this.client.check(request);
    } catch (error) {
      return createUnavailableConfidenceAnalysis([
        error instanceof Error
          ? error.message
          : "Confidence analysis request failed.",
      ]);
    }
  }
}

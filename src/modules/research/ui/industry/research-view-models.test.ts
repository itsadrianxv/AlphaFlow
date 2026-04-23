import { describe, expect, it } from "vitest";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  QUICK_RESEARCH_TEMPLATE_CODE,
} from "~/modules/research/server/domain/workflow/types";
import {
  buildResearchDigest,
  extractConfidenceAnalysis,
  extractTimingReportCardIds,
  getQuickResearchModePills,
} from "~/modules/research/ui/industry/research-view-models";

describe("research-view-models", () => {
  it("extracts confidence analysis from quick research results", () => {
    const result = {
      overview: "Overview",
      heatScore: 80,
      heatConclusion: "Conclusion",
      candidates: [],
      credibility: [],
      topPicks: [],
      competitionSummary: "Competition",
      contractScore: 91,
      confidenceAnalysis: {
        status: "COMPLETE",
        finalScore: 88,
        level: "high",
        claimCount: 2,
        supportedCount: 2,
        insufficientCount: 0,
        contradictedCount: 0,
        abstainCount: 0,
        supportRate: 1,
        insufficientRate: 0,
        contradictionRate: 0,
        abstainRate: 0,
        evidenceCoverageScore: 100,
        freshnessScore: 100,
        sourceDiversityScore: 100,
        notes: [],
        claims: [],
      },
      generatedAt: "2026-03-12T00:00:00.000Z",
    };

    expect(extractConfidenceAnalysis(result)?.finalScore).toBe(88);
    expect(
      buildResearchDigest({
        templateCode: QUICK_RESEARCH_TEMPLATE_CODE,
        query: "AI",
        status: "SUCCEEDED",
        result,
      }).metrics.some((item) => item.label === "合同得分"),
    ).toBe(true);
  });

  it("keeps generic digest working for legacy results without confidence", () => {
    const digest = buildResearchDigest({
      templateCode: QUICK_RESEARCH_TEMPLATE_CODE,
      query: "Legacy run",
      status: "SUCCEEDED",
      result: {
        legacy: "value",
      },
    });

    expect(digest.templateLabel).toBe("行业判断");
    expect(digest.metrics.length).toBeGreaterThanOrEqual(0);
  });

  it("downgrades quick research digest to warning when clarification is still needed", () => {
    const digest = buildResearchDigest({
      templateCode: QUICK_RESEARCH_TEMPLATE_CODE,
      query: "AI infra",
      status: "SUCCEEDED",
      result: {
        overview: "Broad overview",
        heatScore: 80,
        heatConclusion: "Conclusion",
        candidates: [],
        credibility: [],
        topPicks: [],
        competitionSummary: "Competition",
        brief: {
          query: "AI infra",
          researchGoal: "goal",
          focusConcepts: ["AI infra"],
          keyQuestions: ["Q1"],
          mustAnswerQuestions: ["Q1"],
          forbiddenEvidenceTypes: [],
          preferredSources: [],
          freshnessWindowDays: 180,
          scopeAssumptions: [],
          clarificationSummary: "Focus on AI infra",
        },
        clarificationRequest: {
          needClarification: true,
          question: "Need more detail",
          verification: "Focus on AI infra",
          missingScopeFields: ["query"],
          suggestedInputPatch: {
            researchPreferences: {
              researchGoal: "Narrow the scope",
            },
          },
        },
        generatedAt: "2026-03-12T00:00:00.000Z",
      },
    });

    expect(digest.verdictTone).toBe("warning");
    expect(digest.summary).toContain("Focus on AI infra");
    expect(digest.nextActions).toContain("补充范围后重新发起");
    expect(digest.gaps).toContain("query");
  });

  it("builds quick research mode pills for standard, deep, and escalated runs", () => {
    expect(
      getQuickResearchModePills({
        overview: "Overview",
        heatScore: 80,
        heatConclusion: "Conclusion",
        candidates: [],
        credibility: [],
        topPicks: [],
        competitionSummary: "Competition",
        requestedDepth: "standard",
        autoEscalated: true,
        autoEscalationReason: "gap_followup",
        structuredModelInitial: "deepseek-chat",
        structuredModelFinal: "deepseek-reasoner",
        generatedAt: "2026-03-12T00:00:00.000Z",
      }),
    ).toEqual(["标准模式", "已自动升级"]);
    expect(
      getQuickResearchModePills({
        overview: "Overview",
        heatScore: 80,
        heatConclusion: "Conclusion",
        candidates: [],
        credibility: [],
        topPicks: [],
        competitionSummary: "Competition",
        requestedDepth: "deep",
        autoEscalated: false,
        autoEscalationReason: null,
        structuredModelInitial: "deepseek-reasoner",
        structuredModelFinal: "deepseek-reasoner",
        generatedAt: "2026-03-12T00:00:00.000Z",
      }),
    ).toEqual(["深度模式"]);
  });

  it("builds company digest from v2 result fields", () => {
    const digest = buildResearchDigest({
      templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
      query: "Company run",
      status: "SUCCEEDED",
      result: {
        brief: {
          companyName: "示例公司",
          researchGoal: "验证利润兑现",
          focusConcepts: ["算力"],
          keyQuestions: [],
        },
        conceptInsights: [],
        deepQuestions: [],
        findings: [
          {
            question: "Q1",
            answer: "A1",
            confidence: "high",
            evidenceUrls: [],
            referenceIds: ["ref-1"],
            gaps: ["gap-1"],
          },
        ],
        evidence: [
          {
            referenceId: "ref-1",
            title: "官网披露",
            sourceName: "example.com",
            sourceType: "official",
            sourceTier: "first_party",
            collectorKey: "official_sources",
            isFirstParty: true,
            snippet: "snippet",
            extractedFact: "fact",
            relevance: "relevance",
          },
        ],
        references: [
          {
            id: "ref-1",
            title: "官网披露",
            sourceName: "example.com",
            sourceType: "official",
            sourceTier: "first_party",
            collectorKey: "official_sources",
            isFirstParty: true,
            snippet: "snippet",
            extractedFact: "fact",
          },
        ],
        verdict: {
          stance: "优先研究",
          summary: "值得继续研究。",
          bullPoints: ["bull"],
          bearPoints: ["bear"],
          nextChecks: ["check"],
        },
        collectionSummary: {
          collectors: [],
          totalRawCount: 4,
          totalCuratedCount: 1,
          totalReferenceCount: 1,
          totalFirstPartyCount: 1,
          notes: [],
        },
        crawler: {
          provider: "tavily",
          configured: true,
          queries: [],
          notes: [],
        },
        contractScore: 84,
        qualityFlags: ["citation_coverage_low"],
        generatedAt: "2026-03-12T00:00:00.000Z",
      },
    });

    expect(digest.templateLabel).toBe("公司判断");
    expect(digest.metrics.some((item) => item.label === "引用数量")).toBe(true);
    expect(digest.metrics.some((item) => item.label === "一手信源")).toBe(true);
    expect(digest.metrics.some((item) => item.label === "合同得分")).toBe(true);
  });
  it("extracts timing report card ids from timing workflow results", () => {
    expect(
      extractTimingReportCardIds({
        cardIds: ["card_1", "card_2"],
      }),
    ).toEqual(["card_1", "card_2"]);

    expect(
      extractTimingReportCardIds({
        recommendationIds: ["rec_1"],
      }),
    ).toEqual([]);
  });
});

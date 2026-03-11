import { describe, expect, it } from "vitest";
import {
  buildResearchDigest,
  extractConfidenceAnalysis,
} from "~/app/workflows/research-view-models";
import { QUICK_RESEARCH_TEMPLATE_CODE } from "~/server/domain/workflow/types";

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
});

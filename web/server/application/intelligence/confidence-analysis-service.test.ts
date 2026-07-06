import { describe, expect, it, vi } from "vitest";
import { ConfidenceAnalysisService } from "~/server/application/intelligence/confidence-analysis-service";
import { createUnavailableConfidenceAnalysis } from "~/server/domain/intelligence/confidence";
import { EvidenceReference } from "~/server/domain/intelligence/entities/evidence-reference";
import { Catalyst } from "~/server/domain/intelligence/value-objects/catalyst";
import { InvestmentThesis } from "~/server/domain/intelligence/value-objects/investment-thesis";
import { RiskPoint } from "~/server/domain/intelligence/value-objects/risk-point";

describe("ConfidenceAnalysisService", () => {
  it("maps screening insight data into a confidence request", async () => {
    const check = vi
      .fn()
      .mockResolvedValue(createUnavailableConfidenceAnalysis(["stub"]));
    const service = new ConfidenceAnalysisService({
      client: {
        check,
      } as never,
    });

    await service.analyzeScreeningInsight({
      stockCode: "600519",
      stockName: "Moutai",
      thesis: InvestmentThesis.create({
        summary: "Summary",
        whyNow: "Why now",
        drivers: ["Driver A"],
        monetizationPath: "Path",
        confidence: "high",
      }),
      risks: [
        RiskPoint.create({
          title: "Risk",
          severity: "medium",
          description: "Risk description",
          monitorMetric: "Metric",
          invalidatesThesisWhen: "Invalidate",
        }),
      ],
      catalysts: [
        Catalyst.create({
          title: "Catalyst",
          windowType: "event",
          importance: 3,
          description: "Catalyst description",
        }),
      ],
      evidenceRefs: [
        EvidenceReference.create({
          title: "Evidence",
          sourceName: "official",
          snippet: "Snippet",
          extractedFact: "Fact",
          credibilityScore: 0.8,
        }),
      ],
    });

    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith(
      expect.objectContaining({
        module: "screening_insight",
        referenceItems: [
          expect.objectContaining({
            title: "Evidence",
            credibilityScore: 0.8,
          }),
        ],
      }),
    );
  });

  it("returns unavailable analysis when the client throws", async () => {
    const service = new ConfidenceAnalysisService({
      client: {
        check: vi.fn().mockRejectedValue(new Error("network down")),
      } as never,
    });

    const analysis = await service.analyzeCompanyResearch({
      brief: {
        companyName: "Acme",
        researchGoal: "Goal",
        focusConcepts: ["AI"],
        keyQuestions: [],
      },
      findings: [
        {
          question: "Question",
          answer: "Answer",
          confidence: "medium",
          evidenceUrls: [],
          referenceIds: ["ref-1"],
          gaps: [],
        },
      ],
      verdict: {
        stance: "继续跟踪",
        summary: "Summary",
        bullPoints: ["Bull"],
        bearPoints: ["Bear"],
        nextChecks: ["Next"],
      },
      evidence: [
        {
          referenceId: "ref-1",
          title: "Evidence",
          sourceName: "official",
          url: "https://example.com",
          sourceType: "official",
          sourceTier: "first_party",
          collectorKey: "official_sources",
          isFirstParty: true,
          snippet: "Snippet",
          extractedFact: "Fact",
          relevance: "Relevant",
        },
      ],
    });

    expect(analysis.status).toBe("UNAVAILABLE");
    expect(analysis.finalScore).toBeNull();
    expect(analysis.notes[0]).toContain("network down");
  });
});

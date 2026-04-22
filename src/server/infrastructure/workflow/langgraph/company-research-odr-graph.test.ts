import { describe, expect, it, vi } from "vitest";
import { WorkflowPauseError } from "~/server/domain/workflow/errors";
import type { CompanyResearchGraphState } from "~/server/domain/workflow/types";
import { ODRCompanyResearchLangGraph } from "~/server/infrastructure/workflow/langgraph/company-research-graph";

function createWorkflowServiceStub() {
  return {
    clarifyScope: vi.fn(async () => ({
      needClarification: false,
      question: "",
      verification: "ready",
      missingScopeFields: [] as string[],
      suggestedInputPatch: {} as Record<string, unknown>,
    })),
    buildBrief: vi.fn(async () => ({
      query: "Validate company thesis",
      companyName: "????",
      stockCode: "600519",
      officialWebsite: "https://example.com",
      researchGoal: "??????",
      focusConcepts: ["??"],
      keyQuestions: ["Q1"],
      mustAnswerQuestions: ["Q1"],
      forbiddenEvidenceTypes: [],
      preferredSources: ["official disclosure"],
      freshnessWindowDays: 180,
      scopeAssumptions: [],
    })),
    planUnits: vi.fn(async () => ({
      brief: {
        companyName: "????",
        stockCode: "600519",
        officialWebsite: "https://example.com",
        researchGoal: "??????",
        focusConcepts: ["??"],
        keyQuestions: ["Q1"],
      },
      conceptInsights: [
        {
          concept: "绠楀姏",
          whyItMatters: "why",
          companyFit: "fit",
          monetizationPath: "path",
          maturity: "鏍稿績鎴愮啛",
        },
      ],
      deepQuestions: [
        {
          question: "Q1",
          whyImportant: "important",
          targetMetric: "metric",
          dataHint: "hint",
        },
      ],
      researchUnits: [
        {
          id: "financial_pack",
          title: "Financial pack",
          objective: "Review financial proof",
          keyQuestions: ["Q1"],
          priority: "high",
          capability: "financial_pack",
          dependsOn: [],
        },
      ],
    })),
    executeUnits: vi.fn(async () => ({
      groundedSources: [],
      collectedEvidenceByCollector: {
        financial_sources: [
          {
            referenceId: "ref-1",
            title: "Finance",
            sourceName: "akshare",
            sourceType: "financial",
            sourceTier: "third_party",
            collectorKey: "financial_sources",
            isFirstParty: false,
            snippet: "snippet",
            extractedFact: "fact",
            relevance: "high",
          },
        ],
      },
      collectorRunInfo: {
        financial_sources: {
          collectorKey: "financial_sources",
          configured: true,
          queries: [],
          notes: [],
        },
      },
      collectorPacks: {},
      collectionNotes: [],
      researchNotes: [
        {
          noteId: "note-1",
          unitId: "financial_pack",
          title: "Financial pack",
          summary: "summary",
          keyFacts: ["fact"],
          missingInfo: [],
          evidenceReferenceIds: ["ref-1"],
          sourceUrls: [],
        },
      ],
      researchUnitRuns: [
        {
          unitId: "financial_pack",
          title: "Financial pack",
          capability: "financial_pack",
          status: "completed",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          notes: ["summary"],
          sourceUrls: [],
          evidenceCount: 1,
        },
      ],
      researchUnits: [
        {
          id: "financial_pack",
          title: "Financial pack",
          objective: "Review financial proof",
          keyQuestions: ["Q1"],
          priority: "high",
          capability: "financial_pack",
          dependsOn: [],
        },
      ],
    })),
    curateEvidence: vi.fn(() => ({
      evidence: [
        {
          referenceId: "ref-1",
          title: "Finance",
          sourceName: "akshare",
          sourceType: "financial",
          sourceTier: "third_party",
          collectorKey: "financial_sources",
          isFirstParty: false,
          snippet: "snippet",
          extractedFact: "fact",
          relevance: "high",
        },
      ],
      references: [
        {
          id: "ref-1",
          title: "Finance",
          sourceName: "akshare",
          snippet: "snippet",
          extractedFact: "fact",
          sourceType: "financial",
          sourceTier: "third_party",
          collectorKey: "financial_sources",
          isFirstParty: false,
        },
      ],
      collectionSummary: {
        collectors: [],
        totalRawCount: 1,
        totalCuratedCount: 1,
        totalReferenceCount: 1,
        totalFirstPartyCount: 0,
        notes: [],
      },
      crawler: {
        provider: "tavily" as const,
        configured: false,
        queries: [],
        notes: [],
      },
    })),
    runGapLoop: vi.fn(async ({ state }) => ({
      state: {
        ...state,
        gapAnalysis: {
          requiresFollowup: false,
          summary: "enough",
          missingAreas: [],
          followupUnits: [],
          iteration: 0,
        },
      },
      gapAnalysis: {
        requiresFollowup: false,
        summary: "enough",
        missingAreas: [],
        followupUnits: [],
        iteration: 0,
      },
    })),
    compressFindings: vi.fn(async () => ({
      summary: "compressed",
      highlights: ["fact"],
      openQuestions: [],
      noteIds: [],
    })),
    enrichReferences: vi.fn(async (state) => ({
      references: state.references ?? [],
      evidence: state.evidence ?? [],
    })),
    finalizeReport: vi.fn(async () => ({
      brief: {
        companyName: "????",
        stockCode: "600519",
        officialWebsite: "https://example.com",
        researchGoal: "??????",
        focusConcepts: ["??"],
        keyQuestions: ["Q1"],
      },
      conceptInsights: [],
      deepQuestions: [],
      findings: [],
      evidence: [],
      references: [],
      verdict: {
        stance: "????",
        summary: "summary",
        bullPoints: [],
        bearPoints: [],
        nextChecks: [],
      },
      collectionSummary: {
        collectors: [],
        totalRawCount: 1,
        totalCuratedCount: 1,
        totalReferenceCount: 1,
        totalFirstPartyCount: 0,
        notes: [],
      },
      crawler: {
        provider: "tavily" as const,
        configured: false,
        queries: [],
        notes: [],
      },
      researchPlan: [],
      researchNotes: [],
      compressedFindings: {
        summary: "compressed",
        highlights: ["fact"],
        openQuestions: [],
        noteIds: [],
      },
      gapAnalysis: {
        requiresFollowup: false,
        summary: "enough",
        missingAreas: [],
        followupUnits: [],
        iteration: 0,
      },
      runtimeConfigSummary: {
        allowClarification: true,
        maxConcurrentResearchUnits: 3,
        maxGapIterations: 2,
        maxUnitsPerPlan: 6,
        maxEvidencePerUnit: 8,
      },
      generatedAt: new Date().toISOString(),
    })),
  };
}

describe("company-research-odr-graph", () => {
  it("runs the v3 company graph and produces research metadata", async () => {
    const graph = new ODRCompanyResearchLangGraph(
      createWorkflowServiceStub() as never,
    );
    const finalState = (await graph.execute({
      initialState: graph.buildInitialState({
        runId: "run-1",
        userId: "user-1",
        query: "????",
        input: {
          companyName: "????",
          stockCode: "600519",
          officialWebsite: "https://example.com",
        },
        progressPercent: 0,
        templateGraphConfig: {
          nodes: graph.getNodeOrder(),
        },
      }),
    })) as CompanyResearchGraphState;

    expect(graph.templateVersion).toBe(3);
    expect(finalState.researchBrief?.companyName).toBe("????");
    expect(finalState.compressedFindings?.summary).toBe("compressed");
    expect(finalState.finalReport?.runtimeConfigSummary?.maxUnitsPerPlan).toBe(
      6,
    );
  });

  it("pauses the v3 company graph when clarification is required", async () => {
    const service = createWorkflowServiceStub();
    service.clarifyScope = vi.fn(async () => ({
      needClarification: true,
      question: "Need more scope",
      verification: "",
      missingScopeFields: ["researchGoal"],
      suggestedInputPatch: {
        focusConcepts: ["绠楀姏"],
      },
    }));
    const graph = new ODRCompanyResearchLangGraph(service as never);

    await expect(
      graph.execute({
        initialState: graph.buildInitialState({
          runId: "run-2",
          userId: "user-1",
          query: "????",
          input: {
            companyName: "????",
          },
          progressPercent: 0,
        }),
      }),
    ).rejects.toBeInstanceOf(WorkflowPauseError);
  });
});

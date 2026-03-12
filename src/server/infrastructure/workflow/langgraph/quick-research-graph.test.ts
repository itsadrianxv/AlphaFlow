import { describe, expect, it, vi } from "vitest";
import { WorkflowPauseError } from "~/server/domain/workflow/errors";
import type { QuickResearchGraphState } from "~/server/domain/workflow/types";
import {
  QuickResearchLangGraph,
  QuickResearchODRLangGraph,
} from "~/server/infrastructure/workflow/langgraph/quick-research-graph";

function createLegacyServiceStub() {
  return {
    generateIndustryOverview: vi.fn(async () => ({
      overview: "overview",
      news: [],
    })),
    analyzeMarketHeat: vi.fn(async () => ({
      heatScore: 72,
      heatConclusion: "heat",
      news: [],
    })),
    screenCandidates: vi.fn(async () => [
      {
        stockCode: "600519",
        stockName: "Sample",
        reason: "reason",
        score: 88,
      },
    ]),
    evaluateCredibility: vi.fn(async () => ({
      credibility: [
        {
          stockCode: "600519",
          credibilityScore: 86,
          highlights: ["highlight"],
          risks: ["risk"],
        },
      ],
      evidenceList: [],
    })),
    summarizeCompetition: vi.fn(async () => "competition"),
    analyzeQuickResearchOverall: vi.fn(async () => ({
      status: "COMPLETE",
      finalScore: 80,
      level: "high",
      supportedCount: 3,
      insufficientCount: 0,
      contradictedCount: 0,
      evidenceCoverageScore: 90,
    })),
    buildFinalReport: vi.fn((params) => ({
      overview: params.overview,
      heatScore: params.heatScore,
      heatConclusion: params.heatConclusion,
      candidates: params.candidates,
      credibility: params.credibility,
      topPicks: [
        {
          stockCode: "600519",
          stockName: "Sample",
          reason: "highlight",
        },
      ],
      competitionSummary: params.competitionSummary,
      confidenceAnalysis: params.confidenceAnalysis,
      generatedAt: new Date().toISOString(),
    })),
  };
}

function createODRServiceStub() {
  return {
    clarifyScope: vi.fn(async () => ({
      needClarification: false,
      question: "",
      verification: "ready",
      missingScopeFields: [] as string[],
      suggestedInputPatch: {} as Record<string, unknown>,
    })),
    buildBrief: vi.fn(async () => ({
      query: "AI infra",
      researchGoal: "goal",
      focusConcepts: ["AI infra"],
      keyQuestions: ["Q1"],
      mustAnswerQuestions: ["Q1"],
      forbiddenEvidenceTypes: [],
      preferredSources: ["official disclosure"],
      freshnessWindowDays: 180,
      scopeAssumptions: [],
    })),
    planUnits: vi.fn(async () => [
      {
        id: "theme_overview",
        title: "Theme overview",
        objective: "Understand context",
        keyQuestions: ["Q1"],
        priority: "high",
        capability: "theme_overview",
        dependsOn: [],
      },
    ]),
    executeUnits: vi.fn(async () => ({
      industryOverview: "overview",
      news: [],
      researchNotes: [
        {
          noteId: "note-1",
          unitId: "theme_overview",
          title: "Theme overview",
          summary: "summary",
          keyFacts: ["fact"],
          missingInfo: [],
          evidenceReferenceIds: [],
          sourceUrls: [],
        },
      ],
      researchUnitRuns: [
        {
          unitId: "theme_overview",
          title: "Theme overview",
          capability: "theme_overview",
          status: "completed",
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          notes: ["summary"],
          sourceUrls: [],
          evidenceCount: 0,
        },
      ],
      researchUnits: [
        {
          id: "theme_overview",
          title: "Theme overview",
          objective: "Understand context",
          keyQuestions: ["Q1"],
          priority: "high",
          capability: "theme_overview",
          dependsOn: [],
        },
      ],
    })),
    runGapAnalysis: vi.fn(async () => ({
      gapAnalysis: {
        requiresFollowup: false,
        summary: "enough",
        missingAreas: [],
        followupUnits: [],
        iteration: 0,
      },
      researchNotes: [
        {
          noteId: "note-1",
          unitId: "theme_overview",
          title: "Theme overview",
          summary: "summary",
          keyFacts: ["fact"],
          missingInfo: [],
          evidenceReferenceIds: [],
          sourceUrls: [],
        },
      ],
      researchUnitRuns: [],
      researchUnits: [],
      snapshot: {},
    })),
    compressFindings: vi.fn(async () => ({
      summary: "compressed",
      highlights: ["fact"],
      openQuestions: [],
      noteIds: [],
    })),
    finalizeReport: vi.fn(async () => ({
      overview: "overview",
      heatScore: 72,
      heatConclusion: "heat",
      candidates: [],
      credibility: [],
      topPicks: [],
      competitionSummary: "competition",
      generatedAt: new Date().toISOString(),
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
    })),
  };
}

describe("quick-research-graph", () => {
  it("keeps legacy quick research graph on template v1", async () => {
    const graph = new QuickResearchLangGraph(createLegacyServiceStub() as never);
    const finalState = (await graph.execute({
      initialState: graph.buildInitialState({
        runId: "run-1",
        userId: "user-1",
        query: "AI infra",
        input: { query: "AI infra" },
        progressPercent: 0,
      }),
    })) as QuickResearchGraphState;

    expect(graph.templateVersion).toBe(1);
    expect(finalState.finalReport?.heatScore).toBe(72);
  });

  it("runs the ODR quick graph on template v2", async () => {
    const graph = new QuickResearchODRLangGraph(createODRServiceStub() as never);
    const finalState = (await graph.execute({
      initialState: graph.buildInitialState({
        runId: "run-2",
        userId: "user-1",
        query: "AI infra",
        input: { query: "AI infra" },
        progressPercent: 0,
        templateGraphConfig: {
          nodes: graph.getNodeOrder(),
        },
      }),
    })) as QuickResearchGraphState;

    expect(graph.templateVersion).toBe(2);
    expect(finalState.researchBrief?.researchGoal).toBe("goal");
    expect(finalState.compressedFindings?.summary).toBe("compressed");
    expect(finalState.finalReport?.brief?.researchGoal).toBe("goal");
  });

  it("pauses the ODR quick graph when clarification is required", async () => {
    const service = createODRServiceStub();
    service.clarifyScope = vi.fn(async () => ({
      needClarification: true,
      question: "Need more detail",
      verification: "",
      missingScopeFields: ["query"],
      suggestedInputPatch: {},
    }));
    const graph = new QuickResearchODRLangGraph(service as never);

    await expect(
      graph.execute({
        initialState: graph.buildInitialState({
          runId: "run-3",
          userId: "user-1",
          query: "AI",
          input: { query: "AI" },
          progressPercent: 0,
        }),
      }),
    ).rejects.toBeInstanceOf(WorkflowPauseError);
  });
});

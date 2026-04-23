import { describe, expect, it, vi } from "vitest";
import type { QuickResearchGraphState } from "~/modules/research/server/domain/workflow/types";
import { QuickResearchLangGraph } from "~/modules/research/server/workflows/langgraph/quick-research-graph";

function createQuickResearchServiceStub() {
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
    buildTaskContract: vi.fn(async () => ({
      requiredSources: ["news", "financial"],
      requiredSections: [
        "research_spec",
        "trend_analysis",
        "candidate_screening",
      ],
      citationRequired: false,
      analysisDepth: "standard",
      deadlineMinutes: 30,
    })),
    clarifyScope: vi.fn(async () => ({
      needClarification: false,
      question: "",
      verification: "ready",
      missingScopeFields: [] as string[],
      suggestedInputPatch: {} as Record<string, unknown>,
    })),
    buildBrief: vi.fn(
      async (_input, _runtimeConfig, clarificationSummary?: string) => ({
        query: "AI infra",
        researchGoal: "goal",
        focusConcepts: ["AI infra"],
        keyQuestions: ["Q1"],
        mustAnswerQuestions: ["Q1"],
        forbiddenEvidenceTypes: [],
        preferredSources: ["official disclosure"],
        freshnessWindowDays: 180,
        scopeAssumptions: [],
        clarificationSummary,
      }),
    ),
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
    finalizeReport: vi.fn(async (params) => ({
      overview: "overview",
      heatScore: 72,
      heatConclusion: "heat",
      candidates: [],
      credibility: [],
      topPicks: [],
      competitionSummary: "competition",
      generatedAt: new Date().toISOString(),
      brief: params.state.researchBrief ?? {
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
      reflection: {
        status: "pass",
        summary: "ok",
        contractScore: 88,
        citationCoverage: 0,
        firstPartyRatio: 0,
        answeredQuestionCoverage: 1,
        missingRequirements: [] as string[],
        unansweredQuestions: [] as string[],
        qualityFlags: [] as string[],
        suggestedFixes: [] as string[],
      },
      contractScore: 88,
      qualityFlags: [] as string[],
      missingRequirements: [] as string[],
      clarificationRequest: params.state.clarificationRequest,
    })),
  };
}

describe("quick-research-graph", () => {
  it("runs quick research on template v3 only", async () => {
    const graph = new QuickResearchLangGraph(
      createQuickResearchServiceStub() as never,
    );
    const finalState = (await graph.execute({
      initialState: graph.buildInitialState({
        runId: "run-1",
        userId: "user-1",
        query: "AI infra",
        input: { query: "AI infra" },
        progressPercent: 0,
        templateGraphConfig: {
          nodes: graph.getNodeOrder(),
        },
      }),
    })) as QuickResearchGraphState;

    expect(graph.templateVersion).toBe(3);
    expect(finalState.taskContract?.deadlineMinutes).toBe(30);
    expect(finalState.contractScore).toBe(88);
    expect(finalState.reflection?.status).toBe("pass");
  });

  it("keeps running when clarification is required and carries the warning forward", async () => {
    const service = createQuickResearchServiceStub();
    service.clarifyScope = vi.fn(async () => ({
      needClarification: true,
      question: "Need more detail",
      verification: "Focus on AI infra",
      missingScopeFields: ["query"],
      suggestedInputPatch: {
        researchPreferences: {
          researchGoal: "Narrow the scope",
        },
      },
    }));
    const graph = new QuickResearchLangGraph(service as never);
    const finalState = (await graph.execute({
      initialState: graph.buildInitialState({
        runId: "run-2",
        userId: "user-1",
        query: "AI",
        input: { query: "AI" },
        progressPercent: 0,
        templateGraphConfig: {
          nodes: graph.getNodeOrder(),
        },
      }),
    })) as QuickResearchGraphState;

    expect(finalState.clarificationRequest).toEqual(
      expect.objectContaining({
        needClarification: true,
        question: "Need more detail",
        verification: "Focus on AI infra",
      }),
    );
    expect(finalState.researchBrief?.clarificationSummary).toBe(
      "Focus on AI infra",
    );
    expect(finalState.finalReport?.brief?.clarificationSummary).toBe(
      "Focus on AI infra",
    );
    expect(finalState.finalReport?.clarificationRequest).toEqual(
      expect.objectContaining({
        needClarification: true,
        question: "Need more detail",
      }),
    );
  });

  it("emits clarification payload for the clarify node", () => {
    const graph = new QuickResearchLangGraph(
      createQuickResearchServiceStub() as never,
    );

    expect(
      graph.getNodeEventPayload("agent0_clarify_scope", {
        runId: "run-3",
        userId: "user-1",
        query: "AI",
        progressPercent: 0,
        currentNodeKey: "agent0_clarify_scope",
        errors: [],
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
      }),
    ).toEqual(
      expect.objectContaining({
        clarificationRequired: true,
        question: "Need more detail",
        verification: "Focus on AI infra",
        missingScopeFields: ["query"],
      }),
    );
  });

  it("keeps structured nodes on chat by default even when researchGoal exists", async () => {
    const service = createQuickResearchServiceStub();
    const graph = new QuickResearchLangGraph(service as never);

    await graph.execute({
      initialState: graph.buildInitialState({
        runId: "run-4",
        userId: "user-1",
        query: "AI infra",
        input: {
          query: "AI infra",
          researchPreferences: {
            researchGoal: "Find the clearest monetization path",
          },
        },
        progressPercent: 0,
        templateGraphConfig: {
          nodes: graph.getNodeOrder(),
        },
      }),
    });

    expect(service.buildTaskContract).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        structuredModel: "deepseek-chat",
      }),
    );
    expect(service.buildBrief).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        structuredModel: "deepseek-chat",
      }),
    );
    expect(service.planUnits).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        structuredModel: "deepseek-chat",
      }),
    );
  });

  it("uses reasoner for structured nodes on the first pass when deep is explicit", async () => {
    const service = createQuickResearchServiceStub();
    const graph = new QuickResearchLangGraph(service as never);

    const finalState = (await graph.execute({
      initialState: graph.buildInitialState({
        runId: "run-5",
        userId: "user-1",
        query: "AI infra",
        input: {
          query: "AI infra",
          taskContract: {
            requiredSources: ["news", "financial"],
            requiredSections: [
              "research_spec",
              "trend_analysis",
              "candidate_screening",
              "competition",
              "top_picks",
            ],
            citationRequired: false,
            analysisDepth: "deep",
            deadlineMinutes: 30,
          },
        },
        progressPercent: 0,
        templateGraphConfig: {
          nodes: graph.getNodeOrder(),
        },
      }),
    })) as QuickResearchGraphState;

    expect(service.buildTaskContract).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        structuredModel: "deepseek-reasoner",
      }),
    );
    expect(finalState.requestedDepth).toBe("deep");
    expect(finalState.structuredModelInitial).toBe("deepseek-reasoner");
    expect(finalState.structuredModelFinal).toBe("deepseek-reasoner");
  });

  it("auto-escalates to reasoner once when gap follow-up remains", async () => {
    const service = createQuickResearchServiceStub();
    service.runGapAnalysis = vi
      .fn()
      .mockResolvedValueOnce({
        gapAnalysis: {
          requiresFollowup: true,
          summary: "Need a better gap pass",
          missingAreas: ["competition"],
          followupUnits: [],
          iteration: 1,
        },
        researchNotes: [],
        researchUnitRuns: [],
        researchUnits: [],
        replanRecords: [],
        snapshot: {},
      })
      .mockResolvedValueOnce({
        gapAnalysis: {
          requiresFollowup: false,
          summary: "Escalated gap pass is enough",
          missingAreas: [],
          followupUnits: [],
          iteration: 1,
        },
        researchNotes: [],
        researchUnitRuns: [],
        researchUnits: [],
        replanRecords: [],
        snapshot: {},
      });
    const graph = new QuickResearchLangGraph(service as never);

    const finalState = (await graph.execute({
      initialState: graph.buildInitialState({
        runId: "run-6",
        userId: "user-1",
        query: "AI infra",
        input: { query: "AI infra" },
        progressPercent: 0,
        templateGraphConfig: {
          nodes: graph.getNodeOrder(),
        },
      }),
    })) as QuickResearchGraphState;

    expect(service.runGapAnalysis).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        state: expect.anything(),
        runtimeConfig: expect.anything(),
      }),
      expect.objectContaining({
        structuredModel: "deepseek-chat",
      }),
    );
    expect(service.runGapAnalysis).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        state: expect.anything(),
        runtimeConfig: expect.anything(),
      }),
      expect.objectContaining({
        structuredModel: "deepseek-reasoner",
      }),
    );
    expect(finalState.autoEscalated).toBe(true);
    expect(finalState.autoEscalationReason).toBe("gap_followup");
    expect(finalState.structuredModelFinal).toBe("deepseek-reasoner");
    expect(service.compressFindings).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        structuredModel: "deepseek-reasoner",
      }),
    );
  });

  it("auto-escalates to reasoner once when reflection fails but not on warn", async () => {
    const service = createQuickResearchServiceStub();
    service.runGapAnalysis = vi
      .fn()
      .mockResolvedValueOnce({
        gapAnalysis: {
          requiresFollowup: false,
          summary: "enough",
          missingAreas: [],
          followupUnits: [],
          iteration: 0,
        },
        researchNotes: [],
        researchUnitRuns: [],
        researchUnits: [],
        replanRecords: [],
        snapshot: {},
      })
      .mockResolvedValueOnce({
        gapAnalysis: {
          requiresFollowup: false,
          summary: "reasoner pass",
          missingAreas: [],
          followupUnits: [],
          iteration: 0,
        },
        researchNotes: [],
        researchUnitRuns: [],
        researchUnits: [],
        replanRecords: [],
        snapshot: {},
      });
    service.finalizeReport = vi
      .fn()
      .mockResolvedValueOnce({
        overview: "overview",
        heatScore: 72,
        heatConclusion: "heat",
        candidates: [],
        credibility: [],
        topPicks: [],
        competitionSummary: "competition",
        generatedAt: new Date().toISOString(),
        reflection: {
          status: "fail",
          summary: "fail",
          contractScore: 58,
          citationCoverage: 0,
          firstPartyRatio: 0,
          answeredQuestionCoverage: 0.4,
          missingRequirements: ["missing_section:top_picks"],
          unansweredQuestions: ["Q1"],
          qualityFlags: ["missing_required_sections"],
          suggestedFixes: [],
        },
        contractScore: 58,
        qualityFlags: ["missing_required_sections"],
        missingRequirements: ["missing_section:top_picks"],
      })
      .mockResolvedValueOnce({
        overview: "overview",
        heatScore: 72,
        heatConclusion: "heat",
        candidates: [],
        credibility: [],
        topPicks: [],
        competitionSummary: "competition",
        generatedAt: new Date().toISOString(),
        reflection: {
          status: "pass",
          summary: "pass",
          contractScore: 88,
          citationCoverage: 0,
          firstPartyRatio: 0,
          answeredQuestionCoverage: 1,
          missingRequirements: [],
          unansweredQuestions: [],
          qualityFlags: [],
          suggestedFixes: [],
        },
        contractScore: 88,
        qualityFlags: [],
        missingRequirements: [],
      });
    const graph = new QuickResearchLangGraph(service as never);

    const finalState = (await graph.execute({
      initialState: graph.buildInitialState({
        runId: "run-7",
        userId: "user-1",
        query: "AI infra",
        input: { query: "AI infra" },
        progressPercent: 0,
        templateGraphConfig: {
          nodes: graph.getNodeOrder(),
        },
      }),
    })) as QuickResearchGraphState;

    expect(service.runGapAnalysis).toHaveBeenCalledTimes(2);
    expect(service.runGapAnalysis).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        state: expect.anything(),
        runtimeConfig: expect.anything(),
      }),
      expect.objectContaining({
        structuredModel: "deepseek-reasoner",
      }),
    );
    expect(finalState.autoEscalated).toBe(true);
    expect(finalState.autoEscalationReason).toBe("reflection_fail");
    expect(finalState.reflection?.status).toBe("pass");
  });

  it("does not auto-escalate when reflection only warns", async () => {
    const service = createQuickResearchServiceStub();
    service.finalizeReport = vi.fn(async (params) => ({
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
      clarificationRequest: params.state.clarificationRequest,
      reflection: {
        status: "warn",
        summary: "warn",
        contractScore: 72,
        citationCoverage: 0,
        firstPartyRatio: 0,
        answeredQuestionCoverage: 0.8,
        missingRequirements: ["missing_section:top_picks"],
        unansweredQuestions: [],
        qualityFlags: ["missing_required_sections"],
        suggestedFixes: [],
      },
      contractScore: 72,
      qualityFlags: ["missing_required_sections"],
      missingRequirements: ["missing_section:top_picks"],
    }));
    const graph = new QuickResearchLangGraph(service as never);

    const finalState = (await graph.execute({
      initialState: graph.buildInitialState({
        runId: "run-8",
        userId: "user-1",
        query: "AI infra",
        input: { query: "AI infra" },
        progressPercent: 0,
        templateGraphConfig: {
          nodes: graph.getNodeOrder(),
        },
      }),
    })) as QuickResearchGraphState;

    expect(service.runGapAnalysis).toHaveBeenCalledTimes(1);
    expect(service.finalizeReport).toHaveBeenCalledTimes(1);
    expect(finalState.autoEscalated).toBe(false);
    expect(finalState.autoEscalationReason).toBeNull();
    expect(finalState.reflection?.status).toBe("warn");
  });
});

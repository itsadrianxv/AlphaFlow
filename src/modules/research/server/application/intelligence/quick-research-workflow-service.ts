import type { IntelligenceAgentService } from "~/modules/research/server/application/intelligence/intelligence-agent-service";
import { reflectQuickResearch } from "~/modules/research/server/application/intelligence/research-reflection";
import {
  analyzeResearchGaps,
  buildDefaultTaskContract,
  clarifyResearchScope,
  compressResearchFindings,
  planResearchUnits,
  writeResearchBrief,
  writeTaskContract,
} from "~/modules/research/server/application/intelligence/research-workflow-kernel";
import type {
  CompanyEvidence,
  ThemeNewsItem,
} from "~/modules/research/server/domain/intelligence/types";
import type {
  CompressedFindings,
  ResearchGapAnalysis,
  ResearchNote,
  ResearchReplanRecord,
  ResearchRuntimeConfig,
  ResearchUnitCapability,
  ResearchUnitPlan,
  ResearchUnitRun,
} from "~/modules/research/server/domain/workflow/research";
import type {
  QuickResearchCredibility,
  QuickResearchGraphState,
  QuickResearchInput,
  QuickResearchResultDto,
  QuickResearchStructuredModel,
} from "~/modules/research/server/domain/workflow/types";
import type { DeepSeekClient } from "~/modules/research/server/infrastructure/intelligence/deepseek-client";

type QuickResearchWorkflowServiceDependencies = {
  client: DeepSeekClient;
  intelligenceService: IntelligenceAgentService;
};

type QuickExecutionSnapshot = {
  industryOverview?: string;
  news?: ThemeNewsItem[];
  heatAnalysis?: QuickResearchGraphState["heatAnalysis"];
  candidates?: QuickResearchGraphState["candidates"];
  credibility?: QuickResearchCredibility[];
  evidenceList?: CompanyEvidence[];
  competition?: string;
};

type QuickStructuredRequestOptions = {
  structuredModel?: QuickResearchStructuredModel;
};

const QUICK_ALLOWED_CAPABILITIES: ResearchUnitCapability[] = [
  "theme_overview",
  "market_heat",
  "candidate_screening",
  "credibility_lookup",
  "competition_synthesis",
];

function uniqueStrings(items: string[], limit = 6) {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(
    0,
    limit,
  );
}

function buildNote(params: {
  unit: ResearchUnitPlan;
  summary: string;
  keyFacts: string[];
  missingInfo?: string[];
}): ResearchNote {
  return {
    noteId: `${params.unit.id}_note`,
    unitId: params.unit.id,
    title: params.unit.title,
    summary: params.summary,
    keyFacts: uniqueStrings(params.keyFacts, 6),
    missingInfo: uniqueStrings(params.missingInfo ?? [], 4),
    evidenceReferenceIds: [],
    sourceUrls: [],
  };
}

function buildFallbackBrief(state: QuickResearchGraphState) {
  return {
    query: state.query,
    researchGoal: state.query,
    focusConcepts: [],
    keyQuestions: [],
    mustAnswerQuestions: [state.query],
    forbiddenEvidenceTypes: [],
    preferredSources: [],
    freshnessWindowDays: 180,
    scopeAssumptions: [],
  } satisfies QuickResearchResultDto["brief"];
}

function resolveTaskContract(state: QuickResearchGraphState) {
  return (
    state.taskContract ??
    buildDefaultTaskContract({
      subject: "quick",
      preferences: state.researchInput?.researchPreferences,
      taskContract: state.researchInput?.taskContract,
    })
  );
}

export class QuickResearchWorkflowService {
  private readonly client: DeepSeekClient;
  private readonly intelligenceService: IntelligenceAgentService;

  constructor(dependencies: QuickResearchWorkflowServiceDependencies) {
    this.client = dependencies.client;
    this.intelligenceService = dependencies.intelligenceService;
  }

  async buildTaskContract(
    input: QuickResearchInput,
    runtimeConfig: ResearchRuntimeConfig,
    options?: QuickStructuredRequestOptions,
  ) {
    return writeTaskContract({
      client: this.client,
      subject: "quick",
      preferences: input.researchPreferences,
      taskContract: input.taskContract,
      runtimeConfig,
      structuredModel: options?.structuredModel,
    });
  }

  async clarifyScope(
    input: QuickResearchInput,
    runtimeConfig: ResearchRuntimeConfig,
  ) {
    return clarifyResearchScope({
      client: this.client,
      subject: "quick",
      query: input.query,
      preferences: input.researchPreferences,
      runtimeConfig,
    });
  }

  async buildBrief(
    input: QuickResearchInput,
    runtimeConfig: ResearchRuntimeConfig,
    clarificationSummary?: string,
    options?: QuickStructuredRequestOptions,
  ) {
    return writeResearchBrief({
      client: this.client,
      subject: "quick",
      query: input.query,
      preferences: input.researchPreferences,
      taskContract: input.taskContract,
      runtimeConfig,
      clarificationSummary,
      structuredModel: options?.structuredModel,
    });
  }

  async planUnits(
    state: QuickResearchGraphState,
    runtimeConfig: ResearchRuntimeConfig,
    options?: QuickStructuredRequestOptions,
  ) {
    return planResearchUnits({
      client: this.client,
      subject: "quick",
      brief: state.researchBrief ?? {
        query: state.query,
        researchGoal: state.query,
        focusConcepts: [],
        keyQuestions: [],
        mustAnswerQuestions: [state.query],
        forbiddenEvidenceTypes: [],
        preferredSources: [],
        freshnessWindowDays: 180,
        scopeAssumptions: [],
      },
      taskContract:
        state.taskContract ??
        buildDefaultTaskContract({
          subject: "quick",
          preferences: state.researchInput?.researchPreferences,
          taskContract: state.researchInput?.taskContract,
        }),
      allowedCapabilities: QUICK_ALLOWED_CAPABILITIES,
      runtimeConfig,
      structuredModel: options?.structuredModel,
    });
  }

  private async executeUnit(
    unit: ResearchUnitPlan,
    state: QuickExecutionSnapshot,
  ): Promise<{
    patch: Partial<QuickExecutionSnapshot>;
    note: ResearchNote;
    run: ResearchUnitRun;
  }> {
    const startedAt = new Date().toISOString();

    try {
      if (unit.capability === "theme_overview") {
        const overview =
          await this.intelligenceService.generateIndustryOverview(
            unit.objective || state.industryOverview || "",
          );
        return {
          patch: {
            industryOverview: overview.overview,
            news: overview.news,
          },
          note: buildNote({
            unit,
            summary: overview.overview,
            keyFacts: overview.news.slice(0, 3).map((item) => item.title),
            missingInfo:
              overview.news.length === 0
                ? ["No recent theme news returned."]
                : [],
          }),
          run: {
            unitId: unit.id,
            title: unit.title,
            capability: unit.capability,
            status: "completed",
            attempt: 1,
            repairCount: 0,
            validationErrors: [],
            qualityFlags: overview.news.length === 0 ? ["no_theme_news"] : [],
            startedAt,
            completedAt: new Date().toISOString(),
            notes: [overview.overview],
            sourceUrls: [],
            evidenceCount: overview.news.length,
          },
        };
      }

      if (unit.capability === "market_heat") {
        const heat = await this.intelligenceService.analyzeMarketHeat(
          state.industryOverview || unit.objective,
          state.news,
        );
        return {
          patch: {
            news: heat.news,
            heatAnalysis: {
              heatScore: heat.heatScore,
              heatConclusion: heat.heatConclusion,
            },
          },
          note: buildNote({
            unit,
            summary: heat.heatConclusion,
            keyFacts: [
              `Heat score: ${heat.heatScore}`,
              `News count: ${heat.news.length}`,
            ],
          }),
          run: {
            unitId: unit.id,
            title: unit.title,
            capability: unit.capability,
            status: "completed",
            attempt: 1,
            repairCount: 0,
            validationErrors: [],
            qualityFlags: heat.news.length === 0 ? ["no_heat_news"] : [],
            startedAt,
            completedAt: new Date().toISOString(),
            notes: [heat.heatConclusion],
            sourceUrls: [],
            evidenceCount: heat.news.length,
          },
        };
      }

      if (unit.capability === "candidate_screening") {
        const candidates = await this.intelligenceService.screenCandidates(
          unit.keyQuestions[0] || unit.objective,
          state.heatAnalysis?.heatScore ?? 50,
        );
        return {
          patch: {
            candidates,
          },
          note: buildNote({
            unit,
            summary: `Screened ${candidates.length} candidates.`,
            keyFacts: candidates.slice(0, 3).map((item) => item.stockName),
            missingInfo:
              candidates.length === 0
                ? ["No candidates were returned from the screening service."]
                : [],
          }),
          run: {
            unitId: unit.id,
            title: unit.title,
            capability: unit.capability,
            status: "completed",
            attempt: 1,
            repairCount: 0,
            validationErrors: [],
            qualityFlags: candidates.length === 0 ? ["no_candidates"] : [],
            startedAt,
            completedAt: new Date().toISOString(),
            notes: [`Candidate count: ${candidates.length}`],
            sourceUrls: [],
            evidenceCount: candidates.length,
          },
        };
      }

      if (unit.capability === "credibility_lookup") {
        const credibility = await this.intelligenceService.evaluateCredibility(
          unit.keyQuestions[0] || unit.objective,
          state.candidates ?? [],
        );
        return {
          patch: {
            credibility: credibility.credibility,
            evidenceList: credibility.evidenceList,
          },
          note: buildNote({
            unit,
            summary: `Validated ${credibility.credibility.length} candidates.`,
            keyFacts: credibility.credibility
              .slice(0, 3)
              .map((item) =>
                `${item.stockCode}:${item.credibilityScore} ${item.highlights[0] ?? ""}`.trim(),
              ),
            missingInfo:
              credibility.evidenceList.length === 0
                ? ["No external evidence was returned for credibility review."]
                : [],
          }),
          run: {
            unitId: unit.id,
            title: unit.title,
            capability: unit.capability,
            status: "completed",
            attempt: 1,
            repairCount: 0,
            validationErrors: [],
            qualityFlags:
              credibility.evidenceList.length === 0
                ? ["no_external_evidence"]
                : [],
            startedAt,
            completedAt: new Date().toISOString(),
            notes: [`Evidence count: ${credibility.evidenceList.length}`],
            sourceUrls: [],
            evidenceCount: credibility.evidenceList.length,
          },
        };
      }

      const competition = await this.intelligenceService.summarizeCompetition({
        query: unit.keyQuestions[0] || unit.objective,
        candidates: state.candidates ?? [],
        credibility: state.credibility ?? [],
      });
      return {
        patch: {
          competition,
        },
        note: buildNote({
          unit,
          summary: competition,
          keyFacts: [competition],
        }),
        run: {
          unitId: unit.id,
          title: unit.title,
          capability: unit.capability,
          status: "completed",
          attempt: 1,
          repairCount: 0,
          validationErrors: [],
          qualityFlags: state.credibility?.length
            ? []
            : ["no_credibility_context"],
          startedAt,
          completedAt: new Date().toISOString(),
          notes: [competition],
          sourceUrls: [],
          evidenceCount: state.credibility?.length ?? 0,
        },
      };
    } catch (error) {
      return {
        patch: {},
        note: buildNote({
          unit,
          summary: `Unit failed: ${error instanceof Error ? error.message : "unknown error"}`,
          keyFacts: [],
          missingInfo: [unit.objective],
        }),
        run: {
          unitId: unit.id,
          title: unit.title,
          capability: unit.capability,
          status: "failed",
          attempt: 1,
          repairCount: 0,
          validationErrors: [
            error instanceof Error ? error.message : "unknown error",
          ],
          qualityFlags: ["unit_failed"],
          startedAt,
          completedAt: new Date().toISOString(),
          notes: [],
          sourceUrls: [],
          evidenceCount: 0,
          error: error instanceof Error ? error.message : "unknown error",
        },
      };
    }
  }

  async executeUnits(params: {
    state: QuickResearchGraphState;
    runtimeConfig: ResearchRuntimeConfig;
    units: ResearchUnitPlan[];
  }) {
    let snapshot: QuickExecutionSnapshot = {
      industryOverview: params.state.industryOverview,
      news: params.state.news,
      heatAnalysis: params.state.heatAnalysis,
      candidates: params.state.candidates,
      credibility: params.state.credibility,
      evidenceList: params.state.evidenceList,
      competition: params.state.competition,
    };
    const unitRuns = [...(params.state.researchUnitRuns ?? [])];
    const notes = [...(params.state.researchNotes ?? [])];
    const completedUnitIds = new Set(unitRuns.map((run) => run.unitId));

    const pendingUnits = params.units.filter(
      (unit) => !completedUnitIds.has(unit.id),
    );
    while (pendingUnits.length > 0) {
      const readyUnits = pendingUnits.filter((unit) =>
        unit.dependsOn.every((dependencyId) =>
          completedUnitIds.has(dependencyId),
        ),
      );
      const batch =
        readyUnits.length > 0
          ? readyUnits.slice(0, params.runtimeConfig.maxConcurrentResearchUnits)
          : pendingUnits.slice(0, 1);

      const batchResults = await Promise.all(
        batch.map((unit) => this.executeUnit(unit, snapshot)),
      );

      for (const result of batchResults) {
        snapshot = {
          ...snapshot,
          ...result.patch,
        };
        notes.push(result.note);
        unitRuns.push(result.run);
        completedUnitIds.add(result.run.unitId);
      }

      for (const unit of batch) {
        const index = pendingUnits.findIndex((item) => item.id === unit.id);
        if (index >= 0) {
          pendingUnits.splice(index, 1);
        }
      }
    }

    return {
      ...snapshot,
      researchNotes: notes,
      researchUnitRuns: unitRuns,
      researchUnits: params.units,
    };
  }

  async runGapAnalysis(
    params: {
      state: QuickResearchGraphState;
      runtimeConfig: ResearchRuntimeConfig;
    },
    options?: QuickStructuredRequestOptions,
  ): Promise<{
    gapAnalysis: ResearchGapAnalysis;
    researchNotes: ResearchNote[];
    researchUnitRuns: ResearchUnitRun[];
    researchUnits: ResearchUnitPlan[];
    replanRecords: ResearchReplanRecord[];
    snapshot: QuickExecutionSnapshot;
  }> {
    let gapIteration = 0;
    let notes = [...(params.state.researchNotes ?? [])];
    let unitRuns = [...(params.state.researchUnitRuns ?? [])];
    let units = [...(params.state.researchUnits ?? [])];
    let replanRecords = [...(params.state.replanRecords ?? [])];
    let snapshot: QuickExecutionSnapshot = {
      industryOverview: params.state.industryOverview,
      news: params.state.news,
      heatAnalysis: params.state.heatAnalysis,
      candidates: params.state.candidates,
      credibility: params.state.credibility,
      evidenceList: params.state.evidenceList,
      competition: params.state.competition,
    };

    let gapAnalysis: ResearchGapAnalysis = {
      requiresFollowup: false,
      summary: "No gap analysis yet.",
      missingAreas: [],
      followupUnits: [],
      iteration: 0,
    };

    while (gapIteration <= params.runtimeConfig.maxGapIterations) {
      const brief =
        params.state.researchBrief ?? buildFallbackBrief(params.state);
      const compressed = await compressResearchFindings({
        client: this.client,
        brief,
        taskContract: resolveTaskContract(params.state),
        noteSummaries: notes.map((note) => note.summary),
        gapAnalysis,
        runtimeConfig: params.runtimeConfig,
        structuredModel: options?.structuredModel,
      });

      gapAnalysis = await analyzeResearchGaps({
        client: this.client,
        brief,
        taskContract: resolveTaskContract(params.state),
        compressedFindings: compressed,
        gapIteration,
        runtimeConfig: params.runtimeConfig,
        allowedCapabilities: QUICK_ALLOWED_CAPABILITIES,
        structuredModel: options?.structuredModel,
      });

      if (!gapAnalysis.requiresFollowup) {
        break;
      }

      units = [...units, ...gapAnalysis.followupUnits];
      replanRecords = [
        ...replanRecords,
        {
          replanId: `quick_gap_${gapIteration + 1}`,
          iteration: gapIteration + 1,
          triggerNodeKey: "agent4_credibility_and_competition",
          reason: "material_research_gap",
          missingAreas: gapAnalysis.missingAreas,
          action: "append_followup_units",
          fallbackCapability: gapAnalysis.followupUnits[0]?.capability,
          resultSummary: gapAnalysis.summary,
          createdAt: new Date().toISOString(),
        },
      ];
      const execution = await this.executeUnits({
        state: {
          ...params.state,
          industryOverview: snapshot.industryOverview,
          news: snapshot.news,
          heatAnalysis: snapshot.heatAnalysis,
          candidates: snapshot.candidates,
          credibility: snapshot.credibility,
          evidenceList: snapshot.evidenceList,
          competition: snapshot.competition,
          researchNotes: notes,
          researchUnitRuns: unitRuns,
        } as QuickResearchGraphState,
        runtimeConfig: params.runtimeConfig,
        units: gapAnalysis.followupUnits,
      });

      snapshot = {
        industryOverview: execution.industryOverview,
        news: execution.news,
        heatAnalysis: execution.heatAnalysis,
        candidates: execution.candidates,
        credibility: execution.credibility,
        evidenceList: execution.evidenceList,
        competition: execution.competition,
      };
      notes = execution.researchNotes ?? notes;
      unitRuns = execution.researchUnitRuns ?? unitRuns;
      gapIteration += 1;
    }

    return {
      gapAnalysis,
      researchNotes: notes,
      researchUnitRuns: unitRuns,
      researchUnits: units,
      replanRecords,
      snapshot,
    };
  }

  async compressFindings(
    state: QuickResearchGraphState,
    runtimeConfig: ResearchRuntimeConfig,
    gapAnalysis?: ResearchGapAnalysis,
    options?: QuickStructuredRequestOptions,
  ): Promise<CompressedFindings> {
    return compressResearchFindings({
      client: this.client,
      brief: state.researchBrief ?? buildFallbackBrief(state),
      taskContract: resolveTaskContract(state),
      noteSummaries: (state.researchNotes ?? []).map((note) => note.summary),
      gapAnalysis,
      runtimeConfig,
      structuredModel: options?.structuredModel,
    });
  }

  async finalizeReport(params: {
    state: QuickResearchGraphState;
    runtimeConfig: ResearchRuntimeConfig;
  }): Promise<QuickResearchResultDto> {
    const taskContract = resolveTaskContract(params.state);
    const overview =
      params.state.industryOverview ??
      (
        await this.intelligenceService.generateIndustryOverview(
          params.state.query,
        )
      ).overview;
    const heatAnalysis =
      params.state.heatAnalysis ??
      (await this.intelligenceService.analyzeMarketHeat(params.state.query));
    const candidates =
      params.state.candidates ??
      (await this.intelligenceService.screenCandidates(
        params.state.query,
        heatAnalysis.heatScore,
      ));
    const credibilityResult =
      params.state.credibility && params.state.evidenceList
        ? {
            credibility: params.state.credibility,
            evidenceList: params.state.evidenceList,
          }
        : await this.intelligenceService.evaluateCredibility(
            params.state.query,
            candidates,
          );
    const competition =
      params.state.competition ??
      (await this.intelligenceService.summarizeCompetition({
        query: params.state.query,
        candidates,
        credibility: credibilityResult.credibility,
      }));

    const confidenceAnalysis =
      await this.intelligenceService.analyzeQuickResearchOverall({
        query: params.state.query,
        overview,
        heatConclusion: heatAnalysis.heatConclusion,
        candidates,
        credibility: credibilityResult.credibility,
        competitionSummary: competition,
        news: params.state.news ?? [],
        evidenceList: credibilityResult.evidenceList,
      });

    const report = {
      ...this.intelligenceService.buildFinalReport({
        overview,
        heatScore: heatAnalysis.heatScore,
        heatConclusion: heatAnalysis.heatConclusion,
        candidates,
        credibility: credibilityResult.credibility,
        competitionSummary: competition,
        confidenceAnalysis,
      }),
      brief: params.state.researchBrief ?? buildFallbackBrief(params.state),
      clarificationRequest: params.state.clarificationRequest,
      researchPlan: params.state.researchUnits,
      researchUnitRuns: params.state.researchUnitRuns,
      researchNotes: params.state.researchNotes,
      compressedFindings: params.state.compressedFindings,
      gapAnalysis: params.state.gapAnalysis,
      replanRecords: params.state.replanRecords,
    } satisfies QuickResearchResultDto;
    const reflection = reflectQuickResearch({
      taskContract,
      result: report,
    });

    return {
      ...report,
      reflection,
      contractScore: reflection.contractScore,
      qualityFlags: reflection.qualityFlags,
      missingRequirements: reflection.missingRequirements,
      requestedDepth: params.state.requestedDepth,
      autoEscalated: params.state.autoEscalated,
      autoEscalationReason: params.state.autoEscalationReason ?? null,
      structuredModelInitial: params.state.structuredModelInitial,
      structuredModelFinal: params.state.structuredModelFinal,
    };
  }
}

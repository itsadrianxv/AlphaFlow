import { Annotation, StateGraph } from "@langchain/langgraph";
import type {
  CandidateCredibilityResult,
  IntelligenceAgentService,
} from "~/server/application/intelligence/intelligence-agent-service";
import type { QuickResearchWorkflowService } from "~/server/application/intelligence/quick-research-workflow-service";
import { WorkflowPauseError } from "~/server/domain/workflow/errors";
import type { ResearchPreferenceInput } from "~/server/domain/workflow/research";
import type {
  QuickResearchGraphState,
  QuickResearchInput,
  QuickResearchNodeKey,
  QuickResearchV2NodeKey,
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/server/domain/workflow/types";
import {
  QUICK_RESEARCH_NODE_KEYS,
  QUICK_RESEARCH_TEMPLATE_CODE,
  QUICK_RESEARCH_V2_NODE_KEYS,
  resolveResearchRuntimeConfig,
} from "~/server/domain/workflow/types";
import type { WorkflowGraphBuildInitialStateParams } from "~/server/infrastructure/workflow/langgraph/workflow-graph";
import { BaseWorkflowLangGraph } from "~/server/infrastructure/workflow/langgraph/workflow-graph-base";
import {
  addResumeStart,
  addSequentialEdges,
  addWorkflowNodes,
} from "~/server/infrastructure/workflow/langgraph/workflow-graph-builder";

const WorkflowState = Annotation.Root({
  runId: Annotation<string>,
  userId: Annotation<string>,
  query: Annotation<string>,
  progressPercent: Annotation<number>,
  resumeFromNodeKey: Annotation<WorkflowNodeKey | undefined>,
  currentNodeKey: Annotation<WorkflowNodeKey | undefined>,
  researchInput: Annotation<QuickResearchInput | undefined>,
  intent: Annotation<string | undefined>,
  clarificationRequest: Annotation<QuickResearchGraphState["clarificationRequest"]>,
  researchRuntimeConfig:
    Annotation<QuickResearchGraphState["researchRuntimeConfig"]>,
  researchBrief: Annotation<QuickResearchGraphState["researchBrief"]>,
  researchUnits: Annotation<QuickResearchGraphState["researchUnits"]>,
  researchUnitRuns: Annotation<QuickResearchGraphState["researchUnitRuns"]>,
  researchNotes: Annotation<QuickResearchGraphState["researchNotes"]>,
  compressedFindings:
    Annotation<QuickResearchGraphState["compressedFindings"]>,
  gapAnalysis: Annotation<QuickResearchGraphState["gapAnalysis"]>,
  industryOverview: Annotation<string | undefined>,
  news: Annotation<QuickResearchGraphState["news"]>,
  heatAnalysis: Annotation<QuickResearchGraphState["heatAnalysis"]>,
  candidates: Annotation<QuickResearchGraphState["candidates"]>,
  credibility: Annotation<QuickResearchGraphState["credibility"]>,
  evidenceList: Annotation<QuickResearchGraphState["evidenceList"]>,
  competition: Annotation<string | undefined>,
  finalReport: Annotation<QuickResearchGraphState["finalReport"]>,
  errors: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

type LegacyNodeExecutor = (
  state: QuickResearchGraphState,
) => Promise<Partial<QuickResearchGraphState>>;

function toResearchPreferences(
  input: Record<string, unknown>,
): ResearchPreferenceInput | undefined {
  const candidate = input.researchPreferences;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return undefined;
  }

  const record = candidate as Record<string, unknown>;
  return {
    researchGoal:
      typeof record.researchGoal === "string" ? record.researchGoal : undefined,
    mustAnswerQuestions: Array.isArray(record.mustAnswerQuestions)
      ? record.mustAnswerQuestions.filter(
          (item): item is string => typeof item === "string",
        )
      : undefined,
    forbiddenEvidenceTypes: Array.isArray(record.forbiddenEvidenceTypes)
      ? record.forbiddenEvidenceTypes.filter(
          (item): item is string => typeof item === "string",
        )
      : undefined,
    preferredSources: Array.isArray(record.preferredSources)
      ? record.preferredSources.filter(
          (item): item is string => typeof item === "string",
        )
      : undefined,
    freshnessWindowDays:
      typeof record.freshnessWindowDays === "number"
        ? record.freshnessWindowDays
        : undefined,
  };
}

function toResearchInput(input: Record<string, unknown>, query: string) {
  return {
    query:
      typeof input.query === "string" && input.query.trim().length > 0
        ? input.query.trim()
        : query,
    researchPreferences: toResearchPreferences(input),
  } satisfies QuickResearchInput;
}

abstract class QuickResearchLangGraphBase<
  NodeKey extends QuickResearchNodeKey | QuickResearchV2NodeKey,
> extends BaseWorkflowLangGraph<QuickResearchGraphState, NodeKey> {
  readonly templateCode = QUICK_RESEARCH_TEMPLATE_CODE;

  buildInitialState(
    params: WorkflowGraphBuildInitialStateParams,
  ): QuickResearchGraphState {
    const researchInput = toResearchInput(params.input, params.query);
    return {
      runId: params.runId,
      userId: params.userId,
      query: params.query,
      progressPercent: params.progressPercent,
      resumeFromNodeKey: undefined,
      currentNodeKey: undefined,
      researchInput,
      researchRuntimeConfig: resolveResearchRuntimeConfig(
        params.templateGraphConfig,
      ),
      errors: [],
    };
  }

  mergeNodeOutput(
    state: WorkflowGraphState,
    nodeKey: WorkflowNodeKey,
    output: Record<string, unknown>,
  ) {
    return {
      ...state,
      ...output,
      currentNodeKey: nodeKey,
      lastCompletedNodeKey: nodeKey,
    };
  }

  getRunResult(state: WorkflowGraphState): Record<string, unknown> {
    const quickState = state as QuickResearchGraphState;

    return (quickState.finalReport ?? {
      generatedAt: new Date().toISOString(),
    }) as Record<string, unknown>;
  }
}

export class QuickResearchLangGraph extends QuickResearchLangGraphBase<QuickResearchNodeKey> {
  readonly templateVersion = 1;

  constructor(intelligenceService: IntelligenceAgentService) {
    const nodeExecutors: Record<QuickResearchNodeKey, LegacyNodeExecutor> = {
      agent1_industry_overview: async (state) => {
        const { overview, news } =
          await intelligenceService.generateIndustryOverview(state.query);

        return {
          intent: state.query,
          industryOverview: overview,
          news,
        };
      },
      agent2_market_heat: async (state) => {
        const heatAnalysis = await intelligenceService.analyzeMarketHeat(
          state.query,
          state.news,
        );

        return {
          news: heatAnalysis.news,
          heatAnalysis: {
            heatScore: heatAnalysis.heatScore,
            heatConclusion: heatAnalysis.heatConclusion,
          },
        };
      },
      agent3_candidate_screening: async (state) => {
        const heatScore = state.heatAnalysis?.heatScore ?? 50;
        const candidates = await intelligenceService.screenCandidates(
          state.query,
          heatScore,
        );

        return {
          candidates,
        };
      },
      agent4_credibility_batch: async (state) => {
        const candidates = state.candidates ?? [];
        const result: CandidateCredibilityResult =
          await intelligenceService.evaluateCredibility(state.query, candidates);

        return {
          credibility: result.credibility,
          evidenceList: result.evidenceList,
        };
      },
      agent5_competition_summary: async (state) => {
        const competitionSummary =
          await intelligenceService.summarizeCompetition({
            query: state.query,
            candidates: state.candidates ?? [],
            credibility: state.credibility ?? [],
          });

        const confidenceAnalysis =
          await intelligenceService.analyzeQuickResearchOverall({
            query: state.query,
            overview: state.industryOverview ?? "No overview",
            heatConclusion:
              state.heatAnalysis?.heatConclusion ?? "No heat conclusion",
            candidates: state.candidates ?? [],
            credibility: state.credibility ?? [],
            competitionSummary,
            news: state.news ?? [],
            evidenceList: state.evidenceList ?? [],
          });

        const finalReport = intelligenceService.buildFinalReport({
          overview: state.industryOverview ?? "No overview",
          heatScore: state.heatAnalysis?.heatScore ?? 50,
          heatConclusion:
            state.heatAnalysis?.heatConclusion ?? "No heat conclusion",
          candidates: state.candidates ?? [],
          credibility: state.credibility ?? [],
          competitionSummary,
          confidenceAnalysis,
        });

        return {
          competition: competitionSummary,
          finalReport,
        };
      },
    };

    const graphBuilder = new StateGraph(WorkflowState) as StateGraph<
      unknown,
      QuickResearchGraphState,
      Partial<QuickResearchGraphState>,
      string
    >;
    addWorkflowNodes(graphBuilder, QUICK_RESEARCH_NODE_KEYS, nodeExecutors);
    addResumeStart(graphBuilder, QUICK_RESEARCH_NODE_KEYS);
    addSequentialEdges(graphBuilder, QUICK_RESEARCH_NODE_KEYS);

    super({
      graph: graphBuilder.compile(),
      nodeOrder: QUICK_RESEARCH_NODE_KEYS,
    });
  }

  getNodeOutput(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const quickState = state as QuickResearchGraphState;

    if (nodeKey === "agent1_industry_overview") {
      return {
        intent: quickState.intent,
        industryOverview: quickState.industryOverview,
        newsCount: quickState.news?.length ?? 0,
      };
    }

    if (nodeKey === "agent2_market_heat") {
      return {
        heatAnalysis: quickState.heatAnalysis,
      };
    }

    if (nodeKey === "agent3_candidate_screening") {
      return {
        candidates: quickState.candidates,
      };
    }

    if (nodeKey === "agent4_credibility_batch") {
      return {
        credibility: quickState.credibility,
      };
    }

    return {
      competition: quickState.competition,
      finalReport: quickState.finalReport,
    };
  }

  getNodeEventPayload(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const quickState = state as QuickResearchGraphState;

    if (nodeKey === "agent3_candidate_screening") {
      return {
        candidateCount: quickState.candidates?.length ?? 0,
      };
    }

    if (nodeKey === "agent4_credibility_batch") {
      return {
        credibilityCount: quickState.credibility?.length ?? 0,
      };
    }

    if (nodeKey === "agent5_competition_summary") {
      return {
        topPickCount: quickState.finalReport?.topPicks.length ?? 0,
        confidenceStatus:
          quickState.finalReport?.confidenceAnalysis?.status ?? "UNAVAILABLE",
      };
    }

    return {};
  }
}

export class QuickResearchODRLangGraph extends QuickResearchLangGraphBase<QuickResearchV2NodeKey> {
  readonly templateVersion = 2;

  constructor(workflowService: QuickResearchWorkflowService) {
    const nodeExecutors: Record<QuickResearchV2NodeKey, LegacyNodeExecutor> = {
      agent0_clarify_scope: async (state) => {
        const runtimeConfig = state.researchRuntimeConfig;
        if (!runtimeConfig || !state.researchInput) {
          return {};
        }

        const clarification = await workflowService.clarifyScope(
          state.researchInput,
          runtimeConfig,
        );

        if (clarification.needClarification) {
          throw new WorkflowPauseError(
            clarification.question,
            "clarification_required",
            {
              clarificationRequest: clarification,
              currentNodeKey: "agent0_clarify_scope",
            },
          );
        }

        return {
          clarificationRequest: clarification,
          intent: state.query,
        };
      },
      agent1_write_research_brief: async (state) => {
        if (!state.researchRuntimeConfig || !state.researchInput) {
          return {};
        }

        const researchBrief = await workflowService.buildBrief(
          state.researchInput,
          state.researchRuntimeConfig,
          state.clarificationRequest?.verification,
        );

        return {
          researchBrief,
          intent: researchBrief.researchGoal,
        };
      },
      agent2_plan_research_units: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        return {
          researchUnits: await workflowService.planUnits(
            state,
            state.researchRuntimeConfig,
          ),
        };
      },
      agent3_execute_research_units: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        return workflowService.executeUnits({
          state,
          runtimeConfig: state.researchRuntimeConfig,
          units: state.researchUnits ?? [],
        });
      },
      agent4_gap_analysis: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        return workflowService.runGapAnalysis({
          state,
          runtimeConfig: state.researchRuntimeConfig,
        });
      },
      agent5_compress_findings: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        return {
          compressedFindings: await workflowService.compressFindings(
            state,
            state.researchRuntimeConfig,
            state.gapAnalysis,
          ),
        };
      },
      agent6_finalize_report: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        return {
          finalReport: await workflowService.finalizeReport({
            state,
            runtimeConfig: state.researchRuntimeConfig,
          }),
        };
      },
    };

    const graphBuilder = new StateGraph(WorkflowState) as StateGraph<
      unknown,
      QuickResearchGraphState,
      Partial<QuickResearchGraphState>,
      string
    >;
    addWorkflowNodes(graphBuilder, QUICK_RESEARCH_V2_NODE_KEYS, nodeExecutors);
    addResumeStart(graphBuilder, QUICK_RESEARCH_V2_NODE_KEYS);
    addSequentialEdges(graphBuilder, QUICK_RESEARCH_V2_NODE_KEYS);

    super({
      graph: graphBuilder.compile(),
      nodeOrder: QUICK_RESEARCH_V2_NODE_KEYS,
    });
  }

  getNodeOutput(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const quickState = state as QuickResearchGraphState;

    if (nodeKey === "agent0_clarify_scope") {
      return {
        clarificationRequest: quickState.clarificationRequest,
      };
    }

    if (nodeKey === "agent1_write_research_brief") {
      return {
        researchBrief: quickState.researchBrief,
      };
    }

    if (nodeKey === "agent2_plan_research_units") {
      return {
        plannedUnitCount: quickState.researchUnits?.length ?? 0,
        researchUnits: quickState.researchUnits,
      };
    }

    if (nodeKey === "agent3_execute_research_units") {
      return {
        noteCount: quickState.researchNotes?.length ?? 0,
        unitRunCount: quickState.researchUnitRuns?.length ?? 0,
        candidateCount: quickState.candidates?.length ?? 0,
      };
    }

    if (nodeKey === "agent4_gap_analysis") {
      return {
        gapAnalysis: quickState.gapAnalysis,
      };
    }

    if (nodeKey === "agent5_compress_findings") {
      return {
        compressedFindings: quickState.compressedFindings,
      };
    }

    return {
      finalReport: quickState.finalReport,
    };
  }

  getNodeEventPayload(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const quickState = state as QuickResearchGraphState;

    if (nodeKey === "agent0_clarify_scope") {
      return {
        clarificationRequired:
          quickState.clarificationRequest?.needClarification ?? false,
        missingScopeFields:
          quickState.clarificationRequest?.missingScopeFields ?? [],
        question: quickState.clarificationRequest?.question,
        verification: quickState.clarificationRequest?.verification,
        suggestedInputPatch:
          quickState.clarificationRequest?.suggestedInputPatch ?? {},
      };
    }

    if (nodeKey === "agent2_plan_research_units") {
      return {
        plannedUnitCount: quickState.researchUnits?.length ?? 0,
      };
    }

    if (nodeKey === "agent3_execute_research_units") {
      return {
        noteCount: quickState.researchNotes?.length ?? 0,
        candidateCount: quickState.candidates?.length ?? 0,
      };
    }

    if (nodeKey === "agent4_gap_analysis") {
      return {
        requiresFollowup: quickState.gapAnalysis?.requiresFollowup ?? false,
        missingAreaCount: quickState.gapAnalysis?.missingAreas.length ?? 0,
      };
    }

    if (nodeKey === "agent6_finalize_report") {
      return {
        topPickCount: quickState.finalReport?.topPicks.length ?? 0,
        confidenceStatus:
          quickState.finalReport?.confidenceAnalysis?.status ?? "UNAVAILABLE",
      };
    }

    return {};
  }
}

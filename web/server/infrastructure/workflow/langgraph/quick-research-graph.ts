import { Annotation, StateGraph } from "@langchain/langgraph";
import type { QuickResearchWorkflowService } from "~/server/application/intelligence/quick-research-workflow-service";
import type { ResearchPreferenceInput } from "~/server/domain/workflow/research";
import { parseResearchTaskContract } from "~/server/domain/workflow/research";
import type {
  QuickResearchAutoEscalationReason,
  QuickResearchGraphState,
  QuickResearchInput,
  QuickResearchNodeKey,
  QuickResearchStructuredModel,
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/server/domain/workflow/types";
import {
  buildQuickResearchExecutionMetadata,
  QUICK_RESEARCH_NODE_KEYS,
  QUICK_RESEARCH_TEMPLATE_CODE,
  resolveQuickResearchStructuredModel,
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
  clarificationRequest: Annotation<
    QuickResearchGraphState["clarificationRequest"]
  >,
  taskContract: Annotation<QuickResearchGraphState["taskContract"]>,
  researchRuntimeConfig: Annotation<
    QuickResearchGraphState["researchRuntimeConfig"]
  >,
  researchBrief: Annotation<QuickResearchGraphState["researchBrief"]>,
  researchUnits: Annotation<QuickResearchGraphState["researchUnits"]>,
  researchUnitRuns: Annotation<QuickResearchGraphState["researchUnitRuns"]>,
  researchNotes: Annotation<QuickResearchGraphState["researchNotes"]>,
  compressedFindings: Annotation<QuickResearchGraphState["compressedFindings"]>,
  gapAnalysis: Annotation<QuickResearchGraphState["gapAnalysis"]>,
  replanRecords: Annotation<QuickResearchGraphState["replanRecords"]>,
  reflection: Annotation<QuickResearchGraphState["reflection"]>,
  contractScore: Annotation<QuickResearchGraphState["contractScore"]>,
  qualityFlags: Annotation<QuickResearchGraphState["qualityFlags"]>,
  missingRequirements: Annotation<
    QuickResearchGraphState["missingRequirements"]
  >,
  requestedDepth: Annotation<QuickResearchGraphState["requestedDepth"]>,
  autoEscalated: Annotation<QuickResearchGraphState["autoEscalated"]>,
  autoEscalationReason: Annotation<
    QuickResearchGraphState["autoEscalationReason"]
  >,
  structuredModelInitial: Annotation<
    QuickResearchGraphState["structuredModelInitial"]
  >,
  structuredModelFinal: Annotation<
    QuickResearchGraphState["structuredModelFinal"]
  >,
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

type QuickResearchNodeExecutor = (
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
    taskContract: parseResearchTaskContract(input.taskContract),
  } satisfies QuickResearchInput;
}

function selectUnitsByCapabilities(
  units: QuickResearchGraphState["researchUnits"],
  capabilities: string[],
) {
  return (units ?? []).filter((unit) => capabilities.includes(unit.capability));
}

function resolveCurrentStructuredModel(
  state: QuickResearchGraphState,
): QuickResearchStructuredModel {
  if (state.structuredModelFinal) {
    return state.structuredModelFinal;
  }

  if (state.structuredModelInitial) {
    return state.structuredModelInitial;
  }

  return resolveQuickResearchStructuredModel(
    state.requestedDepth ?? "standard",
  );
}

function buildEscalationMetadata(
  state: QuickResearchGraphState,
  reason: QuickResearchAutoEscalationReason,
) {
  return {
    requestedDepth: state.requestedDepth ?? "standard",
    autoEscalated: true,
    autoEscalationReason: reason,
    structuredModelInitial:
      state.structuredModelInitial ??
      resolveQuickResearchStructuredModel(state.requestedDepth ?? "standard"),
    structuredModelFinal: "deepseek-reasoner" as const,
  };
}

abstract class QuickResearchLangGraphBase extends BaseWorkflowLangGraph<
  QuickResearchGraphState,
  QuickResearchNodeKey
> {
  readonly templateCode = QUICK_RESEARCH_TEMPLATE_CODE;

  buildInitialState(
    params: WorkflowGraphBuildInitialStateParams,
  ): QuickResearchGraphState {
    const researchInput = toResearchInput(params.input, params.query);
    const executionMetadata = buildQuickResearchExecutionMetadata(
      researchInput.taskContract,
    );
    return {
      runId: params.runId,
      userId: params.userId,
      query: params.query,
      progressPercent: params.progressPercent,
      resumeFromNodeKey: undefined,
      currentNodeKey: undefined,
      researchInput,
      taskContract: researchInput.taskContract,
      researchRuntimeConfig: resolveResearchRuntimeConfig(
        params.templateGraphConfig,
      ),
      ...executionMetadata,
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

export class QuickResearchLangGraph extends QuickResearchLangGraphBase {
  readonly templateVersion = 3;

  constructor(workflowService: QuickResearchWorkflowService) {
    const nodeExecutors: Record<
      QuickResearchNodeKey,
      QuickResearchNodeExecutor
    > = {
      agent0_clarify_scope: async (state) => {
        const runtimeConfig = state.researchRuntimeConfig;
        if (!runtimeConfig || !state.researchInput) {
          return {};
        }

        const clarification = await workflowService.clarifyScope(
          state.researchInput,
          runtimeConfig,
        );

        return {
          clarificationRequest: clarification,
          intent: state.query,
        };
      },
      agent1_extract_research_spec: async (state) => {
        if (!state.researchRuntimeConfig || !state.researchInput) {
          return {};
        }

        const structuredModel = resolveCurrentStructuredModel(state);
        const taskContract = await workflowService.buildTaskContract(
          state.researchInput,
          state.researchRuntimeConfig,
          {
            structuredModel,
          },
        );
        const researchBrief = await workflowService.buildBrief(
          state.researchInput,
          state.researchRuntimeConfig,
          state.clarificationRequest?.verification,
          {
            structuredModel,
          },
        );
        const planningState = {
          ...state,
          taskContract,
          researchBrief,
        } as QuickResearchGraphState;
        const researchUnits = await workflowService.planUnits(
          planningState,
          state.researchRuntimeConfig,
          {
            structuredModel,
          },
        );

        return {
          taskContract,
          researchBrief,
          researchUnits,
          intent: researchBrief.researchGoal,
          requestedDepth: state.requestedDepth,
          autoEscalated: state.autoEscalated,
          autoEscalationReason: state.autoEscalationReason,
          structuredModelInitial: state.structuredModelInitial,
          structuredModelFinal: state.structuredModelFinal,
        };
      },
      agent2_trend_analysis: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        const execution = await workflowService.executeUnits({
          state,
          runtimeConfig: state.researchRuntimeConfig,
          units: selectUnitsByCapabilities(state.researchUnits, [
            "theme_overview",
            "market_heat",
          ]),
        });

        return {
          ...execution,
          researchUnits: state.researchUnits,
        };
      },
      agent3_candidate_screening: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        const execution = await workflowService.executeUnits({
          state,
          runtimeConfig: state.researchRuntimeConfig,
          units: selectUnitsByCapabilities(state.researchUnits, [
            "candidate_screening",
          ]),
        });

        return {
          ...execution,
          researchUnits: state.researchUnits,
        };
      },
      agent4_credibility_and_competition: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        const structuredModel = resolveCurrentStructuredModel(state);
        const execution = await workflowService.executeUnits({
          state,
          runtimeConfig: state.researchRuntimeConfig,
          units: selectUnitsByCapabilities(state.researchUnits, [
            "credibility_lookup",
            "competition_synthesis",
          ]),
        });
        const gapState = {
          ...state,
          ...execution,
          researchUnits: state.researchUnits,
        } as QuickResearchGraphState;
        let gapAnalysis = await workflowService.runGapAnalysis(
          {
            state: gapState,
            runtimeConfig: state.researchRuntimeConfig,
          },
          {
            structuredModel,
          },
        );

        if (!state.autoEscalated && gapAnalysis.gapAnalysis.requiresFollowup) {
          gapAnalysis = await workflowService.runGapAnalysis(
            {
              state: {
                ...gapState,
                ...gapAnalysis.snapshot,
                gapAnalysis: gapAnalysis.gapAnalysis,
                researchNotes: gapAnalysis.researchNotes,
                researchUnitRuns: gapAnalysis.researchUnitRuns,
                researchUnits: gapAnalysis.researchUnits,
                replanRecords: gapAnalysis.replanRecords,
              } as QuickResearchGraphState,
              runtimeConfig: state.researchRuntimeConfig,
            },
            {
              structuredModel: "deepseek-reasoner",
            },
          );

          return {
            ...execution,
            ...gapAnalysis.snapshot,
            gapAnalysis: gapAnalysis.gapAnalysis,
            researchNotes: gapAnalysis.researchNotes,
            researchUnitRuns: gapAnalysis.researchUnitRuns,
            researchUnits: gapAnalysis.researchUnits,
            replanRecords: gapAnalysis.replanRecords,
            ...buildEscalationMetadata(state, "gap_followup"),
          };
        }

        return {
          ...execution,
          ...gapAnalysis.snapshot,
          gapAnalysis: gapAnalysis.gapAnalysis,
          researchNotes: gapAnalysis.researchNotes,
          researchUnitRuns: gapAnalysis.researchUnitRuns,
          researchUnits: gapAnalysis.researchUnits,
          replanRecords: gapAnalysis.replanRecords,
          requestedDepth: state.requestedDepth,
          autoEscalated: state.autoEscalated,
          autoEscalationReason: state.autoEscalationReason,
          structuredModelInitial: state.structuredModelInitial,
          structuredModelFinal: state.structuredModelFinal ?? structuredModel,
        };
      },
      agent5_report_synthesis: async (state) => {
        if (!state.researchRuntimeConfig) {
          return {};
        }

        const structuredModel = resolveCurrentStructuredModel(state);
        let compressedFindings = await workflowService.compressFindings(
          state,
          state.researchRuntimeConfig,
          state.gapAnalysis,
          {
            structuredModel,
          },
        );
        let finalReport = await workflowService.finalizeReport({
          state: {
            ...state,
            compressedFindings,
          },
          runtimeConfig: state.researchRuntimeConfig,
        });

        if (!state.autoEscalated && finalReport.reflection?.status === "fail") {
          const escalatedGapAnalysis = await workflowService.runGapAnalysis(
            {
              state: {
                ...state,
                compressedFindings,
                finalReport,
              } as QuickResearchGraphState,
              runtimeConfig: state.researchRuntimeConfig,
            },
            {
              structuredModel: "deepseek-reasoner",
            },
          );
          const escalatedState = {
            ...state,
            ...escalatedGapAnalysis.snapshot,
            gapAnalysis: escalatedGapAnalysis.gapAnalysis,
            researchNotes: escalatedGapAnalysis.researchNotes,
            researchUnitRuns: escalatedGapAnalysis.researchUnitRuns,
            researchUnits: escalatedGapAnalysis.researchUnits,
            replanRecords: escalatedGapAnalysis.replanRecords,
            ...buildEscalationMetadata(state, "reflection_fail"),
          } as QuickResearchGraphState;

          compressedFindings = await workflowService.compressFindings(
            escalatedState,
            state.researchRuntimeConfig,
            escalatedState.gapAnalysis,
            {
              structuredModel: "deepseek-reasoner",
            },
          );
          finalReport = await workflowService.finalizeReport({
            state: {
              ...escalatedState,
              compressedFindings,
            },
            runtimeConfig: state.researchRuntimeConfig,
          });

          return {
            ...escalatedGapAnalysis.snapshot,
            gapAnalysis: escalatedGapAnalysis.gapAnalysis,
            researchNotes: escalatedGapAnalysis.researchNotes,
            researchUnitRuns: escalatedGapAnalysis.researchUnitRuns,
            researchUnits: escalatedGapAnalysis.researchUnits,
            replanRecords: escalatedGapAnalysis.replanRecords,
            compressedFindings,
            finalReport,
            ...buildEscalationMetadata(state, "reflection_fail"),
          };
        }

        return {
          compressedFindings,
          finalReport,
          requestedDepth: state.requestedDepth,
          autoEscalated: state.autoEscalated,
          autoEscalationReason: state.autoEscalationReason,
          structuredModelInitial: state.structuredModelInitial,
          structuredModelFinal: state.structuredModelFinal ?? structuredModel,
        };
      },
      agent6_reflection: async (state) => {
        return {
          reflection: state.finalReport?.reflection,
          contractScore: state.finalReport?.contractScore,
          qualityFlags: state.finalReport?.qualityFlags,
          missingRequirements: state.finalReport?.missingRequirements,
          requestedDepth:
            state.finalReport?.requestedDepth ?? state.requestedDepth,
          autoEscalated:
            state.finalReport?.autoEscalated ?? state.autoEscalated,
          autoEscalationReason:
            state.finalReport?.autoEscalationReason ??
            state.autoEscalationReason,
          structuredModelInitial:
            state.finalReport?.structuredModelInitial ??
            state.structuredModelInitial,
          structuredModelFinal:
            state.finalReport?.structuredModelFinal ??
            state.structuredModelFinal,
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

    if (nodeKey === "agent0_clarify_scope") {
      return {
        clarificationRequest: quickState.clarificationRequest,
      };
    }

    if (nodeKey === "agent1_extract_research_spec") {
      return {
        taskContract: quickState.taskContract,
        researchBrief: quickState.researchBrief,
        plannedUnitCount: quickState.researchUnits?.length ?? 0,
        requestedDepth: quickState.requestedDepth,
        structuredModelInitial: quickState.structuredModelInitial,
      };
    }

    if (nodeKey === "agent2_trend_analysis") {
      return {
        industryOverview: quickState.industryOverview,
        heatAnalysis: quickState.heatAnalysis,
      };
    }

    if (nodeKey === "agent3_candidate_screening") {
      return {
        candidateCount: quickState.candidates?.length ?? 0,
      };
    }

    if (nodeKey === "agent4_credibility_and_competition") {
      return {
        credibilityCount: quickState.credibility?.length ?? 0,
        gapAnalysis: quickState.gapAnalysis,
        replanCount: quickState.replanRecords?.length ?? 0,
        autoEscalated: quickState.autoEscalated,
        autoEscalationReason: quickState.autoEscalationReason,
        structuredModelFinal: quickState.structuredModelFinal,
      };
    }

    if (nodeKey === "agent5_report_synthesis") {
      return {
        compressedFindings: quickState.compressedFindings,
        finalReport: quickState.finalReport,
        autoEscalated: quickState.autoEscalated,
        autoEscalationReason: quickState.autoEscalationReason,
        structuredModelFinal: quickState.structuredModelFinal,
      };
    }

    return {
      reflection: quickState.reflection,
      contractScore: quickState.contractScore,
      qualityFlags: quickState.qualityFlags,
      missingRequirements: quickState.missingRequirements,
      autoEscalated: quickState.autoEscalated,
      autoEscalationReason: quickState.autoEscalationReason,
      structuredModelFinal: quickState.structuredModelFinal,
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

    if (nodeKey === "agent1_extract_research_spec") {
      return {
        plannedUnitCount: quickState.researchUnits?.length ?? 0,
        analysisDepth: quickState.taskContract?.analysisDepth ?? "standard",
        structuredModelInitial: quickState.structuredModelInitial,
      };
    }

    if (nodeKey === "agent2_trend_analysis") {
      return {
        heatScore: quickState.heatAnalysis?.heatScore ?? null,
      };
    }

    if (nodeKey === "agent3_candidate_screening") {
      return {
        candidateCount: quickState.candidates?.length ?? 0,
      };
    }

    if (nodeKey === "agent4_credibility_and_competition") {
      return {
        credibilityCount: quickState.credibility?.length ?? 0,
        requiresFollowup: quickState.gapAnalysis?.requiresFollowup ?? false,
        replanCount: quickState.replanRecords?.length ?? 0,
        autoEscalated: quickState.autoEscalated ?? false,
        autoEscalationReason: quickState.autoEscalationReason ?? null,
        structuredModelFinal: quickState.structuredModelFinal,
      };
    }

    if (nodeKey === "agent6_reflection") {
      return {
        contractScore: quickState.contractScore ?? null,
        qualityFlags: quickState.qualityFlags ?? [],
        autoEscalated: quickState.autoEscalated ?? false,
        autoEscalationReason: quickState.autoEscalationReason ?? null,
        structuredModelFinal: quickState.structuredModelFinal,
      };
    }

    return {};
  }
}

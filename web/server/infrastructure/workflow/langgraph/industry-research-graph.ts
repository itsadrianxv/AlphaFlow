import { Annotation, StateGraph } from "@langchain/langgraph";
import type { IndustryResearchWorkflowService } from "~/server/application/intelligence/industry-research-workflow-service";
import type { ResearchPreferenceInput } from "~/server/domain/workflow/research";
import { parseResearchTaskContract } from "~/server/domain/workflow/research";
import type {
  IndustryResearchAutoEscalationReason,
  IndustryResearchGraphState,
  IndustryResearchInput,
  IndustryResearchNodeKey,
  IndustryResearchStructuredModel,
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/server/domain/workflow/types";
import {
  buildIndustryResearchExecutionMetadata,
  INDUSTRY_RESEARCH_NODE_KEYS,
  INDUSTRY_RESEARCH_TEMPLATE_CODE,
  resolveIndustryResearchStructuredModel,
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
  researchInput: Annotation<IndustryResearchInput | undefined>,
  intent: Annotation<string | undefined>,
  clarificationRequest: Annotation<
    IndustryResearchGraphState["clarificationRequest"]
  >,
  taskContract: Annotation<IndustryResearchGraphState["taskContract"]>,
  researchRuntimeConfig: Annotation<
    IndustryResearchGraphState["researchRuntimeConfig"]
  >,
  researchBrief: Annotation<IndustryResearchGraphState["researchBrief"]>,
  researchUnits: Annotation<IndustryResearchGraphState["researchUnits"]>,
  researchUnitRuns: Annotation<IndustryResearchGraphState["researchUnitRuns"]>,
  researchNotes: Annotation<IndustryResearchGraphState["researchNotes"]>,
  compressedFindings: Annotation<IndustryResearchGraphState["compressedFindings"]>,
  gapAnalysis: Annotation<IndustryResearchGraphState["gapAnalysis"]>,
  replanRecords: Annotation<IndustryResearchGraphState["replanRecords"]>,
  reflection: Annotation<IndustryResearchGraphState["reflection"]>,
  contractScore: Annotation<IndustryResearchGraphState["contractScore"]>,
  qualityFlags: Annotation<IndustryResearchGraphState["qualityFlags"]>,
  missingRequirements: Annotation<
    IndustryResearchGraphState["missingRequirements"]
  >,
  requestedDepth: Annotation<IndustryResearchGraphState["requestedDepth"]>,
  autoEscalated: Annotation<IndustryResearchGraphState["autoEscalated"]>,
  autoEscalationReason: Annotation<
    IndustryResearchGraphState["autoEscalationReason"]
  >,
  structuredModelInitial: Annotation<
    IndustryResearchGraphState["structuredModelInitial"]
  >,
  structuredModelFinal: Annotation<
    IndustryResearchGraphState["structuredModelFinal"]
  >,
  industryOverview: Annotation<string | undefined>,
  news: Annotation<IndustryResearchGraphState["news"]>,
  heatAnalysis: Annotation<IndustryResearchGraphState["heatAnalysis"]>,
  candidates: Annotation<IndustryResearchGraphState["candidates"]>,
  credibility: Annotation<IndustryResearchGraphState["credibility"]>,
  evidenceList: Annotation<IndustryResearchGraphState["evidenceList"]>,
  competition: Annotation<string | undefined>,
  finalReport: Annotation<IndustryResearchGraphState["finalReport"]>,
  errors: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

type IndustryResearchNodeExecutor = (
  state: IndustryResearchGraphState,
) => Promise<Partial<IndustryResearchGraphState>>;

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
  } satisfies IndustryResearchInput;
}

function selectUnitsByCapabilities(
  units: IndustryResearchGraphState["researchUnits"],
  capabilities: string[],
) {
  return (units ?? []).filter((unit) => capabilities.includes(unit.capability));
}

function resolveCurrentStructuredModel(
  state: IndustryResearchGraphState,
): IndustryResearchStructuredModel {
  if (state.structuredModelFinal) {
    return state.structuredModelFinal;
  }

  if (state.structuredModelInitial) {
    return state.structuredModelInitial;
  }

  return resolveIndustryResearchStructuredModel(
    state.requestedDepth ?? "standard",
  );
}

function buildEscalationMetadata(
  state: IndustryResearchGraphState,
  reason: IndustryResearchAutoEscalationReason,
) {
  return {
    requestedDepth: state.requestedDepth ?? "standard",
    autoEscalated: true,
    autoEscalationReason: reason,
    structuredModelInitial:
      state.structuredModelInitial ??
      resolveIndustryResearchStructuredModel(state.requestedDepth ?? "standard"),
    structuredModelFinal: "deepseek-reasoner" as const,
  };
}

abstract class IndustryResearchLangGraphBase extends BaseWorkflowLangGraph<
  IndustryResearchGraphState,
  IndustryResearchNodeKey
> {
  readonly templateCode = INDUSTRY_RESEARCH_TEMPLATE_CODE;

  buildInitialState(
    params: WorkflowGraphBuildInitialStateParams,
  ): IndustryResearchGraphState {
    const researchInput = toResearchInput(params.input, params.query);
    const executionMetadata = buildIndustryResearchExecutionMetadata(
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
    const industryState = state as IndustryResearchGraphState;

    return (industryState.finalReport ?? {
      generatedAt: new Date().toISOString(),
    }) as Record<string, unknown>;
  }
}

export class IndustryResearchLangGraph extends IndustryResearchLangGraphBase {
  readonly templateVersion = 3;

  constructor(workflowService: IndustryResearchWorkflowService) {
    const nodeExecutors: Record<
      IndustryResearchNodeKey,
      IndustryResearchNodeExecutor
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
        } as IndustryResearchGraphState;
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
        } as IndustryResearchGraphState;
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
              } as IndustryResearchGraphState,
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
              } as IndustryResearchGraphState,
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
          } as IndustryResearchGraphState;

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
      IndustryResearchGraphState,
      Partial<IndustryResearchGraphState>,
      string
    >;
    addWorkflowNodes(graphBuilder, INDUSTRY_RESEARCH_NODE_KEYS, nodeExecutors);
    addResumeStart(graphBuilder, INDUSTRY_RESEARCH_NODE_KEYS);
    addSequentialEdges(graphBuilder, INDUSTRY_RESEARCH_NODE_KEYS);

    super({
      graph: graphBuilder.compile(),
      nodeOrder: INDUSTRY_RESEARCH_NODE_KEYS,
    });
  }

  getNodeOutput(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const industryState = state as IndustryResearchGraphState;

    if (nodeKey === "agent0_clarify_scope") {
      return {
        clarificationRequest: industryState.clarificationRequest,
      };
    }

    if (nodeKey === "agent1_extract_research_spec") {
      return {
        taskContract: industryState.taskContract,
        researchBrief: industryState.researchBrief,
        plannedUnitCount: industryState.researchUnits?.length ?? 0,
        requestedDepth: industryState.requestedDepth,
        structuredModelInitial: industryState.structuredModelInitial,
      };
    }

    if (nodeKey === "agent2_trend_analysis") {
      return {
        industryOverview: industryState.industryOverview,
        heatAnalysis: industryState.heatAnalysis,
      };
    }

    if (nodeKey === "agent3_candidate_screening") {
      return {
        candidateCount: industryState.candidates?.length ?? 0,
      };
    }

    if (nodeKey === "agent4_credibility_and_competition") {
      return {
        credibilityCount: industryState.credibility?.length ?? 0,
        gapAnalysis: industryState.gapAnalysis,
        replanCount: industryState.replanRecords?.length ?? 0,
        autoEscalated: industryState.autoEscalated,
        autoEscalationReason: industryState.autoEscalationReason,
        structuredModelFinal: industryState.structuredModelFinal,
      };
    }

    if (nodeKey === "agent5_report_synthesis") {
      return {
        compressedFindings: industryState.compressedFindings,
        finalReport: industryState.finalReport,
        autoEscalated: industryState.autoEscalated,
        autoEscalationReason: industryState.autoEscalationReason,
        structuredModelFinal: industryState.structuredModelFinal,
      };
    }

    return {
      reflection: industryState.reflection,
      contractScore: industryState.contractScore,
      qualityFlags: industryState.qualityFlags,
      missingRequirements: industryState.missingRequirements,
      autoEscalated: industryState.autoEscalated,
      autoEscalationReason: industryState.autoEscalationReason,
      structuredModelFinal: industryState.structuredModelFinal,
    };
  }

  getNodeEventPayload(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const industryState = state as IndustryResearchGraphState;

    if (nodeKey === "agent0_clarify_scope") {
      return {
        clarificationRequired:
          industryState.clarificationRequest?.needClarification ?? false,
        missingScopeFields:
          industryState.clarificationRequest?.missingScopeFields ?? [],
        question: industryState.clarificationRequest?.question,
        verification: industryState.clarificationRequest?.verification,
        suggestedInputPatch:
          industryState.clarificationRequest?.suggestedInputPatch ?? {},
      };
    }

    if (nodeKey === "agent1_extract_research_spec") {
      return {
        plannedUnitCount: industryState.researchUnits?.length ?? 0,
        analysisDepth: industryState.taskContract?.analysisDepth ?? "standard",
        structuredModelInitial: industryState.structuredModelInitial,
      };
    }

    if (nodeKey === "agent2_trend_analysis") {
      return {
        heatScore: industryState.heatAnalysis?.heatScore ?? null,
      };
    }

    if (nodeKey === "agent3_candidate_screening") {
      return {
        candidateCount: industryState.candidates?.length ?? 0,
      };
    }

    if (nodeKey === "agent4_credibility_and_competition") {
      return {
        credibilityCount: industryState.credibility?.length ?? 0,
        requiresFollowup: industryState.gapAnalysis?.requiresFollowup ?? false,
        replanCount: industryState.replanRecords?.length ?? 0,
        autoEscalated: industryState.autoEscalated ?? false,
        autoEscalationReason: industryState.autoEscalationReason ?? null,
        structuredModelFinal: industryState.structuredModelFinal,
      };
    }

    if (nodeKey === "agent6_reflection") {
      return {
        contractScore: industryState.contractScore ?? null,
        qualityFlags: industryState.qualityFlags ?? [],
        autoEscalated: industryState.autoEscalated ?? false,
        autoEscalationReason: industryState.autoEscalationReason ?? null,
        structuredModelFinal: industryState.structuredModelFinal,
      };
    }

    return {};
  }
}

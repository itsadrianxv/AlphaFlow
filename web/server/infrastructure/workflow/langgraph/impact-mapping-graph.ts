import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { ImpactMappingService, ImpactCollectedEvidence, PersistedImpactEvidence } from "~/server/application/intelligence/impact-mapping-service";
import {
  impactMappingInputSchema,
  type ImpactContext,
  type ImpactEdge,
  type ImpactMappingInput,
  type ImpactMappingResult,
  type ImpactRadarEvent,
  type ImpactScenario,
  type ImpactTimelineItem,
} from "~/server/domain/intelligence/impact-mapping";
import {
  IMPACT_MAPPING_NODE_KEYS,
  IMPACT_MAPPING_TEMPLATE_CODE,
  type ImpactMappingNodeKey,
  type WorkflowGraphState,
  type WorkflowNodeKey,
} from "~/server/domain/workflow/types";
import type { WorkflowGraphBuildInitialStateParams } from "~/server/infrastructure/workflow/langgraph/workflow-graph";
import { BaseWorkflowLangGraph } from "~/server/infrastructure/workflow/langgraph/workflow-graph-base";
import {
  addResumeStart,
  addWorkflowNodes,
} from "~/server/infrastructure/workflow/langgraph/workflow-graph-builder";

type ImpactMappingGraphState = WorkflowGraphState & {
  impactInput: ImpactMappingInput;
  context?: ImpactContext;
  collected?: ImpactCollectedEvidence;
  persisted?: PersistedImpactEvidence;
  radarEvents: ImpactRadarEvent[];
  impactEdges: ImpactEdge[];
  timeline: ImpactTimelineItem[];
  scenarios: ImpactScenario[];
  citations: ImpactMappingResult["evidenceCitations"];
  warnings: string[];
  finalResult?: ImpactMappingResult;
};

const WorkflowState = Annotation.Root({
  runId: Annotation<string>,
  userId: Annotation<string>,
  query: Annotation<string>,
  progressPercent: Annotation<number>,
  resumeFromNodeKey: Annotation<WorkflowNodeKey | undefined>,
  currentNodeKey: Annotation<WorkflowNodeKey | undefined>,
  impactInput: Annotation<ImpactMappingInput>,
  context: Annotation<ImpactContext | undefined>,
  collected: Annotation<ImpactCollectedEvidence | undefined>,
  persisted: Annotation<PersistedImpactEvidence | undefined>,
  radarEvents: Annotation<ImpactRadarEvent[]>,
  impactEdges: Annotation<ImpactEdge[]>,
  timeline: Annotation<ImpactTimelineItem[]>,
  scenarios: Annotation<ImpactScenario[]>,
  citations: Annotation<ImpactMappingResult["evidenceCitations"]>,
  warnings: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  finalResult: Annotation<ImpactMappingResult | undefined>,
  errors: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

export class ImpactMappingLangGraph extends BaseWorkflowLangGraph<
  ImpactMappingGraphState,
  ImpactMappingNodeKey
> {
  readonly templateCode = IMPACT_MAPPING_TEMPLATE_CODE;
  readonly templateVersion = 1;

  constructor(private readonly service: ImpactMappingService) {
    const executors: Record<
      ImpactMappingNodeKey,
      (state: ImpactMappingGraphState) => Promise<Partial<ImpactMappingGraphState>>
    > = {
      load_impact_context: async (state) => ({
        context: await service.loadContext(state.userId, state.impactInput),
      }),
      collect_impact_evidence: async (state) => {
        if (!state.context) throw new Error("影响映射上下文尚未载入");
        const collected = await service.collectEvidence({
          userId: state.userId,
          input: state.impactInput,
          context: state.context,
        });
        return { collected, warnings: collected.warnings };
      },
      persist_impact_observations: async (state) => {
        if (!state.collected) throw new Error("影响映射新闻证据尚未采集");
        return {
          persisted: await service.persistObservations({
            userId: state.userId,
            runId: state.runId,
            collected: state.collected,
          }),
        };
      },
      map_impact_layers: async (state) => {
        if (!state.context || !state.collected || !state.persisted) {
          throw new Error("影响映射前置数据不完整");
        }
        if (state.impactInput.mode === "radar") {
          const radarEvents = service.buildRadarEvents({
            context: state.context,
            collected: state.collected,
            persisted: state.persisted,
          });
          return {
            radarEvents,
            impactEdges: radarEvents.flatMap((item) => item.impactEdges),
          };
        }
        const mapped = await service.mapDeepImpacts({
          userId: state.userId,
          runId: state.runId,
          context: state.context,
          collected: state.collected,
          persisted: state.persisted,
        });
        return { impactEdges: mapped.edges, warnings: mapped.warnings };
      },
      build_impact_timeline: async (state) => {
        if (!state.collected || !state.persisted) {
          throw new Error("时间线证据不完整");
        }
        return {
          timeline: service.buildTimeline({
            collected: state.collected,
            persisted: state.persisted,
          }),
        };
      },
      forecast_impact_scenarios: async (state) => {
        if (!state.context || !state.collected || !state.persisted) {
          throw new Error("未来分支前置数据不完整");
        }
        const forecast = await service.forecastScenarios({
          userId: state.userId,
          runId: state.runId,
          context: state.context,
          collected: state.collected,
          persisted: state.persisted,
          edges: state.impactEdges,
        });
        return { scenarios: forecast.scenarios, warnings: forecast.warnings };
      },
      persist_impact_analysis: async (state) => {
        if (!state.context || !state.collected || !state.persisted) {
          throw new Error("影响映射结果不完整");
        }
        const citations = await service.persistDerived({
          userId: state.userId,
          runId: state.runId,
          persisted: state.persisted,
          edges: state.impactEdges,
          scenarios: state.scenarios,
        });
        return {
          citations,
          finalResult: service.buildResult({
            input: state.impactInput,
            context: state.context,
            collected: state.collected,
            radarEvents: state.radarEvents,
            edges: state.impactEdges,
            timeline: state.timeline,
            scenarios: state.scenarios,
            citations,
            warnings: state.warnings,
          }),
        };
      },
    };

    const graph = new StateGraph(WorkflowState) as StateGraph<
      unknown,
      ImpactMappingGraphState,
      Partial<ImpactMappingGraphState>,
      string
    >;
    addWorkflowNodes(graph, IMPACT_MAPPING_NODE_KEYS, executors);
    addResumeStart(graph, IMPACT_MAPPING_NODE_KEYS);
    graph.addEdge("load_impact_context", "collect_impact_evidence");
    graph.addEdge("collect_impact_evidence", "persist_impact_observations");
    graph.addEdge("persist_impact_observations", "map_impact_layers");
    graph.addConditionalEdges("map_impact_layers", (state) =>
      state.impactInput.mode === "radar"
        ? "persist_impact_analysis"
        : "build_impact_timeline",
    );
    graph.addEdge("build_impact_timeline", "forecast_impact_scenarios");
    graph.addEdge("forecast_impact_scenarios", "persist_impact_analysis");
    graph.addEdge("persist_impact_analysis", END);

    super({ graph: graph.compile(), nodeOrder: IMPACT_MAPPING_NODE_KEYS });
  }

  buildInitialState(params: WorkflowGraphBuildInitialStateParams): ImpactMappingGraphState {
    return {
      runId: params.runId,
      userId: params.userId,
      query: params.query,
      progressPercent: params.progressPercent,
      impactInput: impactMappingInputSchema.parse(params.input),
      radarEvents: [],
      impactEdges: [],
      timeline: [],
      scenarios: [],
      citations: [],
      warnings: [],
      errors: [],
    };
  }

  getNodeOutput(
    _nodeKey: WorkflowNodeKey,
    state: WorkflowGraphState,
  ): Record<string, unknown> {
    const impactState = state as ImpactMappingGraphState;
    return {
      eventCount: impactState.collected?.news.length ?? 0,
      impactEdgeCount: impactState.impactEdges.length,
      timelineCount: impactState.timeline.length,
      scenarioCount: impactState.scenarios.length,
      analysisStatus: impactState.finalResult?.analysisStatus,
    };
  }

  getNodeEventPayload(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    return { nodeKey, ...this.getNodeOutput(nodeKey, state) };
  }

  mergeNodeOutput(
    state: WorkflowGraphState,
    _nodeKey: WorkflowNodeKey,
    output: Record<string, unknown>,
  ): WorkflowGraphState {
    return { ...state, ...output };
  }

  getRunResult(state: WorkflowGraphState): Record<string, unknown> {
    return ((state as ImpactMappingGraphState).finalResult ?? {}) as Record<
      string,
      unknown
    >;
  }

  protected getSkippedNodes(
    nodeKey: ImpactMappingNodeKey,
    state: ImpactMappingGraphState,
  ) {
    if (nodeKey === "map_impact_layers" && state.impactInput.mode === "radar") {
      return [
        { nodeKey: "build_impact_timeline" as const, reason: "雷达模式不生成深度时间线" },
        { nodeKey: "forecast_impact_scenarios" as const, reason: "雷达模式不生成未来分支" },
      ];
    }
    return [];
  }

  protected getNodeProgressPayload(nodeKey: ImpactMappingNodeKey) {
    const labels: Record<ImpactMappingNodeKey, string> = {
      load_impact_context: "正在载入组合、自选与投资假设",
      collect_impact_evidence: "正在采集新闻与关系证据",
      persist_impact_observations: "正在固化原始证据与来源",
      map_impact_layers: "正在识别一至三级、宏观和组合影响",
      build_impact_timeline: "正在追溯事件时间线",
      forecast_impact_scenarios: "正在生成未来可能走向",
      persist_impact_analysis: "正在保存影响图和证据谱系",
    };
    return { message: labels[nodeKey] };
  }
}

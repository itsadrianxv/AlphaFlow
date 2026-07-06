import { Annotation, StateGraph } from "@langchain/langgraph";
import type { TimingAnalysisService } from "~/server/application/timing/timing-analysis-service";
import { resolveTimingPresetConfig } from "~/server/domain/timing/preset";
import type {
  TimingSignalPipelineGraphState,
  TimingSignalPipelineInput,
  TimingSignalPipelineNodeKey,
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/server/domain/workflow/types";
import {
  TIMING_SIGNAL_PIPELINE_NODE_KEYS,
  TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
} from "~/server/domain/workflow/types";
import type { PrismaTimingAnalysisCardRepository } from "~/server/infrastructure/timing/prisma-timing-analysis-card-repository";
import type { PrismaTimingPresetRepository } from "~/server/infrastructure/timing/prisma-timing-preset-repository";
import type { PrismaTimingSignalSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-signal-snapshot-repository";
import type { PythonTimingDataClient } from "~/server/infrastructure/timing/python-timing-data-client";
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
  currentNodeKey: Annotation<TimingSignalPipelineNodeKey | undefined>,
  timingInput: Annotation<TimingSignalPipelineInput>,
  preset: Annotation<TimingSignalPipelineGraphState["preset"]>,
  presetConfig: Annotation<TimingSignalPipelineGraphState["presetConfig"]>,
  targets: Annotation<TimingSignalPipelineGraphState["targets"]>,
  signalSnapshots: Annotation<
    TimingSignalPipelineGraphState["signalSnapshots"]
  >,
  technicalAssessments: Annotation<
    TimingSignalPipelineGraphState["technicalAssessments"]
  >,
  cards: Annotation<TimingSignalPipelineGraphState["cards"]>,
  persistedSignalSnapshots: Annotation<
    TimingSignalPipelineGraphState["persistedSignalSnapshots"]
  >,
  persistedCards: Annotation<TimingSignalPipelineGraphState["persistedCards"]>,
  batchErrors: Annotation<TimingSignalPipelineGraphState["batchErrors"]>,
  errors: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

type NodeExecutor = (
  state: TimingSignalPipelineGraphState,
) => Promise<Partial<TimingSignalPipelineGraphState>>;

export class TimingSignalPipelineLangGraph extends BaseWorkflowLangGraph<
  TimingSignalPipelineGraphState,
  TimingSignalPipelineNodeKey
> {
  readonly templateCode = TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE;
  readonly templateVersion = 1;

  constructor(deps: {
    timingDataClient: PythonTimingDataClient;
    analysisService: TimingAnalysisService;
    presetRepository: PrismaTimingPresetRepository;
    signalSnapshotRepository: PrismaTimingSignalSnapshotRepository;
    analysisCardRepository: PrismaTimingAnalysisCardRepository;
  }) {
    const nodeExecutors: Record<TimingSignalPipelineNodeKey, NodeExecutor> = {
      load_targets: async (state) => {
        const preset = state.timingInput.presetId
          ? await deps.presetRepository.getByIdForUser(
              state.userId,
              state.timingInput.presetId,
            )
          : null;

        return {
          preset: preset ?? undefined,
          presetConfig: resolveTimingPresetConfig(preset?.config),
          targets: [
            {
              stockCode: state.timingInput.stockCode,
            },
          ],
        };
      },
      fetch_signal_snapshots: async (state) => {
        const snapshot = await deps.timingDataClient.getSignal({
          stockCode: state.timingInput.stockCode,
          asOfDate: state.timingInput.asOfDate,
          includeBars: true,
        });

        return {
          signalSnapshots: [snapshot],
          batchErrors: [],
        };
      },
      technical_signal_agent: async (state) => ({
        technicalAssessments: deps.analysisService.buildTechnicalAssessments(
          state.signalSnapshots,
          state.presetConfig,
        ),
      }),
      timing_synthesis_agent: async (state) => ({
        cards: deps.analysisService.buildCards({
          userId: state.userId,
          workflowRunId: state.runId,
          sourceType: "single",
          sourceId: state.timingInput.stockCode,
          presetId: state.preset?.id,
          presetConfig: state.presetConfig,
          signalSnapshots: state.signalSnapshots,
          technicalAssessments: state.technicalAssessments,
        }),
      }),
      persist_cards: async (state) => {
        const persistedSignalSnapshots =
          await deps.signalSnapshotRepository.createMany({
            userId: state.userId,
            workflowRunId: state.runId,
            sourceType: "single",
            sourceId: state.timingInput.stockCode,
            items: state.signalSnapshots,
          });

        const snapshotByCode = new Map(
          persistedSignalSnapshots.map((snapshot) => [
            snapshot.stockCode,
            snapshot.id,
          ]),
        );

        const persistedCards = await deps.analysisCardRepository.createMany({
          items: state.cards.map((card) => ({
            ...card,
            signalSnapshotId: snapshotByCode.get(card.stockCode) ?? "",
          })),
        });

        return {
          persistedSignalSnapshots,
          persistedCards,
        };
      },
    };

    const graphBuilder = new StateGraph(WorkflowState) as StateGraph<
      unknown,
      TimingSignalPipelineGraphState,
      Partial<TimingSignalPipelineGraphState>,
      string
    >;
    addWorkflowNodes(
      graphBuilder,
      TIMING_SIGNAL_PIPELINE_NODE_KEYS,
      nodeExecutors,
    );
    addResumeStart(graphBuilder, TIMING_SIGNAL_PIPELINE_NODE_KEYS);
    addSequentialEdges(graphBuilder, TIMING_SIGNAL_PIPELINE_NODE_KEYS);

    super({
      graph: graphBuilder.compile(),
      nodeOrder: TIMING_SIGNAL_PIPELINE_NODE_KEYS,
    });
  }

  buildInitialState(
    params: WorkflowGraphBuildInitialStateParams,
  ): TimingSignalPipelineGraphState {
    return {
      runId: params.runId,
      userId: params.userId,
      query: params.query,
      progressPercent: params.progressPercent,
      resumeFromNodeKey: undefined,
      currentNodeKey: undefined,
      lastCompletedNodeKey: undefined,
      timingInput: params.input as TimingSignalPipelineInput,
      preset: undefined,
      presetConfig: undefined,
      targets: [],
      signalSnapshots: [],
      technicalAssessments: [],
      cards: [],
      persistedSignalSnapshots: [],
      persistedCards: [],
      batchErrors: [],
      errors: [],
    };
  }

  getNodeOutput(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const timingState = state as TimingSignalPipelineGraphState;

    switch (nodeKey) {
      case "load_targets":
        return { targets: timingState.targets };
      case "fetch_signal_snapshots":
        return { signalSnapshots: timingState.signalSnapshots };
      case "technical_signal_agent":
        return { technicalAssessments: timingState.technicalAssessments };
      case "timing_synthesis_agent":
        return { cards: timingState.cards };
      default:
        return {
          persistedSignalSnapshots: timingState.persistedSignalSnapshots,
          persistedCards: timingState.persistedCards,
        };
    }
  }

  getNodeEventPayload(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const timingState = state as TimingSignalPipelineGraphState;

    if (nodeKey === "fetch_signal_snapshots") {
      return {
        signalSnapshotCount: timingState.signalSnapshots.length,
      };
    }

    if (nodeKey === "persist_cards") {
      return {
        cardCount: timingState.persistedCards.length,
      };
    }

    return {};
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
    const timingState = state as TimingSignalPipelineGraphState;

    return {
      signalSnapshotIds: timingState.persistedSignalSnapshots.map(
        (snapshot) => snapshot.id,
      ),
      cardIds: timingState.persistedCards.map((card) => card.id),
      stockCount: timingState.persistedCards.length,
    };
  }
}

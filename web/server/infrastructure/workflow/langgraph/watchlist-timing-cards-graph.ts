import { Annotation, StateGraph } from "@langchain/langgraph";
import type { TimingAnalysisService } from "~/server/application/timing/timing-analysis-service";
import { resolveTimingPresetConfig } from "~/server/domain/timing/preset";
import type {
  WatchlistTimingCardsPipelineGraphState,
  WatchlistTimingCardsPipelineInput,
  WatchlistTimingCardsPipelineNodeKey,
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/server/domain/workflow/types";
import {
  WATCHLIST_TIMING_CARDS_PIPELINE_NODE_KEYS,
  WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
} from "~/server/domain/workflow/types";
import type { PrismaWatchListRepository } from "~/server/infrastructure/screening/prisma-watch-list-repository";
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
  currentNodeKey: Annotation<WatchlistTimingCardsPipelineNodeKey | undefined>,
  timingInput: Annotation<WatchlistTimingCardsPipelineInput>,
  preset: Annotation<WatchlistTimingCardsPipelineGraphState["preset"]>,
  presetConfig: Annotation<
    WatchlistTimingCardsPipelineGraphState["presetConfig"]
  >,
  watchlist: Annotation<WatchlistTimingCardsPipelineGraphState["watchlist"]>,
  targets: Annotation<WatchlistTimingCardsPipelineGraphState["targets"]>,
  signalSnapshots: Annotation<
    WatchlistTimingCardsPipelineGraphState["signalSnapshots"]
  >,
  technicalAssessments: Annotation<
    WatchlistTimingCardsPipelineGraphState["technicalAssessments"]
  >,
  cards: Annotation<WatchlistTimingCardsPipelineGraphState["cards"]>,
  persistedSignalSnapshots: Annotation<
    WatchlistTimingCardsPipelineGraphState["persistedSignalSnapshots"]
  >,
  persistedCards: Annotation<
    WatchlistTimingCardsPipelineGraphState["persistedCards"]
  >,
  batchErrors: Annotation<
    WatchlistTimingCardsPipelineGraphState["batchErrors"]
  >,
  errors: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

type NodeExecutor = (
  state: WatchlistTimingCardsPipelineGraphState,
) => Promise<Partial<WatchlistTimingCardsPipelineGraphState>>;

export class WatchlistTimingCardsPipelineLangGraph extends BaseWorkflowLangGraph<
  WatchlistTimingCardsPipelineGraphState,
  WatchlistTimingCardsPipelineNodeKey
> {
  readonly templateCode = WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE;
  readonly templateVersion = 1;

  constructor(deps: {
    watchListRepository: PrismaWatchListRepository;
    timingDataClient: PythonTimingDataClient;
    analysisService: TimingAnalysisService;
    presetRepository: PrismaTimingPresetRepository;
    signalSnapshotRepository: PrismaTimingSignalSnapshotRepository;
    analysisCardRepository: PrismaTimingAnalysisCardRepository;
  }) {
    const nodeExecutors: Record<
      WatchlistTimingCardsPipelineNodeKey,
      NodeExecutor
    > = {
      load_watchlist_context: async (state) => {
        const [watchList, preset] = await Promise.all([
          deps.watchListRepository.findById(state.timingInput.watchListId),
          state.timingInput.presetId
            ? deps.presetRepository.getByIdForUser(
                state.userId,
                state.timingInput.presetId,
              )
            : Promise.resolve(null),
        ]);

        if (!watchList || watchList.userId !== state.userId) {
          throw new Error("鑷€夎偂鍒楄〃涓嶅瓨鍦ㄦ垨鏃犳潈璁块棶");
        }

        return {
          preset: preset ?? undefined,
          presetConfig: resolveTimingPresetConfig(preset?.config),
          watchlist: {
            id: watchList.id,
            name: watchList.name,
            stockCount: watchList.stocks.length,
          },
          targets: watchList.stocks.map((stock) => ({
            stockCode: stock.stockCode.value,
            stockName: stock.stockName,
          })),
        };
      },
      fetch_signal_snapshots_batch: async (state) => {
        if (state.targets.length === 0) {
          return {
            signalSnapshots: [],
            batchErrors: [],
          };
        }

        const response = await deps.timingDataClient.getSignalsBatch({
          stockCodes: state.targets.map((target) => target.stockCode),
          asOfDate: state.timingInput.asOfDate,
          includeBars: true,
        });

        if (response.items.length === 0 && response.errors.length > 0) {
          throw new Error(
            response.errors.map((error) => error.message).join(", "),
          );
        }

        return {
          signalSnapshots: response.items,
          batchErrors: response.errors,
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
          sourceType: "watchlist",
          sourceId: state.timingInput.watchListId,
          watchListId: state.timingInput.watchListId,
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
            sourceType: "watchlist",
            sourceId: state.timingInput.watchListId,
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
      WatchlistTimingCardsPipelineGraphState,
      Partial<WatchlistTimingCardsPipelineGraphState>,
      string
    >;
    addWorkflowNodes(
      graphBuilder,
      WATCHLIST_TIMING_CARDS_PIPELINE_NODE_KEYS,
      nodeExecutors,
    );
    addResumeStart(graphBuilder, WATCHLIST_TIMING_CARDS_PIPELINE_NODE_KEYS);
    addSequentialEdges(graphBuilder, WATCHLIST_TIMING_CARDS_PIPELINE_NODE_KEYS);

    super({
      graph: graphBuilder.compile(),
      nodeOrder: WATCHLIST_TIMING_CARDS_PIPELINE_NODE_KEYS,
    });
  }

  buildInitialState(
    params: WorkflowGraphBuildInitialStateParams,
  ): WatchlistTimingCardsPipelineGraphState {
    return {
      runId: params.runId,
      userId: params.userId,
      query: params.query,
      progressPercent: params.progressPercent,
      resumeFromNodeKey: undefined,
      currentNodeKey: undefined,
      lastCompletedNodeKey: undefined,
      timingInput: params.input as WatchlistTimingCardsPipelineInput,
      preset: undefined,
      presetConfig: undefined,
      watchlist: undefined,
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
    const timingState = state as WatchlistTimingCardsPipelineGraphState;

    switch (nodeKey) {
      case "load_watchlist_context":
        return {
          watchlist: timingState.watchlist,
          targets: timingState.targets,
        };
      case "fetch_signal_snapshots_batch":
        return {
          signalSnapshots: timingState.signalSnapshots,
          batchErrors: timingState.batchErrors,
        };
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
    const timingState = state as WatchlistTimingCardsPipelineGraphState;

    if (nodeKey === "fetch_signal_snapshots_batch") {
      return {
        signalSnapshotCount: timingState.signalSnapshots.length,
        batchErrorCount: timingState.batchErrors.length,
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
    const timingState = state as WatchlistTimingCardsPipelineGraphState;

    return {
      signalSnapshotIds: timingState.persistedSignalSnapshots.map(
        (snapshot) => snapshot.id,
      ),
      cardIds: timingState.persistedCards.map((card) => card.id),
      stockCount: timingState.persistedCards.length,
      partialErrors: timingState.batchErrors,
    };
  }
}

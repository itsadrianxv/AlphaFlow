import { Annotation, StateGraph } from "@langchain/langgraph";
import {
  isWorkflowDomainError,
  WORKFLOW_ERROR_CODES,
} from "~/modules/research/server/domain/workflow/errors";
import { getFlowSpec } from "~/modules/research/server/domain/workflow/flow-specs";
import type {
  WatchlistTimingPipelineGraphState,
  WatchlistTimingPipelineInput,
  WatchlistTimingPipelineNodeKey,
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/modules/research/server/domain/workflow/types";
import {
  WATCHLIST_TIMING_PIPELINE_NODE_KEYS,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
} from "~/modules/research/server/domain/workflow/types";
import type { WorkflowGraphBuildInitialStateParams } from "~/modules/research/server/workflows/langgraph/workflow-graph";
import { BaseWorkflowLangGraph } from "~/modules/research/server/workflows/langgraph/workflow-graph-base";
import {
  addResumeStart,
  addSequentialEdges,
  addWorkflowNodes,
} from "~/modules/research/server/workflows/langgraph/workflow-graph-builder";
import type { PrismaWatchListRepository } from "~/modules/screening/server/infrastructure/prisma-watch-list-repository";
import type { MarketRegimeService } from "~/modules/timing/server/application/market-regime-service";
import type { TimingAnalysisService } from "~/modules/timing/server/application/timing-analysis-service";
import type { TimingFeedbackService } from "~/modules/timing/server/application/timing-feedback-service";
import type { TimingReviewSchedulingService } from "~/modules/timing/server/application/timing-review-scheduling-service";
import type { WatchlistPortfolioManagerService } from "~/modules/timing/server/application/watchlist-portfolio-manager-service";
import type { WatchlistRiskManagerService } from "~/modules/timing/server/application/watchlist-risk-manager-service";
import { resolveTimingPresetConfig } from "~/modules/timing/server/domain/preset";
import type { MarketContextAnalysis } from "~/modules/timing/server/domain/types";
import type { PrismaPortfolioSnapshotRepository } from "~/modules/timing/server/infrastructure/prisma-portfolio-snapshot-repository";
import type { PrismaTimingMarketContextSnapshotRepository } from "~/modules/timing/server/infrastructure/prisma-timing-market-context-snapshot-repository";
import type { PrismaTimingPresetRepository } from "~/modules/timing/server/infrastructure/prisma-timing-preset-repository";
import type { PrismaTimingRecommendationRepository } from "~/modules/timing/server/infrastructure/prisma-timing-recommendation-repository";
import type { PythonTimingDataClient } from "~/modules/timing/server/infrastructure/python-timing-data-client";

const WorkflowState = Annotation.Root({
  runId: Annotation<string>,
  userId: Annotation<string>,
  query: Annotation<string>,
  progressPercent: Annotation<number>,
  resumeFromNodeKey: Annotation<WorkflowNodeKey | undefined>,
  currentNodeKey: Annotation<WatchlistTimingPipelineNodeKey | undefined>,
  timingInput: Annotation<WatchlistTimingPipelineInput>,
  preset: Annotation<WatchlistTimingPipelineGraphState["preset"]>,
  presetConfig: Annotation<WatchlistTimingPipelineGraphState["presetConfig"]>,
  watchlist: Annotation<WatchlistTimingPipelineGraphState["watchlist"]>,
  portfolioSnapshot: Annotation<
    WatchlistTimingPipelineGraphState["portfolioSnapshot"]
  >,
  targets: Annotation<WatchlistTimingPipelineGraphState["targets"]>,
  signalSnapshots: Annotation<
    WatchlistTimingPipelineGraphState["signalSnapshots"]
  >,
  technicalAssessments: Annotation<
    WatchlistTimingPipelineGraphState["technicalAssessments"]
  >,
  cards: Annotation<WatchlistTimingPipelineGraphState["cards"]>,
  marketContextSnapshot: Annotation<
    WatchlistTimingPipelineGraphState["marketContextSnapshot"]
  >,
  marketContextAnalysis: Annotation<
    WatchlistTimingPipelineGraphState["marketContextAnalysis"]
  >,
  riskPlan: Annotation<WatchlistTimingPipelineGraphState["riskPlan"]>,
  feedbackContext: Annotation<
    WatchlistTimingPipelineGraphState["feedbackContext"]
  >,
  feedbackSuggestions: Annotation<
    WatchlistTimingPipelineGraphState["feedbackSuggestions"]
  >,
  recommendations: Annotation<
    WatchlistTimingPipelineGraphState["recommendations"]
  >,
  persistedRecommendations: Annotation<
    WatchlistTimingPipelineGraphState["persistedRecommendations"]
  >,
  reviewRecords: Annotation<WatchlistTimingPipelineGraphState["reviewRecords"]>,
  scheduledReminderIds: Annotation<
    WatchlistTimingPipelineGraphState["scheduledReminderIds"]
  >,
  batchErrors: Annotation<WatchlistTimingPipelineGraphState["batchErrors"]>,
  errors: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

type NodeExecutor = (
  state: WatchlistTimingPipelineGraphState,
) => Promise<Partial<WatchlistTimingPipelineGraphState>>;

function resolveFallbackMarketContextAsOfDate(
  state: WatchlistTimingPipelineGraphState,
) {
  return (
    state.timingInput.asOfDate ??
    state.signalSnapshots[0]?.asOfDate ??
    new Date().toISOString().slice(0, 10)
  );
}

function buildFallbackMarketContext(params: {
  asOfDate: string;
  errorMessage: string;
}): MarketContextAnalysis {
  return {
    state: "NEUTRAL",
    transition: "STABLE",
    regimeConfidence: 45,
    persistenceDays: 0,
    summary:
      "市场环境快照暂不可用，组合建议已使用中性降级策略继续生成，待市场广度与波动数据恢复后再补齐。",
    constraints: [
      `未能获取 ${params.asOfDate} 的 market context：${params.errorMessage}`,
      "在广度与波动数据恢复前，优先控制仓位扩张并等待二次确认。",
    ],
    breadthTrend: "STALLING",
    volatilityTrend: "STABLE",
    leadership: {
      leaderCode: "",
      leaderName: "N/A",
      switched: false,
      previousLeaderCode: null,
    },
    snapshot: {
      asOfDate: params.asOfDate,
      indexes: [],
      latestBreadth: {
        asOfDate: params.asOfDate,
        totalCount: 0,
        advancingCount: 0,
        decliningCount: 0,
        flatCount: 0,
        positiveRatio: 0,
        aboveThreePctRatio: 0,
        belowThreePctRatio: 0,
        medianChangePct: 0,
        averageTurnoverRate: null,
      },
      latestVolatility: {
        asOfDate: params.asOfDate,
        highVolatilityCount: 0,
        highVolatilityRatio: 0,
        limitDownLikeCount: 0,
        indexAtrRatio: 0,
      },
      latestLeadership: {
        asOfDate: params.asOfDate,
        leaderCode: "",
        leaderName: "N/A",
        ranking5d: [],
        ranking10d: [],
        switched: false,
        previousLeaderCode: null,
      },
      breadthSeries: [],
      volatilitySeries: [],
      leadershipSeries: [],
      features: {
        benchmarkStrength: 0,
        breadthScore: 0,
        riskScore: 0,
        stateScore: 0,
      },
    },
    stateScore: 0,
  };
}

export class WatchlistTimingPipelineLangGraph extends BaseWorkflowLangGraph<
  WatchlistTimingPipelineGraphState,
  WatchlistTimingPipelineNodeKey
> {
  readonly templateCode = WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE;
  readonly templateVersion = 1;

  constructor(deps: {
    watchListRepository: PrismaWatchListRepository;
    portfolioSnapshotRepository: PrismaPortfolioSnapshotRepository;
    timingDataClient: PythonTimingDataClient;
    analysisService: TimingAnalysisService;
    presetRepository: PrismaTimingPresetRepository;
    marketContextSnapshotRepository: PrismaTimingMarketContextSnapshotRepository;
    marketRegimeService: MarketRegimeService;
    feedbackService: TimingFeedbackService;
    riskManagerService: WatchlistRiskManagerService;
    portfolioManagerService: WatchlistPortfolioManagerService;
    recommendationRepository: PrismaTimingRecommendationRepository;
    reviewSchedulingService: TimingReviewSchedulingService;
  }) {
    const nodeExecutors: Record<WatchlistTimingPipelineNodeKey, NodeExecutor> =
      {
        load_watchlist_context: async (state) => {
          const [watchList, portfolioSnapshot, preset] = await Promise.all([
            deps.watchListRepository.findById(state.timingInput.watchListId),
            deps.portfolioSnapshotRepository.getByIdForUser(
              state.userId,
              state.timingInput.portfolioSnapshotId,
            ),
            state.timingInput.presetId
              ? deps.presetRepository.getByIdForUser(
                  state.userId,
                  state.timingInput.presetId,
                )
              : Promise.resolve(null),
          ]);

          if (!watchList || watchList.userId !== state.userId) {
            throw new Error("Watchlist not found or access denied");
          }

          if (!portfolioSnapshot) {
            throw new Error("Portfolio snapshot not found or access denied");
          }

          return {
            preset: preset ?? undefined,
            presetConfig: resolveTimingPresetConfig(preset?.config),
            watchlist: {
              id: watchList.id,
              name: watchList.name,
              stockCount: watchList.stocks.length,
            },
            portfolioSnapshot,
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
            hasPortfolioContext: true,
          }),
        }),
        market_regime_agent: async (state) => {
          if (state.timingInput.asOfDate) {
            const existing =
              await deps.marketContextSnapshotRepository.getByAsOfDate(
                state.timingInput.asOfDate,
              );
            if (existing) {
              return {
                marketContextSnapshot: existing.snapshot,
                marketContextAnalysis: existing.analysis,
              };
            }
          } else {
            const latest =
              await deps.marketContextSnapshotRepository.getLatest();
            if (latest) {
              return {
                marketContextSnapshot: latest.snapshot,
                marketContextAnalysis: latest.analysis,
              };
            }
          }

          try {
            const marketContextSnapshot =
              await deps.timingDataClient.getMarketContext({
                asOfDate: state.timingInput.asOfDate,
              });
            const history =
              await deps.marketContextSnapshotRepository.listRecent(20);
            const marketContextAnalysis = deps.marketRegimeService.analyze(
              marketContextSnapshot,
              history.filter(
                (item) => item.asOfDate !== marketContextSnapshot.asOfDate,
              ),
            );
            await deps.marketContextSnapshotRepository.upsert({
              asOfDate: marketContextSnapshot.asOfDate,
              snapshot: marketContextSnapshot,
              analysis: marketContextAnalysis,
            });

            return {
              marketContextSnapshot,
              marketContextAnalysis,
            };
          } catch (error) {
            if (
              !isWorkflowDomainError(error) ||
              error.code !== WORKFLOW_ERROR_CODES.TIMING_DATA_UNAVAILABLE
            ) {
              throw error;
            }

            const fallbackAnalysis = buildFallbackMarketContext({
              asOfDate: resolveFallbackMarketContextAsOfDate(state),
              errorMessage: error.message,
            });

            return {
              marketContextSnapshot: fallbackAnalysis.snapshot,
              marketContextAnalysis: fallbackAnalysis,
              errors: [
                `market_regime_fallback:${fallbackAnalysis.snapshot.asOfDate}:${error.message}`,
              ],
            };
          }
        },
        watchlist_risk_manager: async (state) => {
          if (!state.portfolioSnapshot || !state.marketContextAnalysis) {
            throw new Error("Portfolio snapshot or market context missing");
          }

          return {
            riskPlan: deps.riskManagerService.buildRiskPlan({
              portfolioSnapshot: state.portfolioSnapshot,
              timingCards: state.cards,
              marketContextAnalysis: state.marketContextAnalysis,
            }),
          };
        },
        watchlist_portfolio_manager: async (state) => {
          if (
            !state.watchlist ||
            !state.portfolioSnapshot ||
            !state.marketContextAnalysis ||
            !state.riskPlan
          ) {
            throw new Error("Recommendation inputs are incomplete");
          }

          const feedbackContext = await deps.feedbackService.buildContext({
            userId: state.userId,
            presetId: state.preset?.id,
          });

          return {
            feedbackContext,
            recommendations: deps.portfolioManagerService
              .buildRecommendations({
                userId: state.userId,
                workflowRunId: state.runId,
                watchListId: state.watchlist.id,
                portfolioSnapshot: state.portfolioSnapshot,
                timingCards: state.cards,
                riskPlan: state.riskPlan,
                marketContextAnalysis: state.marketContextAnalysis,
                presetConfig: state.presetConfig,
                feedbackContext,
              })
              .map((recommendation) => ({
                ...recommendation,
                presetId: state.preset?.id,
              })),
          };
        },
        persist_recommendations: async (state) => {
          const persistedRecommendations =
            await deps.recommendationRepository.createMany({
              items: state.recommendations,
            });
          const reviewArtifacts =
            await deps.reviewSchedulingService.scheduleForRecommendations({
              recommendations: persistedRecommendations,
              sourceAsOfDateByStockCode: new Map(
                state.signalSnapshots.map((snapshot) => [
                  snapshot.stockCode,
                  snapshot.asOfDate,
                ]),
              ),
              presetConfig: state.presetConfig,
            });

          return {
            persistedRecommendations,
            reviewRecords: reviewArtifacts.records,
            scheduledReminderIds: reviewArtifacts.reminderIds,
          };
        },
      };

    const graphBuilder = new StateGraph(WorkflowState) as StateGraph<
      unknown,
      WatchlistTimingPipelineGraphState,
      Partial<WatchlistTimingPipelineGraphState>,
      string
    >;
    addWorkflowNodes(
      graphBuilder,
      WATCHLIST_TIMING_PIPELINE_NODE_KEYS,
      nodeExecutors,
    );
    addResumeStart(graphBuilder, WATCHLIST_TIMING_PIPELINE_NODE_KEYS);
    addSequentialEdges(graphBuilder, WATCHLIST_TIMING_PIPELINE_NODE_KEYS);

    super({
      graph: graphBuilder.compile(),
      nodeOrder: WATCHLIST_TIMING_PIPELINE_NODE_KEYS,
      spec: getFlowSpec(WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE, 1),
    });
  }

  buildInitialState(
    params: WorkflowGraphBuildInitialStateParams,
  ): WatchlistTimingPipelineGraphState {
    return {
      runId: params.runId,
      userId: params.userId,
      query: params.query,
      progressPercent: params.progressPercent,
      resumeFromNodeKey: undefined,
      currentNodeKey: undefined,
      lastCompletedNodeKey: undefined,
      timingInput: params.input as WatchlistTimingPipelineInput,
      preset: undefined,
      presetConfig: undefined,
      watchlist: undefined,
      portfolioSnapshot: undefined,
      targets: [],
      signalSnapshots: [],
      technicalAssessments: [],
      cards: [],
      marketContextSnapshot: undefined,
      marketContextAnalysis: undefined,
      riskPlan: undefined,
      feedbackContext: undefined,
      feedbackSuggestions: [],
      recommendations: [],
      persistedRecommendations: [],
      reviewRecords: [],
      scheduledReminderIds: [],
      batchErrors: [],
      errors: [],
    };
  }

  getNodeOutput(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const timingState = state as WatchlistTimingPipelineGraphState;

    switch (nodeKey) {
      case "load_watchlist_context":
        return {
          watchlist: timingState.watchlist,
          portfolioSnapshot: timingState.portfolioSnapshot,
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
      case "market_regime_agent":
        return {
          marketContextSnapshot: timingState.marketContextSnapshot,
          marketContextAnalysis: timingState.marketContextAnalysis,
        };
      case "watchlist_risk_manager":
        return { riskPlan: timingState.riskPlan };
      case "watchlist_portfolio_manager":
        return {
          feedbackContext: timingState.feedbackContext,
          recommendations: timingState.recommendations,
        };
      default:
        return {
          persistedRecommendations: timingState.persistedRecommendations,
        };
    }
  }

  getNodeEventPayload(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const timingState = state as WatchlistTimingPipelineGraphState;

    if (nodeKey === "fetch_signal_snapshots_batch") {
      return {
        signalSnapshotCount: timingState.signalSnapshots.length,
        batchErrorCount: timingState.batchErrors.length,
      };
    }

    if (nodeKey === "watchlist_portfolio_manager") {
      return {
        recommendationCount: timingState.recommendations.length,
      };
    }

    if (nodeKey === "persist_recommendations") {
      return {
        persistedRecommendationCount:
          timingState.persistedRecommendations.length,
        reviewRecordCount: timingState.reviewRecords.length,
        reminderCount: timingState.scheduledReminderIds.length,
      };
    }

    return {};
  }

  mergeNodeResult(
    state: WorkflowGraphState,
    nodeKey: WorkflowNodeKey,
    result: import("~/modules/research/server/domain/workflow/flow-spec").NodeResult,
  ) {
    return {
      ...state,
      ...result.data,
      currentNodeKey: nodeKey,
      lastCompletedNodeKey: nodeKey,
    };
  }

  getRunResult(state: WorkflowGraphState): Record<string, unknown> {
    const timingState = state as WatchlistTimingPipelineGraphState;

    return {
      recommendationIds: timingState.persistedRecommendations.map(
        (recommendation) => recommendation.id,
      ),
      recommendationCount: timingState.persistedRecommendations.length,
      partialErrors: timingState.batchErrors,
      marketState: timingState.marketContextAnalysis?.state,
      marketTransition: timingState.marketContextAnalysis?.transition,
      riskPlan: timingState.riskPlan,
      reviewRecordIds: timingState.reviewRecords.map((record) => record.id),
      reminderIds: timingState.scheduledReminderIds,
    };
  }
}

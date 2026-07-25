import { Annotation, StateGraph } from "@langchain/langgraph";
import type { MarketRegimeService } from "~/server/application/timing/market-regime-service";
import type { TimingReviewSchedulingService } from "~/server/application/timing/timing-review-scheduling-service";
import type { TimingRuleAnalysisService } from "~/server/application/timing/timing-rule-analysis-service";
import type { WatchlistPortfolioManagerV2Service } from "~/server/application/timing/watchlist-portfolio-manager-v2-service";
import type { WatchlistRiskManagerService } from "~/server/application/timing/watchlist-risk-manager-service";
import type {
  MarketContextAnalysis,
  TimingPresetConfigV2,
  TimingTimeframe,
} from "~/server/domain/timing/types";
import {
  isWorkflowDomainError,
  WORKFLOW_ERROR_CODES,
} from "~/server/domain/workflow/errors";
import type {
  WatchlistTimingPipelineGraphState,
  WatchlistTimingPipelineInput,
  WatchlistTimingPipelineNodeKey,
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/server/domain/workflow/types";
import {
  WATCHLIST_TIMING_PIPELINE_NODE_KEYS,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
} from "~/server/domain/workflow/types";
import type { PrismaWatchListRepository } from "~/server/infrastructure/screening/prisma-watch-list-repository";
import type { PrismaPortfolioSnapshotRepository } from "~/server/infrastructure/timing/prisma-portfolio-snapshot-repository";
import type { PrismaTimingMarketContextSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-market-context-snapshot-repository";
import type { PrismaTimingPresetRevisionRepository } from "~/server/infrastructure/timing/prisma-timing-preset-revision-repository";
import type { PrismaTimingRecommendationRepository } from "~/server/infrastructure/timing/prisma-timing-recommendation-repository";
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
  currentNodeKey: Annotation<WatchlistTimingPipelineNodeKey | undefined>,
  timingInput: Annotation<WatchlistTimingPipelineInput>,
  revision: Annotation<WatchlistTimingPipelineGraphState["revision"]>,
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

function collectIndicatorIds(config: TimingPresetConfigV2) {
  return [
    ...new Set(
      config.ruleGroups.flatMap((group) =>
        group.rules
          .filter((rule) => rule.enabled)
          .map((rule) => rule.indicatorId),
      ),
    ),
  ];
}

function collectTimeframes(config: TimingPresetConfigV2) {
  return [
    ...new Set(
      [
        ...config.timeframePlan.contextTimeframes,
        config.timeframePlan.decisionTimeframe,
        config.timeframePlan.executionTimeframe,
        config.timeframePlan.fallbackExecutionTimeframe,
        ...config.ruleGroups.flatMap((group) =>
          group.rules.map((rule) => rule.timeframe),
        ),
      ].filter((item): item is TimingTimeframe => Boolean(item)),
    ),
  ];
}

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
  readonly templateCode: string;
  readonly templateVersion = 1;

  constructor(deps: {
    watchListRepository: PrismaWatchListRepository;
    portfolioSnapshotRepository: PrismaPortfolioSnapshotRepository;
    timingDataClient: PythonTimingDataClient;
    analysisService: TimingRuleAnalysisService;
    revisionRepository: PrismaTimingPresetRevisionRepository;
    marketContextSnapshotRepository: PrismaTimingMarketContextSnapshotRepository;
    marketRegimeService: MarketRegimeService;
    riskManagerService: WatchlistRiskManagerService;
    portfolioManagerService: WatchlistPortfolioManagerV2Service;
    recommendationRepository: PrismaTimingRecommendationRepository;
    reviewSchedulingService: TimingReviewSchedulingService;
    templateCode?: string;
  }) {
    const nodeExecutors: Record<WatchlistTimingPipelineNodeKey, NodeExecutor> =
      {
        load_watchlist_context: async (state) => {
          const [watchList, portfolioSnapshot, revision] = await Promise.all([
            state.timingInput.watchListId
              ? deps.watchListRepository.findById(state.timingInput.watchListId)
              : Promise.resolve(null),
            deps.portfolioSnapshotRepository.getByIdForUser(
              state.userId,
              state.timingInput.portfolioSnapshotId,
            ),
            deps.revisionRepository.getRevision(
              state.userId,
              state.timingInput.revisionId,
            ),
          ]);

          if (
            state.timingInput.watchListId &&
            (!watchList || watchList.userId !== state.userId)
          ) {
            throw new Error("Watchlist not found or access denied");
          }
          if (!watchList && !state.timingInput.targets?.length) {
            throw new Error("本次分析至少需要一只股票。");
          }

          if (!portfolioSnapshot) {
            throw new Error("Portfolio snapshot not found or access denied");
          }
          if (!revision || revision.status !== "PUBLISHED") {
            throw new Error("择时运行必须引用已发布策略修订。");
          }

          const targets = new Map(
            (watchList?.stocks ?? []).map((stock) => [
              stock.stockCode.value,
              {
                stockCode: stock.stockCode.value,
                stockName: stock.stockName,
              },
            ]),
          );
          for (const target of state.timingInput.targets ?? []) {
            targets.set(target.stockCode, {
              stockCode: target.stockCode,
              stockName: target.stockName ?? target.stockCode,
            });
          }
          for (const position of portfolioSnapshot.positions) {
            targets.set(position.stockCode, {
              stockCode: position.stockCode,
              stockName: position.stockName,
            });
          }

          return {
            revision,
            presetConfig: revision.config,
            watchlist: {
              id: watchList?.id ?? state.timingInput.sourceWatchListId,
              name: watchList?.name ?? "本次选择",
              stockCount: targets.size,
            },
            portfolioSnapshot,
            targets: [...targets.values()],
          };
        },
        fetch_signal_snapshots_batch: async (state) => {
          if (state.targets.length === 0) {
            return {
              signalSnapshots: [],
              batchErrors: [],
            };
          }

          if (!state.revision) throw new Error("策略修订尚未加载。");
          const response = await deps.timingDataClient.getEvidenceBatch({
            stockCodes: state.targets.map((target) => target.stockCode),
            asOfDate: state.timingInput.asOfDate,
            timeframes: collectTimeframes(state.revision.config),
            indicatorIds: collectIndicatorIds(state.revision.config),
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
        technical_signal_agent: async () => ({ technicalAssessments: [] }),
        timing_synthesis_agent: async (state) => ({
          cards: state.revision
            ? deps.analysisService.buildCards({
                userId: state.userId,
                workflowRunId: state.runId,
                sourceType: "watchlist",
                sourceId: state.timingInput.watchListId ?? state.runId,
                watchListId: state.timingInput.watchListId,
                revision: state.revision,
                evidence: state.signalSnapshots,
                marketState: "NEUTRAL",
                positionCodes: new Set(
                  state.portfolioSnapshot?.positions.map(
                    (item) => item.stockCode,
                  ),
                ),
              })
            : [],
        }),
        kronos_forecast_agent: async (state) => ({ cards: state.cards }),
        market_regime_agent: async (state) => {
          const buildCards = (marketState: MarketContextAnalysis["state"]) =>
            state.revision
              ? deps.analysisService.buildCards({
                  userId: state.userId,
                  workflowRunId: state.runId,
                  sourceType: "watchlist",
                  sourceId: state.timingInput.watchListId ?? state.runId,
                  watchListId: state.timingInput.watchListId,
                  revision: state.revision,
                  evidence: state.signalSnapshots,
                  marketState,
                  positionCodes: new Set(
                    state.portfolioSnapshot?.positions.map(
                      (item) => item.stockCode,
                    ),
                  ),
                })
              : [];
          if (state.timingInput.asOfDate) {
            const existing =
              await deps.marketContextSnapshotRepository.getByAsOfDate(
                state.timingInput.asOfDate,
              );
            if (existing) {
              return {
                marketContextSnapshot: existing.snapshot,
                marketContextAnalysis: existing.analysis,
                cards: buildCards(existing.analysis.state),
              };
            }
          } else {
            const latest =
              await deps.marketContextSnapshotRepository.getLatest();
            if (latest) {
              return {
                marketContextSnapshot: latest.snapshot,
                marketContextAnalysis: latest.analysis,
                cards: buildCards(latest.analysis.state),
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
              cards: buildCards(marketContextAnalysis.state),
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
              cards: buildCards(fallbackAnalysis.state),
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

          return {
            recommendations: deps.portfolioManagerService.buildRecommendations({
              userId: state.userId,
              workflowRunId: state.runId,
              watchListId: state.watchlist.id ?? null,
              portfolioSnapshot: state.portfolioSnapshot,
              timingCards: state.cards,
              riskPlan: state.riskPlan,
              marketContextAnalysis: state.marketContextAnalysis,
            }),
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
              reviewTradingDays: state.revision?.config.reviewTradingDays ?? [],
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
    });
    this.templateCode =
      deps.templateCode ?? WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE;
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
      revision: undefined,
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
      case "kronos_forecast_agent":
        return { cards: timingState.cards, errors: timingState.errors };
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

import { Annotation, StateGraph } from "@langchain/langgraph";
import { getFlowSpec } from "~/modules/research/server/domain/workflow/flow-specs";
import type {
  TimingReviewLoopGraphState,
  TimingReviewLoopInput,
  TimingReviewLoopNodeKey,
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/modules/research/server/domain/workflow/types";
import {
  TIMING_REVIEW_LOOP_NODE_KEYS,
  TIMING_REVIEW_LOOP_TEMPLATE_CODE,
} from "~/modules/research/server/domain/workflow/types";
import type { PrismaResearchReminderRepository } from "~/modules/research/server/infrastructure/intelligence/prisma-research-reminder-repository";
import type { WorkflowGraphBuildInitialStateParams } from "~/modules/research/server/workflows/langgraph/workflow-graph";
import { BaseWorkflowLangGraph } from "~/modules/research/server/workflows/langgraph/workflow-graph-base";
import {
  addResumeStart,
  addSequentialEdges,
  addWorkflowNodes,
} from "~/modules/research/server/workflows/langgraph/workflow-graph-builder";
import type { TimingFeedbackService } from "~/modules/timing/server/application/timing-feedback-service";
import type { TimingReviewPolicy } from "~/modules/timing/server/domain/services/timing-review-policy";
import type { PrismaTimingAnalysisCardRepository } from "~/modules/timing/server/infrastructure/prisma-timing-analysis-card-repository";
import type { PrismaTimingFeedbackObservationRepository } from "~/modules/timing/server/infrastructure/prisma-timing-feedback-observation-repository";
import type { PrismaTimingPresetRepository } from "~/modules/timing/server/infrastructure/prisma-timing-preset-repository";
import type { PrismaTimingRecommendationRepository } from "~/modules/timing/server/infrastructure/prisma-timing-recommendation-repository";
import type { PrismaTimingReviewRecordRepository } from "~/modules/timing/server/infrastructure/prisma-timing-review-record-repository";
import type { PythonTimingDataClient } from "~/modules/timing/server/infrastructure/python-timing-data-client";

const WorkflowState = Annotation.Root({
  runId: Annotation<string>,
  userId: Annotation<string>,
  query: Annotation<string>,
  progressPercent: Annotation<number>,
  resumeFromNodeKey: Annotation<WorkflowNodeKey | undefined>,
  currentNodeKey: Annotation<TimingReviewLoopNodeKey | undefined>,
  timingInput: Annotation<TimingReviewLoopInput>,
  dueReviews: Annotation<TimingReviewLoopGraphState["dueReviews"]>,
  evaluatedReviews: Annotation<TimingReviewLoopGraphState["evaluatedReviews"]>,
  persistedReviews: Annotation<TimingReviewLoopGraphState["persistedReviews"]>,
  feedbackSuggestions: Annotation<
    TimingReviewLoopGraphState["feedbackSuggestions"]
  >,
  consumedReminderIds: Annotation<
    TimingReviewLoopGraphState["consumedReminderIds"]
  >,
  errors: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

type NodeExecutor = (
  state: TimingReviewLoopGraphState,
) => Promise<Partial<TimingReviewLoopGraphState>>;

export class TimingReviewLoopLangGraph extends BaseWorkflowLangGraph<
  TimingReviewLoopGraphState,
  TimingReviewLoopNodeKey
> {
  readonly templateCode = TIMING_REVIEW_LOOP_TEMPLATE_CODE;
  readonly templateVersion = 1;

  constructor(deps: {
    timingDataClient: PythonTimingDataClient;
    reviewRecordRepository: PrismaTimingReviewRecordRepository;
    recommendationRepository: PrismaTimingRecommendationRepository;
    analysisCardRepository: PrismaTimingAnalysisCardRepository;
    feedbackObservationRepository: PrismaTimingFeedbackObservationRepository;
    presetRepository: PrismaTimingPresetRepository;
    feedbackService: TimingFeedbackService;
    reminderRepository: PrismaResearchReminderRepository;
    reviewPolicy: TimingReviewPolicy;
  }) {
    const nodeExecutors: Record<TimingReviewLoopNodeKey, NodeExecutor> = {
      load_due_reviews: async (state) => {
        const targetDate = state.timingInput.date
          ? new Date(`${state.timingInput.date}T23:59:59.999Z`)
          : new Date();

        return {
          dueReviews: await deps.reviewRecordRepository.listDuePending({
            userId: state.userId,
            targetDate,
            limit: state.timingInput.limit ?? 100,
          }),
        };
      },
      evaluate_outcomes: async (state) => {
        const targetDate = state.timingInput.date
          ? new Date(`${state.timingInput.date}T23:59:59.999Z`)
          : new Date();
        const targetDateText = targetDate.toISOString().slice(0, 10);

        const evaluatedReviews = [];
        for (const review of state.dueReviews) {
          const bars = await deps.timingDataClient.getBars({
            stockCode: review.stockCode,
            start: review.sourceAsOfDate,
            end: targetDateText,
          });

          const completion = deps.reviewPolicy.evaluate({
            reviewRecord: review,
            bars: bars.bars.map((bar) => ({
              close: bar.close,
              high: bar.high,
              low: bar.low,
            })),
            completedAt: targetDate,
          });

          evaluatedReviews.push({
            ...completion,
            stockCode: review.stockCode,
            reviewHorizon: review.reviewHorizon,
            expectedAction: review.expectedAction,
          });
        }

        return { evaluatedReviews };
      },
      review_agent: async (state) => ({
        evaluatedReviews: state.evaluatedReviews,
      }),
      persist_reviews: async (state) => {
        const persistedReviews = await deps.reviewRecordRepository.completeMany(
          {
            items: state.evaluatedReviews,
          },
        );

        const recommendationIds = state.dueReviews
          .map((review) => review.recommendationId)
          .filter((value): value is string => Boolean(value));
        const analysisCardIds = state.dueReviews
          .map((review) => review.analysisCardId)
          .filter((value): value is string => Boolean(value));

        const [recommendations, analysisCards] = await Promise.all([
          deps.recommendationRepository.getByIds(recommendationIds),
          deps.analysisCardRepository.getByIds(analysisCardIds),
        ]);

        const recommendationById = new Map(
          recommendations.map((item) => [item.id, item]),
        );
        const analysisCardById = new Map(
          analysisCards.map((item) => [item.id, item]),
        );

        await deps.feedbackObservationRepository.upsertMany({
          items: persistedReviews.map((review) => {
            const source = state.dueReviews.find(
              (item) => item.id === review.id,
            );
            const recommendation = source?.recommendationId
              ? recommendationById.get(source.recommendationId)
              : undefined;
            const analysisCard = source?.analysisCardId
              ? analysisCardById.get(source.analysisCardId)
              : undefined;

            return {
              userId: review.userId,
              reviewRecordId: review.id,
              recommendationId: recommendation?.id,
              presetId:
                recommendation?.presetId ?? analysisCard?.presetId ?? null,
              stockCode: review.stockCode,
              stockName: review.stockName,
              observedAt: review.completedAt ?? new Date(),
              sourceAsOfDate: review.sourceAsOfDate,
              reviewHorizon: review.reviewHorizon,
              expectedAction: review.expectedAction,
              signalContext: recommendation?.reasoning.signalContext ??
                analysisCard?.reasoning.signalContext ?? {
                  direction: "neutral",
                  compositeScore: 0,
                  signalStrength: 0,
                  confidence: 25,
                  engineBreakdown: [],
                  triggerNotes: [],
                  invalidationNotes: [],
                  riskFlags: [],
                  explanation: "缺少原始信号上下文。",
                  summary: "无可用信号上下文。",
                },
              marketContext: recommendation?.reasoning.marketContext ?? null,
              positionContext:
                recommendation?.reasoning.positionContext ?? null,
              actualReturnPct: review.actualReturnPct ?? 0,
              maxFavorableExcursionPct: review.maxFavorableExcursionPct ?? 0,
              maxAdverseExcursionPct: review.maxAdverseExcursionPct ?? 0,
              verdict: review.verdict ?? "MIXED",
            };
          }),
        });

        const uniquePresetIds = [
          ...new Set(
            recommendations
              .map((item) => item.presetId ?? null)
              .filter((value) => value !== undefined),
          ),
        ];
        const feedbackSuggestions = (
          await Promise.all(
            uniquePresetIds.map(async (presetId) => {
              const preset = presetId
                ? await deps.presetRepository.getByIdForUser(
                    state.userId,
                    presetId,
                  )
                : null;

              return deps.feedbackService.refreshSuggestions({
                userId: state.userId,
                presetId,
                presetConfig: preset?.config,
              });
            }),
          )
        ).flat();

        return {
          persistedReviews,
          feedbackSuggestions,
        };
      },
      schedule_next_review: async (state) => {
        const consumedReminderIds: string[] = [];

        for (const review of state.persistedReviews) {
          const reminders =
            await deps.reminderRepository.findByTimingReviewRecordId(review.id);

          for (const reminder of reminders) {
            if (reminder.status !== "PENDING") {
              continue;
            }

            reminder.markTriggered(review.completedAt ?? new Date());
            await deps.reminderRepository.save(reminder);
            consumedReminderIds.push(reminder.id);
          }
        }

        return { consumedReminderIds };
      },
    };

    const graphBuilder = new StateGraph(WorkflowState) as StateGraph<
      unknown,
      TimingReviewLoopGraphState,
      Partial<TimingReviewLoopGraphState>,
      string
    >;
    addWorkflowNodes(graphBuilder, TIMING_REVIEW_LOOP_NODE_KEYS, nodeExecutors);
    addResumeStart(graphBuilder, TIMING_REVIEW_LOOP_NODE_KEYS);
    addSequentialEdges(graphBuilder, TIMING_REVIEW_LOOP_NODE_KEYS);

    super({
      graph: graphBuilder.compile(),
      nodeOrder: TIMING_REVIEW_LOOP_NODE_KEYS,
      spec: getFlowSpec(TIMING_REVIEW_LOOP_TEMPLATE_CODE, 1),
    });
  }

  buildInitialState(
    params: WorkflowGraphBuildInitialStateParams,
  ): TimingReviewLoopGraphState {
    return {
      runId: params.runId,
      userId: params.userId,
      query: params.query,
      progressPercent: params.progressPercent,
      resumeFromNodeKey: undefined,
      currentNodeKey: undefined,
      lastCompletedNodeKey: undefined,
      timingInput: params.input as TimingReviewLoopInput,
      dueReviews: [],
      evaluatedReviews: [],
      persistedReviews: [],
      feedbackSuggestions: [],
      consumedReminderIds: [],
      errors: [],
    };
  }

  getNodeOutput(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const reviewState = state as TimingReviewLoopGraphState;

    switch (nodeKey) {
      case "load_due_reviews":
        return { dueReviews: reviewState.dueReviews };
      case "evaluate_outcomes":
      case "review_agent":
        return { evaluatedReviews: reviewState.evaluatedReviews };
      case "persist_reviews":
        return {
          persistedReviews: reviewState.persistedReviews,
          feedbackSuggestions: reviewState.feedbackSuggestions,
        };
      default:
        return { consumedReminderIds: reviewState.consumedReminderIds };
    }
  }

  getNodeEventPayload(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const reviewState = state as TimingReviewLoopGraphState;

    if (nodeKey === "load_due_reviews") {
      return { dueReviewCount: reviewState.dueReviews.length };
    }

    if (nodeKey === "persist_reviews") {
      return {
        persistedReviewCount: reviewState.persistedReviews.length,
        feedbackSuggestionCount: reviewState.feedbackSuggestions.length,
      };
    }

    if (nodeKey === "schedule_next_review") {
      return { consumedReminderCount: reviewState.consumedReminderIds.length };
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
    const reviewState = state as TimingReviewLoopGraphState;

    return {
      reviewIds: reviewState.persistedReviews.map((review) => review.id),
      reviewCount: reviewState.persistedReviews.length,
      feedbackSuggestionIds: reviewState.feedbackSuggestions.map(
        (item) => item.id,
      ),
      feedbackSuggestionCount: reviewState.feedbackSuggestions.length,
      reminderIds: reviewState.consumedReminderIds,
    };
  }
}

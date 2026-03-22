import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { ConfidenceAnalysisService } from "~/server/application/intelligence/confidence-analysis-service";
import type { InsightDataClient } from "~/server/application/intelligence/insight-archive-service";
import {
  buildInsightEvidenceRefs,
  mapScreeningStockToFactsBundle,
} from "~/server/application/intelligence/insight-pipeline-support";
import type {
  InsightSynthesisService,
  SynthesizedInsightDraft,
} from "~/server/application/intelligence/insight-synthesis-service";
import type { ReminderSchedulingService } from "~/server/application/intelligence/reminder-scheduling-service";
import { ScreeningInsight } from "~/server/domain/intelligence/aggregates/screening-insight";
import type {
  ConfidenceAnalysisStatus,
  ConfidenceLevel,
} from "~/server/domain/intelligence/confidence";
import { summarizeConfidenceAnalysis } from "~/server/domain/intelligence/confidence";
import { EvidenceReference } from "~/server/domain/intelligence/entities/evidence-reference";
import type { IScreeningInsightRepository } from "~/server/domain/intelligence/repositories/screening-insight-repository";
import type { InsightQualityFlag } from "~/server/domain/intelligence/types";
import { Catalyst } from "~/server/domain/intelligence/value-objects/catalyst";
import { InvestmentThesis } from "~/server/domain/intelligence/value-objects/investment-thesis";
import { ReviewPlan } from "~/server/domain/intelligence/value-objects/review-plan";
import { RiskPoint } from "~/server/domain/intelligence/value-objects/risk-point";
import { ScreeningSessionStatus } from "~/server/domain/screening/enums/screening-session-status";
import type { IScreeningSessionRepository } from "~/server/domain/screening/repositories/screening-session-repository";
import {
  WorkflowDomainError,
  WorkflowPauseError,
} from "~/server/domain/workflow/errors";
import type {
  ScreeningInsightPipelineGraphState,
  ScreeningInsightPipelineInsightCard,
  ScreeningInsightPipelineNodeKey,
  WorkflowGraphState,
  WorkflowNodeKey,
} from "~/server/domain/workflow/types";
import {
  SCREENING_INSIGHT_PIPELINE_NODE_KEYS,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
} from "~/server/domain/workflow/types";
import type { WorkflowGraphBuildInitialStateParams } from "~/server/infrastructure/workflow/langgraph/workflow-graph";
import {
  BaseWorkflowLangGraph,
  type WorkflowGraphSkip,
} from "~/server/infrastructure/workflow/langgraph/workflow-graph-base";
import {
  addResumeStart,
  addWorkflowNodes,
} from "~/server/infrastructure/workflow/langgraph/workflow-graph-builder";

const WorkflowState = Annotation.Root({
  runId: Annotation<string>,
  userId: Annotation<string>,
  query: Annotation<string>,
  progressPercent: Annotation<number>,
  resumeFromNodeKey: Annotation<WorkflowNodeKey | undefined>,
  currentNodeKey: Annotation<ScreeningInsightPipelineNodeKey | undefined>,
  lastCompletedNodeKey: Annotation<ScreeningInsightPipelineNodeKey | undefined>,
  screeningInput: Annotation<{
    screeningSessionId: string;
    maxInsightsPerSession?: number;
  }>,
  reviewApproved: Annotation<boolean>,
  screeningSession: Annotation<Record<string, unknown> | undefined>,
  candidateUniverse: Annotation<Record<string, unknown>[]>,
  evidenceBundle: Annotation<Record<string, unknown>[]>,
  insightCards: Annotation<Record<string, unknown>[]>,
  archiveArtifacts: Annotation<{
    insightIds: string[];
    versionIds: string[];
    emptyResultArchived: boolean;
  }>,
  scheduledReminderIds: Annotation<string[]>,
  notificationPayload: Annotation<Record<string, unknown> | undefined>,
  errors: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

type NodeExecutor = (
  state: ScreeningInsightPipelineGraphState,
) => Promise<Partial<ScreeningInsightPipelineGraphState>>;

export type ScreeningInsightPipelineGraphDependencies = {
  screeningSessionRepository: IScreeningSessionRepository;
  insightRepository: IScreeningInsightRepository;
  dataClient: InsightDataClient;
  synthesisService: InsightSynthesisService;
  confidenceAnalysisService: ConfidenceAnalysisService;
  reminderSchedulingService: ReminderSchedulingService;
  maxInsightsPerSession?: number;
};

function countNeedsReview(cards: ScreeningInsightPipelineInsightCard[]) {
  return cards.filter((item) => item.status === "NEEDS_REVIEW").length;
}

function toSessionSnapshot(
  session: Awaited<ReturnType<IScreeningSessionRepository["findById"]>>,
) {
  if (!session) {
    return undefined;
  }

  return {
    id: session.id,
    strategyId: session.strategyId,
    strategyName: session.strategyName,
    executedAt: session.executedAt.toISOString(),
    completedAt: session.completedAt?.toISOString(),
    totalScanned: session.totalScanned,
    matchedCount: session.countMatched(),
    executionTimeMs: session.executionTime,
  };
}

function toInsightCard(params: {
  stockCode: string;
  stockName: string;
  score: number;
  draft: SynthesizedInsightDraft;
  existing?: ScreeningInsight | null;
}): ScreeningInsightPipelineInsightCard {
  const confidenceSummary = summarizeConfidenceAnalysis(
    params.draft.confidenceAnalysis,
  );

  return {
    insightId: params.existing?.id,
    latestVersionId: params.existing?.latestVersionId,
    watchListId: params.existing?.watchListId,
    stockCode: params.stockCode,
    stockName: params.stockName,
    score: params.score,
    summary: params.draft.thesis.summary,
    status: params.draft.status,
    qualityFlags: [...params.draft.qualityFlags],
    nextReviewAt: params.draft.reviewPlan.nextReviewAt.toISOString(),
    thesis: params.draft.thesis.toDict(),
    risks: params.draft.risks.map((item) => item.toDict()),
    catalysts: params.draft.catalysts.map((item) => item.toDict()),
    reviewPlan: params.draft.reviewPlan.toDict(),
    evidenceRefs: params.draft.evidenceRefs.map((item) => item.toDict()),
    confidenceAnalysis: params.draft.confidenceAnalysis,
    confidenceScore: confidenceSummary.confidenceScore,
    confidenceLevel: confidenceSummary.confidenceLevel,
    confidenceStatus: confidenceSummary.confidenceStatus,
    supportedClaimCount: confidenceSummary.supportedClaimCount,
    insufficientClaimCount: confidenceSummary.insufficientClaimCount,
    contradictedClaimCount: confidenceSummary.contradictedClaimCount,
    existingInsightId: params.existing?.id,
    existingVersion: params.existing?.version,
    existingLatestVersionId: params.existing?.latestVersionId,
    existingCreatedAt: params.existing?.createdAt?.toISOString(),
  };
}

function toInsightAggregate(
  state: ScreeningInsightPipelineGraphState,
  card: ScreeningInsightPipelineInsightCard,
) {
  const screeningSessionId = state.screeningInput.screeningSessionId;

  return ScreeningInsight.create({
    id: card.existingInsightId ?? card.insightId,
    userId: state.userId,
    screeningSessionId,
    watchListId: card.watchListId,
    stockCode: card.stockCode,
    stockName: card.stockName,
    score: card.score,
    thesis: InvestmentThesis.fromDict(card.thesis),
    risks: card.risks.map((item) => RiskPoint.fromDict(item)),
    catalysts: card.catalysts.map((item) => Catalyst.fromDict(item)),
    reviewPlan: ReviewPlan.fromDict(card.reviewPlan),
    evidenceRefs: card.evidenceRefs.map((item) =>
      EvidenceReference.fromDict(item),
    ),
    qualityFlags: card.qualityFlags as InsightQualityFlag[],
    confidenceAnalysis: card.confidenceAnalysis,
    confidenceScore: card.confidenceScore,
    confidenceLevel:
      (card.confidenceLevel as ConfidenceLevel | undefined) ?? "unknown",
    confidenceStatus:
      (card.confidenceStatus as ConfidenceAnalysisStatus | undefined) ??
      "UNAVAILABLE",
    supportedClaimCount: card.supportedClaimCount,
    insufficientClaimCount: card.insufficientClaimCount,
    contradictedClaimCount: card.contradictedClaimCount,
    status: card.status,
    version: card.existingVersion ?? 1,
    latestVersionId: card.existingLatestVersionId,
    createdAt: card.existingCreatedAt
      ? new Date(card.existingCreatedAt)
      : undefined,
  });
}

export class ScreeningInsightPipelineLangGraph extends BaseWorkflowLangGraph<
  ScreeningInsightPipelineGraphState,
  ScreeningInsightPipelineNodeKey
> {
  readonly templateCode = SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE;

  constructor(dependencies: ScreeningInsightPipelineGraphDependencies) {
    const screeningSessionRepository = dependencies.screeningSessionRepository;
    const insightRepository = dependencies.insightRepository;
    const dataClient = dependencies.dataClient;
    const synthesisService = dependencies.synthesisService;
    const confidenceAnalysisService = dependencies.confidenceAnalysisService;
    const reminderSchedulingService = dependencies.reminderSchedulingService;
    const maxInsightsPerSession = dependencies.maxInsightsPerSession ?? 10;

    const loadSessionOrThrow = async (
      state: ScreeningInsightPipelineGraphState,
    ) => {
      const session = await screeningSessionRepository.findById(
        state.screeningInput.screeningSessionId,
      );

      if (!session) {
        throw new WorkflowDomainError(
          "WORKFLOW_RUN_NOT_FOUND",
          `筛选会话不存在: ${state.screeningInput.screeningSessionId}`,
        );
      }

      if (session.userId !== state.userId) {
        throw new WorkflowDomainError(
          "WORKFLOW_RUN_FORBIDDEN",
          `无权访问筛选会话: ${state.screeningInput.screeningSessionId}`,
        );
      }

      if (session.status !== ScreeningSessionStatus.SUCCEEDED) {
        throw new WorkflowDomainError(
          "WORKFLOW_NODE_EXECUTION_FAILED",
          `筛选会话尚未完成: ${state.screeningInput.screeningSessionId}`,
        );
      }

      return session;
    };

    const safeGetEvidence = async (stockCode: string) => {
      try {
        return await dataClient.getEvidence(stockCode);
      } catch {
        return null;
      }
    };

    const nodeExecutors: Record<ScreeningInsightPipelineNodeKey, NodeExecutor> =
      {
        load_run_context: async (state) => {
          const session = await loadSessionOrThrow(state);

          return {
            screeningSession: toSessionSnapshot(session),
          };
        },
        screen_candidates: async (state) => {
          const session = await loadSessionOrThrow(state);
          const maxInsights =
            state.screeningInput.maxInsightsPerSession ?? maxInsightsPerSession;
          const candidates = session.topStocks
            .slice(0, maxInsights)
            .map((stock) => ({
              stockCode: stock.stockCode.value,
              stockName: stock.stockName,
              score: stock.score,
              scorePercent: stock.score * 100,
              matchedConditionCount: stock.matchedConditions.length,
              scoreExplanations: [...stock.scoreExplanations],
            }));

          return {
            candidateUniverse: candidates,
          };
        },
        collect_evidence_batch: async (state) => {
          const session = await loadSessionOrThrow(state);
          const maxInsights =
            state.screeningInput.maxInsightsPerSession ?? maxInsightsPerSession;
          const stockMap = new Map(
            session.topStocks
              .slice(0, maxInsights)
              .map((stock) => [stock.stockCode.value, stock]),
          );
          const evidenceBundle = [];

          for (const candidate of state.candidateUniverse) {
            const stock = stockMap.get(candidate.stockCode);

            if (!stock) {
              continue;
            }

            const evidence = await safeGetEvidence(stock.stockCode.value);
            const factsBundle = mapScreeningStockToFactsBundle(
              session,
              stock,
              evidence,
            );
            const evidenceRefs = buildInsightEvidenceRefs(
              session,
              stock,
              evidence,
            ).map((item) => item.toDict());

            evidenceBundle.push({
              stockCode: stock.stockCode.value,
              stockName: stock.stockName,
              score: stock.score,
              factsBundle,
              evidenceRefs,
              evidence,
            });
          }

          return {
            evidenceBundle,
          };
        },
        synthesize_insights: async (state) => {
          const sessionId = state.screeningInput.screeningSessionId;
          const insightCards: ScreeningInsightPipelineInsightCard[] = [];

          for (const item of state.evidenceBundle) {
            const evidenceRefs = item.evidenceRefs.map((ref) =>
              EvidenceReference.fromDict(ref),
            );
            const draft = await synthesisService.synthesize({
              factsBundle: item.factsBundle as never,
              evidenceRefs,
            });
            const confidenceAnalysis =
              await confidenceAnalysisService.analyzeScreeningInsight({
                stockCode: item.stockCode,
                stockName: item.stockName,
                thesis: draft.thesis,
                risks: draft.risks,
                catalysts: draft.catalysts,
                evidenceRefs,
              });
            const existing = await insightRepository.findBySessionAndStockCode(
              sessionId,
              item.stockCode,
            );

            insightCards.push(
              toInsightCard({
                stockCode: item.stockCode,
                stockName: item.stockName,
                score: item.score,
                draft: {
                  ...draft,
                  confidenceAnalysis,
                },
                existing,
              }),
            );
          }

          return {
            insightCards,
          };
        },
        validate_insights: async (state) => {
          const normalized = state.insightCards.map((card) => ({
            ...card,
            qualityFlags: [...new Set(card.qualityFlags)],
          }));

          return {
            insightCards: normalized,
          };
        },
        review_gate: async (state) => {
          const needsReviewCount = countNeedsReview(state.insightCards);

          if (needsReviewCount > 0 && !state.reviewApproved) {
            throw new WorkflowPauseError(
              "insights_need_review",
              "review_required",
            );
          }

          return {
            reviewApproved: true,
          };
        },
        archive_insights: async (state) => {
          if (state.archiveArtifacts.insightIds.length > 0) {
            return {
              archiveArtifacts: state.archiveArtifacts,
              insightCards: state.insightCards,
            };
          }

          const savedCards: ScreeningInsightPipelineInsightCard[] = [];
          const insightIds: string[] = [];
          const versionIds: string[] = [];

          for (const card of state.insightCards) {
            const saved = await insightRepository.save(
              toInsightAggregate(state, card),
            );

            insightIds.push(saved.id);

            if (saved.latestVersionId) {
              versionIds.push(saved.latestVersionId);
            }

            savedCards.push({
              ...card,
              insightId: saved.id,
              latestVersionId: saved.latestVersionId,
              watchListId: saved.watchListId,
              status: saved.status,
              summary: saved.summary,
              nextReviewAt: saved.reviewPlan.nextReviewAt.toISOString(),
              confidenceAnalysis: saved.confidenceAnalysis,
              confidenceScore: saved.confidenceScore,
              confidenceLevel: saved.confidenceLevel,
              confidenceStatus: saved.confidenceStatus,
              supportedClaimCount: saved.supportedClaimCount,
              insufficientClaimCount: saved.insufficientClaimCount,
              contradictedClaimCount: saved.contradictedClaimCount,
            });
          }

          return {
            insightCards: savedCards,
            archiveArtifacts: {
              insightIds,
              versionIds,
              emptyResultArchived: false,
            },
          };
        },
        schedule_review_reminders: async (state) => {
          if (state.scheduledReminderIds.length > 0) {
            return {
              scheduledReminderIds: state.scheduledReminderIds,
            };
          }

          const reminderIds: string[] = [];

          for (const card of state.insightCards) {
            const reminder =
              await reminderSchedulingService.scheduleReviewReminder(
                toInsightAggregate(state, card),
              );
            reminderIds.push(reminder.id);
          }

          return {
            scheduledReminderIds: reminderIds,
          };
        },
        archive_empty_result: async () => {
          return {
            archiveArtifacts: {
              insightIds: [],
              versionIds: [],
              emptyResultArchived: true,
            },
          };
        },
        notify_user: async (state) => {
          const needsReviewCount = countNeedsReview(state.insightCards);
          const emptyResult = state.archiveArtifacts.emptyResultArchived;
          const strategyName =
            state.screeningSession?.strategyName ?? "筛选结果";

          return {
            notificationPayload: {
              screeningSessionId: state.screeningInput.screeningSessionId,
              strategyName,
              candidateCount: state.candidateUniverse.length,
              insightCount: state.insightCards.length,
              needsReviewCount,
              reminderCount: state.scheduledReminderIds.length,
              emptyResult,
              title: emptyResult
                ? "本次筛选无可归档标的"
                : "筛选洞察已完成归档",
              summary: emptyResult
                ? `${strategyName} 本次未发现可继续跟踪的候选标的。`
                : `${strategyName} 已归档 ${state.insightCards.length} 条洞察，其中 ${needsReviewCount} 条待复评。`,
            },
          };
        },
      };

    const graphBuilder = new StateGraph(WorkflowState) as StateGraph<
      unknown,
      ScreeningInsightPipelineGraphState,
      Partial<ScreeningInsightPipelineGraphState>,
      string
    >;
    addWorkflowNodes(
      graphBuilder,
      SCREENING_INSIGHT_PIPELINE_NODE_KEYS,
      nodeExecutors,
    );
    addResumeStart(graphBuilder, SCREENING_INSIGHT_PIPELINE_NODE_KEYS);

    graphBuilder.addEdge("load_run_context", "screen_candidates");
    graphBuilder.addConditionalEdges(
      "screen_candidates",
      (state: ScreeningInsightPipelineGraphState) =>
        state.candidateUniverse.length > 0
          ? "collect_evidence_batch"
          : "archive_empty_result",
      ["collect_evidence_batch", "archive_empty_result"],
    );
    graphBuilder.addEdge("collect_evidence_batch", "synthesize_insights");
    graphBuilder.addEdge("synthesize_insights", "validate_insights");
    graphBuilder.addEdge("validate_insights", "review_gate");
    graphBuilder.addEdge("review_gate", "archive_insights");
    graphBuilder.addEdge("archive_insights", "schedule_review_reminders");
    graphBuilder.addEdge("schedule_review_reminders", "notify_user");
    graphBuilder.addEdge("archive_empty_result", "notify_user");
    graphBuilder.addEdge("notify_user", END);

    super({
      graph: graphBuilder.compile(),
      nodeOrder: SCREENING_INSIGHT_PIPELINE_NODE_KEYS,
    });
  }

  buildInitialState(
    params: WorkflowGraphBuildInitialStateParams,
  ): ScreeningInsightPipelineGraphState {
    return {
      runId: params.runId,
      userId: params.userId,
      query: params.query,
      progressPercent: params.progressPercent,
      resumeFromNodeKey: undefined,
      currentNodeKey: undefined,
      lastCompletedNodeKey: undefined,
      screeningInput: {
        screeningSessionId: String(params.input.screeningSessionId ?? ""),
        maxInsightsPerSession:
          typeof params.input.maxInsightsPerSession === "number"
            ? params.input.maxInsightsPerSession
            : undefined,
      },
      reviewApproved: false,
      screeningSession: undefined,
      candidateUniverse: [],
      evidenceBundle: [],
      insightCards: [],
      archiveArtifacts: {
        insightIds: [],
        versionIds: [],
        emptyResultArchived: false,
      },
      scheduledReminderIds: [],
      notificationPayload: undefined,
      errors: [],
    };
  }

  getNodeOutput(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const screeningState = state as ScreeningInsightPipelineGraphState;

    switch (nodeKey) {
      case "load_run_context":
        return {
          screeningInput: screeningState.screeningInput,
          screeningSession: screeningState.screeningSession,
        };
      case "screen_candidates":
        return {
          candidateUniverse: screeningState.candidateUniverse,
        };
      case "collect_evidence_batch":
        return {
          evidenceBundle: screeningState.evidenceBundle,
        };
      case "synthesize_insights":
      case "validate_insights":
        return {
          insightCards: screeningState.insightCards,
        };
      case "review_gate":
        return {
          reviewApproved: screeningState.reviewApproved,
        };
      case "archive_insights":
        return {
          archiveArtifacts: screeningState.archiveArtifacts,
          insightCards: screeningState.insightCards,
        };
      case "schedule_review_reminders":
        return {
          scheduledReminderIds: screeningState.scheduledReminderIds,
        };
      case "archive_empty_result":
        return {
          archiveArtifacts: screeningState.archiveArtifacts,
        };
      default:
        return {
          notificationPayload: screeningState.notificationPayload,
        };
    }
  }

  getNodeEventPayload(nodeKey: WorkflowNodeKey, state: WorkflowGraphState) {
    const screeningState = state as ScreeningInsightPipelineGraphState;
    const candidateCount = screeningState.candidateUniverse.length;
    const insightCount = screeningState.insightCards.length;
    const needsReviewCount = countNeedsReview(screeningState.insightCards);

    switch (nodeKey) {
      case "load_run_context":
        return {
          screeningSessionId: screeningState.screeningInput.screeningSessionId,
          strategyName: screeningState.screeningSession?.strategyName,
        };
      case "screen_candidates":
        return { candidateCount };
      case "collect_evidence_batch":
        return {
          candidateCount,
          evidenceCount: screeningState.evidenceBundle.length,
        };
      case "synthesize_insights":
        return { insightCount };
      case "validate_insights":
        return { insightCount, needsReviewCount };
      case "review_gate":
        return {
          needsReviewCount,
          reviewApproved: screeningState.reviewApproved,
        };
      case "archive_insights":
        return {
          archiveSaved: screeningState.archiveArtifacts.insightIds.length > 0,
          insightCount,
          needsReviewCount,
        };
      case "schedule_review_reminders":
        return {
          remindersScheduled: screeningState.scheduledReminderIds.length,
        };
      case "archive_empty_result":
        return {
          candidateCount,
          archiveSaved: screeningState.archiveArtifacts.emptyResultArchived,
          emptyResult: true,
        };
      default:
        return {
          candidateCount,
          insightCount,
          needsReviewCount,
          remindersScheduled: screeningState.scheduledReminderIds.length,
          emptyResult: screeningState.archiveArtifacts.emptyResultArchived,
        };
    }
  }

  mergeNodeOutput(
    state: WorkflowGraphState,
    nodeKey: WorkflowNodeKey,
    output: Record<string, unknown>,
  ): WorkflowGraphState {
    return {
      ...state,
      ...output,
      currentNodeKey: nodeKey,
      lastCompletedNodeKey: nodeKey,
    };
  }

  getRunResult(state: WorkflowGraphState): Record<string, unknown> {
    const screeningState = state as ScreeningInsightPipelineGraphState;

    return {
      screeningSessionId: screeningState.screeningInput.screeningSessionId,
      candidateCount: screeningState.candidateUniverse.length,
      insightCount: screeningState.insightCards.length,
      needsReviewCount: countNeedsReview(screeningState.insightCards),
      reminderCount: screeningState.scheduledReminderIds.length,
      emptyResult: screeningState.archiveArtifacts.emptyResultArchived,
      archiveArtifacts: screeningState.archiveArtifacts,
      notificationPayload: screeningState.notificationPayload,
      insights: screeningState.insightCards.map((item) => ({
        insightId: item.insightId,
        stockCode: item.stockCode,
        stockName: item.stockName,
        summary: item.summary,
        status: item.status,
        nextReviewAt: item.nextReviewAt,
        qualityFlags: item.qualityFlags,
        confidenceScore: item.confidenceScore,
        confidenceLevel: item.confidenceLevel,
        confidenceStatus: item.confidenceStatus,
        supportedClaimCount: item.supportedClaimCount,
        insufficientClaimCount: item.insufficientClaimCount,
        contradictedClaimCount: item.contradictedClaimCount,
      })),
    };
  }

  protected getSkippedNodes(
    nodeKey: ScreeningInsightPipelineNodeKey,
    state: ScreeningInsightPipelineGraphState,
  ): WorkflowGraphSkip<ScreeningInsightPipelineNodeKey>[] {
    if (nodeKey !== "screen_candidates") {
      return [];
    }

    const hasCandidates = state.candidateUniverse.length > 0;

    if (!hasCandidates) {
      return [
        { nodeKey: "collect_evidence_batch", reason: "no_candidates" },
        { nodeKey: "synthesize_insights", reason: "no_candidates" },
        { nodeKey: "validate_insights", reason: "no_candidates" },
        { nodeKey: "review_gate", reason: "no_candidates" },
        { nodeKey: "archive_insights", reason: "no_candidates" },
        { nodeKey: "schedule_review_reminders", reason: "no_candidates" },
      ];
    }

    return [{ nodeKey: "archive_empty_result", reason: "candidates_present" }];
  }
}

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
import { WorkflowDomainError } from "~/server/domain/workflow/errors";
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
import type {
  WorkflowGraphBuildInitialStateParams,
  WorkflowGraphExecutionHooks,
  WorkflowGraphRunner,
} from "~/server/infrastructure/workflow/langgraph/workflow-graph";

const WorkflowState = Annotation.Root({
  runId: Annotation<string>,
  userId: Annotation<string>,
  query: Annotation<string>,
  progressPercent: Annotation<number>,
  currentNodeKey: Annotation<ScreeningInsightPipelineNodeKey | undefined>,
  lastCompletedNodeKey: Annotation<ScreeningInsightPipelineNodeKey | undefined>,
  screeningInput: Annotation<{
    screeningSessionId: string;
    maxInsightsPerSession?: number;
  }>,
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

export class ScreeningInsightPipelineLangGraph implements WorkflowGraphRunner {
  readonly templateCode = SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE;

  private readonly screeningSessionRepository: IScreeningSessionRepository;
  private readonly insightRepository: IScreeningInsightRepository;
  private readonly dataClient: InsightDataClient;
  private readonly synthesisService: InsightSynthesisService;
  private readonly confidenceAnalysisService: ConfidenceAnalysisService;
  private readonly reminderSchedulingService: ReminderSchedulingService;
  private readonly maxInsightsPerSession: number;
  private readonly nodeExecutors: Record<
    ScreeningInsightPipelineNodeKey,
    NodeExecutor
  >;

  constructor(dependencies: ScreeningInsightPipelineGraphDependencies) {
    this.screeningSessionRepository = dependencies.screeningSessionRepository;
    this.insightRepository = dependencies.insightRepository;
    this.dataClient = dependencies.dataClient;
    this.synthesisService = dependencies.synthesisService;
    this.confidenceAnalysisService = dependencies.confidenceAnalysisService;
    this.reminderSchedulingService = dependencies.reminderSchedulingService;
    this.maxInsightsPerSession = dependencies.maxInsightsPerSession ?? 10;
    this.nodeExecutors = {
      load_run_context: async (state) => {
        const session = await this.loadSessionOrThrow(state);

        return {
          screeningSession: toSessionSnapshot(session),
        };
      },
      screen_candidates: async (state) => {
        const session = await this.loadSessionOrThrow(state);
        const maxInsights =
          state.screeningInput.maxInsightsPerSession ??
          this.maxInsightsPerSession;
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
        const session = await this.loadSessionOrThrow(state);
        const maxInsights =
          state.screeningInput.maxInsightsPerSession ??
          this.maxInsightsPerSession;
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

          const evidence = await this.safeGetEvidence(stock.stockCode.value);
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
          const draft = await this.synthesisService.synthesize({
            factsBundle: item.factsBundle as never,
            evidenceRefs,
          });
          const confidenceAnalysis =
            await this.confidenceAnalysisService.analyzeScreeningInsight({
              stockCode: item.stockCode,
              stockName: item.stockName,
              thesis: draft.thesis,
              risks: draft.risks,
              catalysts: draft.catalysts,
              evidenceRefs,
            });
          const existing =
            await this.insightRepository.findBySessionAndStockCode(
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
          const saved = await this.insightRepository.save(
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
            await this.reminderSchedulingService.scheduleReviewReminder(
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
        const strategyName = state.screeningSession?.strategyName ?? "筛选结果";

        return {
          notificationPayload: {
            screeningSessionId: state.screeningInput.screeningSessionId,
            strategyName,
            candidateCount: state.candidateUniverse.length,
            insightCount: state.insightCards.length,
            needsReviewCount,
            reminderCount: state.scheduledReminderIds.length,
            emptyResult,
            title: emptyResult ? "本次筛选无可归档标的" : "筛选洞察已完成归档",
            summary: emptyResult
              ? `${strategyName} 本次未发现可继续跟踪的候选标的。`
              : `${strategyName} 已归档 ${state.insightCards.length} 条洞察，其中 ${needsReviewCount} 条待复评。`,
          },
        };
      },
    };
  }

  getNodeOrder() {
    return [...SCREENING_INSIGHT_PIPELINE_NODE_KEYS];
  }

  buildInitialState(
    params: WorkflowGraphBuildInitialStateParams,
  ): ScreeningInsightPipelineGraphState {
    return {
      runId: params.runId,
      userId: params.userId,
      query: params.query,
      progressPercent: params.progressPercent,
      currentNodeKey: undefined,
      lastCompletedNodeKey: undefined,
      screeningInput: {
        screeningSessionId: String(params.input.screeningSessionId ?? ""),
        maxInsightsPerSession:
          typeof params.input.maxInsightsPerSession === "number"
            ? params.input.maxInsightsPerSession
            : undefined,
      },
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

  async execute(params: {
    initialState: WorkflowGraphState;
    startNodeIndex?: number;
    hooks?: WorkflowGraphExecutionHooks;
  }) {
    let state = {
      ...(params.initialState as ScreeningInsightPipelineGraphState),
      errors: (params.initialState.errors ?? []) as string[],
    };

    const startIndex = params.startNodeIndex ?? 0;

    for (
      let index = startIndex;
      index < SCREENING_INSIGHT_PIPELINE_NODE_KEYS.length;
      index += 1
    ) {
      const nodeKey = SCREENING_INSIGHT_PIPELINE_NODE_KEYS[index];

      if (!nodeKey) {
        continue;
      }

      const skipReason = this.getSkipReason(nodeKey, state);
      const progressPercent = Math.round(
        ((index + 1) / SCREENING_INSIGHT_PIPELINE_NODE_KEYS.length) * 100,
      );

      if (skipReason) {
        state = {
          ...state,
          currentNodeKey: nodeKey,
          lastCompletedNodeKey: nodeKey,
          progressPercent,
        };

        await params.hooks?.onNodeSkipped?.(nodeKey, state, {
          reason: skipReason,
          ...this.getNodeEventPayload(nodeKey, state),
        });
        continue;
      }

      const nodeGraph = this.buildSingleNodeGraph(nodeKey);

      await params.hooks?.onNodeStarted?.(nodeKey);
      await params.hooks?.onNodeProgress?.(nodeKey, {
        message: `节点 ${nodeKey} 执行中`,
      });

      state = {
        ...state,
        currentNodeKey: nodeKey,
      };

      const result = (await nodeGraph.invoke(
        state,
      )) as typeof WorkflowState.State;

      state = {
        ...(result as ScreeningInsightPipelineGraphState),
        currentNodeKey: nodeKey,
        lastCompletedNodeKey: nodeKey,
        progressPercent,
      };

      await params.hooks?.onNodeSucceeded?.(nodeKey, state);
    }

    return state;
  }

  private async loadSessionOrThrow(state: ScreeningInsightPipelineGraphState) {
    const session = await this.screeningSessionRepository.findById(
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
  }

  private buildSingleNodeGraph(nodeKey: ScreeningInsightPipelineNodeKey) {
    return new StateGraph(WorkflowState)
      .addNode(nodeKey, (state) =>
        this.nodeExecutors[nodeKey](
          state as ScreeningInsightPipelineGraphState,
        ),
      )
      .addEdge(START, nodeKey)
      .addEdge(nodeKey, END)
      .compile();
  }

  private getSkipReason(
    nodeKey: ScreeningInsightPipelineNodeKey,
    state: ScreeningInsightPipelineGraphState,
  ) {
    const hasCandidates = state.candidateUniverse.length > 0;

    if (
      !hasCandidates &&
      [
        "collect_evidence_batch",
        "synthesize_insights",
        "validate_insights",
        "archive_insights",
        "schedule_review_reminders",
      ].includes(nodeKey)
    ) {
      return "no_candidates";
    }

    if (hasCandidates && nodeKey === "archive_empty_result") {
      return "candidates_present";
    }

    if (
      nodeKey === "archive_insights" &&
      state.archiveArtifacts.insightIds.length > 0
    ) {
      return "already_archived";
    }

    if (
      nodeKey === "schedule_review_reminders" &&
      state.scheduledReminderIds.length > 0
    ) {
      return "already_scheduled";
    }

    if (
      nodeKey === "archive_empty_result" &&
      state.archiveArtifacts.emptyResultArchived
    ) {
      return "already_archived_empty_result";
    }

    return null;
  }

  private async safeGetEvidence(stockCode: string) {
    try {
      return await this.dataClient.getEvidence(stockCode);
    } catch {
      return null;
    }
  }
}

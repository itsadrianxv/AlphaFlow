import { WorkflowEventType, WorkflowRunStatus } from "@prisma/client";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/modules/research/server/domain/workflow/errors";
import type {
  ResearchPreferenceInput,
  ResearchTaskContract,
} from "~/modules/research/server/domain/workflow/research";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  getWorkflowNodeKeysFromGraphConfig,
  QUICK_RESEARCH_TEMPLATE_CODE,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
  SCREENING_TO_TIMING_TEMPLATE_CODE,
  TIMING_REVIEW_LOOP_TEMPLATE_CODE,
  TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
  type WorkflowEventStreamType,
  type WorkflowGraphState,
} from "~/modules/research/server/domain/workflow/types";
import type { PrismaWorkflowRunRepository } from "~/modules/research/server/infrastructure/workflow/prisma/workflow-run-repository";
import { RedisWorkflowRuntimeStore } from "~/platform/workflow-runtime/redis/redis-workflow-runtime-store";

export type StartQuickResearchCommand = {
  userId: string;
  query: string;
  taskContract?: ResearchTaskContract;
  researchPreferences?: ResearchPreferenceInput;
  templateCode?: string;
  templateVersion?: number;
  idempotencyKey?: string;
};

export type StartCompanyResearchCommand = {
  userId: string;
  companyName: string;
  stockCode?: string;
  officialWebsite?: string;
  focusConcepts?: string[];
  keyQuestion?: string;
  supplementalUrls?: string[];
  taskContract?: ResearchTaskContract;
  researchPreferences?: ResearchPreferenceInput;
  templateVersion?: number;
  idempotencyKey?: string;
};

export type StartScreeningInsightPipelineCommand = {
  userId: string;
  screeningSessionId: string;
  strategyName?: string;
  maxInsightsPerSession?: number;
  templateVersion?: number;
  idempotencyKey?: string;
};

export type StartTimingSignalPipelineCommand = {
  userId: string;
  stockCode: string;
  asOfDate?: string;
  presetId?: string;
  templateVersion?: number;
  idempotencyKey?: string;
};

export type StartWatchlistTimingCardsPipelineCommand = {
  userId: string;
  watchListId: string;
  asOfDate?: string;
  presetId?: string;
  watchListName?: string;
  templateVersion?: number;
  idempotencyKey?: string;
};

export type StartWatchlistTimingPipelineCommand = {
  userId: string;
  watchListId: string;
  portfolioSnapshotId: string;
  asOfDate?: string;
  presetId?: string;
  watchListName?: string;
  portfolioSnapshotName?: string;
  templateVersion?: number;
  idempotencyKey?: string;
};

export type StartScreeningToTimingPipelineCommand = {
  userId: string;
  screeningSessionId: string;
  strategyName?: string;
  candidateLimit?: number;
  asOfDate?: string;
  presetId?: string;
  templateVersion?: number;
  idempotencyKey?: string;
};

export type StartTimingReviewLoopCommand = {
  userId: string;
  date?: string;
  limit?: number;
  templateVersion?: number;
  idempotencyKey?: string;
};

export type ApproveScreeningInsightsCommand = {
  userId: string;
  runId: string;
};

type StartWorkflowCommand = {
  userId: string;
  query: string;
  templateCode: string;
  templateVersion?: number;
  input: Record<string, unknown>;
  idempotencyKey?: string;
};

function buildCompanyResearchQuery(command: StartCompanyResearchCommand) {
  const focus = command.focusConcepts?.filter(Boolean).slice(0, 2).join(" / ");
  const question = command.keyQuestion?.trim();

  if (focus && question) {
    return `${command.companyName} - ${focus} - ${question}`;
  }

  if (focus) {
    return `${command.companyName} - ${focus}`;
  }

  return question
    ? `${command.companyName} - ${question}`
    : command.companyName;
}

function mapEventType(
  eventType: WorkflowEventType,
): WorkflowEventStreamType | null {
  switch (eventType) {
    case WorkflowEventType.RUN_STARTED:
      return "RUN_STARTED";
    case WorkflowEventType.RUN_PAUSED:
      return "RUN_PAUSED";
    case WorkflowEventType.RUN_RESUMED:
      return "RUN_RESUMED";
    case WorkflowEventType.RUN_SUCCEEDED:
      return "RUN_SUCCEEDED";
    case WorkflowEventType.RUN_FAILED:
      return "RUN_FAILED";
    case WorkflowEventType.RUN_CANCELLED:
      return "RUN_CANCELLED";
    case WorkflowEventType.NODE_STARTED:
      return "NODE_STARTED";
    case WorkflowEventType.NODE_PROGRESS:
      return "NODE_PROGRESS";
    case WorkflowEventType.NODE_SUCCEEDED:
      return "NODE_SUCCEEDED";
    case WorkflowEventType.NODE_FAILED:
      return "NODE_FAILED";
    default:
      return null;
  }
}

export class WorkflowCommandService {
  constructor(
    private readonly repository: PrismaWorkflowRunRepository,
    private readonly runtimeStore = new RedisWorkflowRuntimeStore(),
  ) {}

  async startQuickResearch(command: StartQuickResearchCommand) {
    return this.startWorkflow({
      userId: command.userId,
      query: command.query,
      templateCode: command.templateCode ?? QUICK_RESEARCH_TEMPLATE_CODE,
      templateVersion: command.templateVersion,
      input: {
        query: command.query,
        researchPreferences: command.researchPreferences,
        taskContract: command.taskContract,
      },
      idempotencyKey: command.idempotencyKey,
    });
  }

  async startCompanyResearch(command: StartCompanyResearchCommand) {
    return this.startWorkflow({
      userId: command.userId,
      query: buildCompanyResearchQuery(command),
      templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
      templateVersion: command.templateVersion,
      input: {
        companyName: command.companyName,
        stockCode: command.stockCode,
        officialWebsite: command.officialWebsite,
        focusConcepts: command.focusConcepts,
        keyQuestion: command.keyQuestion,
        supplementalUrls: command.supplementalUrls,
        taskContract: command.taskContract,
        researchPreferences: command.researchPreferences,
      },
      idempotencyKey: command.idempotencyKey,
    });
  }

  async startScreeningInsightPipeline(
    command: StartScreeningInsightPipelineCommand,
  ) {
    return this.startWorkflow({
      userId: command.userId,
      query: command.strategyName
        ? `筛选洞察流水线 - ${command.strategyName}`
        : `筛选洞察流水线 - ${command.screeningSessionId}`,
      templateCode: SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
      templateVersion: command.templateVersion,
      input: {
        screeningSessionId: command.screeningSessionId,
        maxInsightsPerSession: command.maxInsightsPerSession,
      },
      idempotencyKey:
        command.idempotencyKey ??
        `screening-insight-pipeline:${command.screeningSessionId}`,
    });
  }

  async startTimingSignalPipeline(command: StartTimingSignalPipelineCommand) {
    return this.startWorkflow({
      userId: command.userId,
      query: `择时信号卡 - ${command.stockCode}`,
      templateCode: TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
      templateVersion: command.templateVersion,
      input: {
        stockCode: command.stockCode,
        asOfDate: command.asOfDate,
        presetId: command.presetId,
      },
      idempotencyKey:
        command.idempotencyKey ??
        `timing-signal:${command.userId}:${command.stockCode}:${command.asOfDate ?? "latest"}${command.presetId ? `:${command.presetId}` : ""}`,
    });
  }

  async startWatchlistTimingCardsPipeline(
    command: StartWatchlistTimingCardsPipelineCommand,
  ) {
    return this.startWorkflow({
      userId: command.userId,
      query: command.watchListName
        ? `自选股择时卡 - ${command.watchListName}`
        : `自选股择时卡 - ${command.watchListId}`,
      templateCode: WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
      templateVersion: command.templateVersion,
      input: {
        watchListId: command.watchListId,
        asOfDate: command.asOfDate,
        presetId: command.presetId,
      },
      idempotencyKey:
        command.idempotencyKey ??
        `watchlist-timing-cards:${command.userId}:${command.watchListId}:${command.asOfDate ?? "latest"}${command.presetId ? `:${command.presetId}` : ""}`,
    });
  }

  async startWatchlistTimingPipeline(
    command: StartWatchlistTimingPipelineCommand,
  ) {
    return this.startWorkflow({
      userId: command.userId,
      query:
        command.watchListName && command.portfolioSnapshotName
          ? `自选股组合建议 - ${command.watchListName} / ${command.portfolioSnapshotName}`
          : `自选股组合建议 - ${command.watchListId}`,
      templateCode: WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
      templateVersion: command.templateVersion,
      input: {
        watchListId: command.watchListId,
        portfolioSnapshotId: command.portfolioSnapshotId,
        asOfDate: command.asOfDate,
        presetId: command.presetId,
      },
      idempotencyKey:
        command.idempotencyKey ??
        `watchlist-timing:${command.userId}:${command.watchListId}:${command.portfolioSnapshotId}:${command.asOfDate ?? "latest"}${command.presetId ? `:${command.presetId}` : ""}`,
    });
  }

  async startScreeningToTimingPipeline(
    command: StartScreeningToTimingPipelineCommand,
  ) {
    return this.startWorkflow({
      userId: command.userId,
      query: command.strategyName
        ? `筛选联动择时 - ${command.strategyName}`
        : `筛选联动择时 - ${command.screeningSessionId}`,
      templateCode: SCREENING_TO_TIMING_TEMPLATE_CODE,
      templateVersion: command.templateVersion,
      input: {
        screeningSessionId: command.screeningSessionId,
        candidateLimit: command.candidateLimit,
        asOfDate: command.asOfDate,
        presetId: command.presetId,
      },
      idempotencyKey:
        command.idempotencyKey ??
        `screening-to-timing:${command.screeningSessionId}${command.presetId ? `:${command.presetId}` : ""}`,
    });
  }

  async startTimingReviewLoop(command: StartTimingReviewLoopCommand) {
    return this.startWorkflow({
      userId: command.userId,
      query: `择时复盘 - ${command.date ?? "today"}`,
      templateCode: TIMING_REVIEW_LOOP_TEMPLATE_CODE,
      templateVersion: command.templateVersion,
      input: {
        date: command.date,
        limit: command.limit,
      },
      idempotencyKey:
        command.idempotencyKey ??
        `timing-review:${command.date ?? new Date().toISOString().slice(0, 10)}`,
    });
  }

  async cancelRun(userId: string, runId: string) {
    const run = await this.repository.requestCancellation(runId, userId);

    if (!run) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_RUN_NOT_FOUND,
        `工作流运行不存在: ${runId}`,
      );
    }

    if (
      run.status !== WorkflowRunStatus.PENDING &&
      run.status !== WorkflowRunStatus.RUNNING &&
      run.status !== WorkflowRunStatus.PAUSED &&
      run.status !== WorkflowRunStatus.CANCELLED
    ) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_CANCEL_NOT_ALLOWED,
        `当前状态不可取消: ${run.status}`,
      );
    }

    return {
      success: true,
    };
  }

  async approveScreeningInsights(command: ApproveScreeningInsightsCommand) {
    const run = await this.repository.getRunById(command.runId);

    if (!run) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_RUN_NOT_FOUND,
        `工作流运行不存在: ${command.runId}`,
      );
    }

    if (run.userId !== command.userId) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_RUN_FORBIDDEN,
        `无权审批该工作流运行: ${command.runId}`,
      );
    }

    if (run.template.code !== SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_INVALID_STATUS_TRANSITION,
        `当前工作流不支持审批恢复: ${run.template.code}`,
      );
    }

    if (run.status !== WorkflowRunStatus.PAUSED) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_INVALID_STATUS_TRANSITION,
        `当前状态不可恢复: ${run.status}`,
      );
    }

    const checkpoint = await this.runtimeStore.loadCheckpoint(run.id);

    if (!checkpoint) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_INVALID_STATUS_TRANSITION,
        `缺少可恢复的 checkpoint: ${run.id}`,
      );
    }

    const resumedState: WorkflowGraphState = {
      ...checkpoint,
      reviewApproved: true,
    };
    const currentNodeKey =
      typeof resumedState.currentNodeKey === "string"
        ? resumedState.currentNodeKey
        : (run.currentNodeKey ?? undefined);
    const progressPercent =
      typeof resumedState.progressPercent === "number"
        ? resumedState.progressPercent
        : run.progressPercent;

    resumedState.currentNodeKey = currentNodeKey;
    resumedState.progressPercent = progressPercent;

    await this.runtimeStore.saveCheckpoint(run.id, resumedState);
    await this.repository.markRunResumed({
      runId: run.id,
      currentNodeKey,
      progressPercent,
      eventPayload: {
        reviewApproved: true,
      },
    });
    await this.publishLatestEvent(run.id, progressPercent, currentNodeKey);

    return {
      success: true,
    };
  }

  private async startWorkflow(command: StartWorkflowCommand) {
    if (
      command.templateCode === QUICK_RESEARCH_TEMPLATE_CODE &&
      command.templateVersion !== undefined &&
      command.templateVersion !== 3
    ) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_TEMPLATE_NOT_FOUND,
        `quick research 仅支持模板版本 3: ${command.templateVersion}`,
      );
    }

    if (command.idempotencyKey) {
      const existing = await this.repository.findPendingOrRunningByIdempotency(
        command.userId,
        command.idempotencyKey,
      );

      if (existing) {
        return {
          runId: existing.id,
          status: existing.status,
          createdAt: existing.createdAt,
        };
      }
    }

    let template = await this.repository.getTemplateByCodeAndVersion(
      command.templateCode,
      command.templateVersion,
    );

    if (
      command.templateCode === QUICK_RESEARCH_TEMPLATE_CODE &&
      command.templateVersion === undefined &&
      (!template || template.version < 3)
    ) {
      template = await this.repository.ensureQuickResearchTemplate();
    }

    if (
      command.templateCode === COMPANY_RESEARCH_TEMPLATE_CODE &&
      command.templateVersion === undefined &&
      (!template || template.version < 4)
    ) {
      template = await this.repository.ensureCompanyResearchTemplate();
    }

    if (!template && command.templateCode === QUICK_RESEARCH_TEMPLATE_CODE) {
      template = await this.repository.ensureQuickResearchTemplate();
    }

    if (!template && command.templateCode === COMPANY_RESEARCH_TEMPLATE_CODE) {
      template = await this.repository.ensureCompanyResearchTemplate();
    }

    if (
      !template &&
      command.templateCode === SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE
    ) {
      template = await this.repository.ensureScreeningInsightPipelineTemplate();
    }

    if (
      !template &&
      command.templateCode === TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE
    ) {
      template = await this.repository.ensureTimingSignalPipelineTemplate();
    }

    if (
      !template &&
      command.templateCode === WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE
    ) {
      template =
        await this.repository.ensureWatchlistTimingCardsPipelineTemplate();
    }

    if (
      !template &&
      command.templateCode === WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE
    ) {
      template = await this.repository.ensureWatchlistTimingPipelineTemplate();
    }

    if (
      !template &&
      command.templateCode === SCREENING_TO_TIMING_TEMPLATE_CODE
    ) {
      template =
        await this.repository.ensureScreeningToTimingPipelineTemplate();
    }

    if (
      !template &&
      command.templateCode === TIMING_REVIEW_LOOP_TEMPLATE_CODE
    ) {
      template = await this.repository.ensureTimingReviewLoopTemplate();
    }

    if (!template) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_TEMPLATE_NOT_FOUND,
        `工作流模板不存在: ${command.templateCode}`,
      );
    }

    const nodeKeys = getWorkflowNodeKeysFromGraphConfig(template.graphConfig);

    if (nodeKeys.length === 0) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_TEMPLATE_NOT_FOUND,
        `工作流模板缺少节点配置: ${command.templateCode}`,
      );
    }

    const run = await this.repository.createRun({
      templateId: template.id,
      userId: command.userId,
      query: command.query,
      input: command.input,
      nodeKeys,
      idempotencyKey: command.idempotencyKey,
    });

    return {
      runId: run.id,
      status: run.status,
      createdAt: run.createdAt,
    };
  }

  private async publishLatestEvent(
    runId: string,
    progressPercent: number,
    nodeKey?: string,
  ) {
    const latestEvent = await this.repository.getLatestEvent(runId);

    if (!latestEvent) {
      return;
    }

    const eventType = mapEventType(latestEvent.eventType);

    if (!eventType) {
      return;
    }

    const payload = (latestEvent.payload ?? {}) as Record<string, unknown>;
    const payloadNodeKey =
      typeof payload.nodeKey === "string" ? payload.nodeKey : nodeKey;

    await this.runtimeStore.publishEvent({
      runId,
      sequence: latestEvent.sequence,
      type: eventType,
      nodeKey: payloadNodeKey,
      progressPercent,
      timestamp: latestEvent.occurredAt.toISOString(),
      payload,
    });
  }
}

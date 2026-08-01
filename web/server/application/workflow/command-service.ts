import { WorkflowEventType, WorkflowRunStatus } from "@prisma/client";
import type { ImpactMappingInput } from "~/server/domain/intelligence/impact-mapping";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";
import type {
  ResearchPreferenceInput,
  ResearchTaskContract,
} from "~/server/domain/workflow/research";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  getWorkflowNodeKeysFromGraphConfig,
  IMPACT_MAPPING_TEMPLATE_CODE,
  INDUSTRY_RESEARCH_TEMPLATE_CODE,
  PI_AGENT_RUN_TEMPLATE_CODE,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
  type WorkflowEventStreamType,
  type WorkflowGraphState,
} from "~/server/domain/workflow/types";
import type { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";
import { RedisWorkflowRuntimeStore } from "~/server/infrastructure/workflow/redis/redis-workflow-runtime-store";

export type StartIndustryResearchCommand = {
  userId: string;
  query: string;
  targetRef?: { type: string; id: string };
  taskContract?: ResearchTaskContract;
  researchPreferences?: ResearchPreferenceInput;
  templateCode?: string;
  templateVersion?: number;
  idempotencyKey?: string;
};

export type StartCompanyResearchCommand = {
  userId: string;
  companyName: string;
  targetRef?: { type: string; id: string };
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

export type StartPiAgentRunCommand = {
  userId: string;
  skillId: string;
  skillIds: string[];
  prompt: string;
  title?: string;
  conversationId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  context?: Record<string, unknown>;
  templateVersion?: number;
  idempotencyKey?: string;
};

export type StartImpactMappingCommand = {
  userId: string;
  input: ImpactMappingInput;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class WorkflowCommandService {
  constructor(
    private readonly repository: PrismaWorkflowRunRepository,
    private readonly runtimeStore = new RedisWorkflowRuntimeStore(),
  ) {}

  async startIndustryResearch(command: StartIndustryResearchCommand) {
    return this.startWorkflow({
      userId: command.userId,
      query: command.query,
      templateCode: command.templateCode ?? INDUSTRY_RESEARCH_TEMPLATE_CODE,
      templateVersion: command.templateVersion,
      input: {
        query: command.query,
        targetRef: command.targetRef,
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
        targetRef: command.targetRef,
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

  async startPiAgentRun(command: StartPiAgentRunCommand) {
    const title = command.title?.trim() || command.prompt.trim().slice(0, 80);

    return this.startWorkflow({
      userId: command.userId,
      query: `Pi Agent - ${title}`,
      templateCode: PI_AGENT_RUN_TEMPLATE_CODE,
      templateVersion: command.templateVersion,
      input: {
        skillId: command.skillId,
        skillIds: command.skillIds,
        prompt: command.prompt,
        title,
        conversationId: command.conversationId,
        userMessageId: command.userMessageId,
        assistantMessageId: command.assistantMessageId,
        context: command.context,
      },
      idempotencyKey:
        command.idempotencyKey ??
        (command.assistantMessageId
          ? `pi-agent-message:${command.userId}:${command.assistantMessageId}`
          : undefined),
    });
  }

  async startImpactMapping(command: StartImpactMappingCommand) {
    const eventLabel = command.input.eventId
      ? ` - ${command.input.eventId.slice(0, 8)}`
      : "";
    return this.startWorkflow({
      userId: command.userId,
      query: `影响映射 ${command.input.mode}${eventLabel}`,
      templateCode: IMPACT_MAPPING_TEMPLATE_CODE,
      templateVersion: command.templateVersion,
      input: command.input,
      idempotencyKey:
        command.idempotencyKey ??
        `impact-mapping:${command.userId}:${command.input.mode}:${command.input.baseRunId ?? command.input.baseSnapshotId ?? "latest"}:${command.input.eventId ?? "radar"}:${command.input.traceCursor ?? "current"}`,
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
      command.templateCode === INDUSTRY_RESEARCH_TEMPLATE_CODE &&
      command.templateVersion !== undefined &&
      command.templateVersion !== 3
    ) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_TEMPLATE_NOT_FOUND,
        `industry research 仅支持模板版本 3: ${command.templateVersion}`,
      );
    }

    if (command.idempotencyKey) {
      const existing = await this.repository.findPendingOrRunningByIdempotency(
        command.userId,
        command.idempotencyKey,
      );

      const requestedAssistantMessageId =
        command.templateCode === PI_AGENT_RUN_TEMPLATE_CODE &&
        isRecord(command.input) &&
        typeof command.input.assistantMessageId === "string"
          ? command.input.assistantMessageId
          : undefined;
      const existingAssistantMessageId =
        existing &&
        isRecord(existing.input) &&
        typeof existing.input.assistantMessageId === "string"
          ? existing.input.assistantMessageId
          : undefined;
      const idempotencyMatchesMessage =
        command.templateCode !== PI_AGENT_RUN_TEMPLATE_CODE ||
        !requestedAssistantMessageId ||
        existingAssistantMessageId === requestedAssistantMessageId;

      if (existing && idempotencyMatchesMessage) {
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
      command.templateCode === INDUSTRY_RESEARCH_TEMPLATE_CODE &&
      command.templateVersion === undefined &&
      (!template || template.version < 3)
    ) {
      template = await this.repository.ensureIndustryResearchTemplate();
    }

    if (
      command.templateCode === COMPANY_RESEARCH_TEMPLATE_CODE &&
      command.templateVersion === undefined &&
      (!template || template.version < 4)
    ) {
      template = await this.repository.ensureCompanyResearchTemplate();
    }

    if (!template && command.templateCode === INDUSTRY_RESEARCH_TEMPLATE_CODE) {
      template = await this.repository.ensureIndustryResearchTemplate();
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

    if (!template && command.templateCode === PI_AGENT_RUN_TEMPLATE_CODE) {
      template = await this.repository.ensurePiAgentRunTemplate();
    }

    if (!template && command.templateCode === IMPACT_MAPPING_TEMPLATE_CODE) {
      template = await this.repository.ensureImpactMappingTemplate();
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

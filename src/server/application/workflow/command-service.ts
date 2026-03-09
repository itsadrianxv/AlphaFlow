import { WorkflowRunStatus } from "~/generated/prisma";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  getWorkflowNodeKeysFromGraphConfig,
  QUICK_RESEARCH_TEMPLATE_CODE,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
  TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
} from "~/server/domain/workflow/types";
import type { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";

export type StartQuickResearchCommand = {
  userId: string;
  query: string;
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
  templateVersion?: number;
  idempotencyKey?: string;
};

export type StartWatchlistTimingCardsPipelineCommand = {
  userId: string;
  watchListId: string;
  asOfDate?: string;
  watchListName?: string;
  templateVersion?: number;
  idempotencyKey?: string;
};

export type StartWatchlistTimingPipelineCommand = {
  userId: string;
  watchListId: string;
  portfolioSnapshotId: string;
  asOfDate?: string;
  watchListName?: string;
  portfolioSnapshotName?: string;
  templateVersion?: number;
  idempotencyKey?: string;
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

export class WorkflowCommandService {
  constructor(private readonly repository: PrismaWorkflowRunRepository) {}

  async startQuickResearch(command: StartQuickResearchCommand) {
    return this.startWorkflow({
      userId: command.userId,
      query: command.query,
      templateCode: command.templateCode ?? QUICK_RESEARCH_TEMPLATE_CODE,
      templateVersion: command.templateVersion,
      input: {
        query: command.query,
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
      },
      idempotencyKey:
        command.idempotencyKey ??
        `timing-signal:${command.userId}:${command.stockCode}:${command.asOfDate ?? "latest"}`,
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
      },
      idempotencyKey:
        command.idempotencyKey ??
        `watchlist-timing-cards:${command.userId}:${command.watchListId}:${command.asOfDate ?? "latest"}`,
    });
  }

  async startWatchlistTimingPipeline(
    command: StartWatchlistTimingPipelineCommand,
  ) {
    return this.startWorkflow({
      userId: command.userId,
      query:
        command.watchListName && command.portfolioSnapshotName
          ? `自选股建议 - ${command.watchListName} / ${command.portfolioSnapshotName}`
          : `自选股建议 - ${command.watchListId}`,
      templateCode: WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
      templateVersion: command.templateVersion,
      input: {
        watchListId: command.watchListId,
        portfolioSnapshotId: command.portfolioSnapshotId,
        asOfDate: command.asOfDate,
      },
      idempotencyKey:
        command.idempotencyKey ??
        `watchlist-timing:${command.userId}:${command.watchListId}:${command.portfolioSnapshotId}:${command.asOfDate ?? "latest"}`,
    });
  }

  private async startWorkflow(command: StartWorkflowCommand) {
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
}

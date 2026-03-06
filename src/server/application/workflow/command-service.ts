import { WorkflowRunStatus } from "~/generated/prisma";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";
import { QUICK_RESEARCH_TEMPLATE_CODE } from "~/server/domain/workflow/types";
import { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";

export type StartQuickResearchCommand = {
  userId: string;
  query: string;
  templateCode?: string;
  templateVersion?: number;
  idempotencyKey?: string;
};

export class WorkflowCommandService {
  constructor(private readonly repository: PrismaWorkflowRunRepository) {}

  async startQuickResearch(command: StartQuickResearchCommand) {
    const templateCode = command.templateCode ?? QUICK_RESEARCH_TEMPLATE_CODE;

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
      templateCode,
      command.templateVersion,
    );

    if (!template && templateCode === QUICK_RESEARCH_TEMPLATE_CODE) {
      template = await this.repository.ensureQuickResearchTemplate();
    }

    if (!template) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_TEMPLATE_NOT_FOUND,
        `工作流模板不存在: ${templateCode}`,
      );
    }

    const run = await this.repository.createRun({
      templateId: template.id,
      userId: command.userId,
      query: command.query,
      input: {
        query: command.query,
      },
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

import type { WorkflowRunStatus } from "~/generated/prisma";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";
import type { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";

export class WorkflowQueryService {
  constructor(private readonly repository: PrismaWorkflowRunRepository) {}

  async getRun(userId: string, runId: string) {
    const run = await this.repository.getRunDetailForUser(runId, userId);

    if (!run) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.WORKFLOW_RUN_NOT_FOUND,
        `工作流运行不存在: ${runId}`,
      );
    }

    return {
      id: run.id,
      query: run.query,
      status: run.status,
      progressPercent: run.progressPercent,
      currentNodeKey: run.currentNodeKey,
      input: run.input,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      result: run.result,
      template: {
        code: run.template.code,
        version: run.template.version,
      },
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      nodes: run.nodeRuns.map((nodeRun) => ({
        id: nodeRun.id,
        nodeKey: nodeRun.nodeKey,
        agentName: nodeRun.agentName,
        attempt: nodeRun.attempt,
        status: nodeRun.status,
        errorCode: nodeRun.errorCode,
        errorMessage: nodeRun.errorMessage,
        durationMs: nodeRun.durationMs,
        startedAt: nodeRun.startedAt,
        completedAt: nodeRun.completedAt,
        output: nodeRun.output,
      })),
      events: run.events.map((event) => ({
        id: event.id,
        sequence: event.sequence,
        eventType: event.eventType,
        payload: event.payload,
        occurredAt: event.occurredAt,
      })),
    };
  }

  async listRuns(params: {
    userId: string;
    limit: number;
    cursor?: string;
    status?: WorkflowRunStatus;
    templateCode?: string;
  }) {
    const records = await this.repository.listRunsForUser(params);

    return {
      items: records.items.map((run) => ({
        id: run.id,
        query: run.query,
        status: run.status,
        progressPercent: run.progressPercent,
        currentNodeKey: run.currentNodeKey,
        errorCode: run.errorCode,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        templateCode: run.template.code,
        templateVersion: run.template.version,
        nodeCount: run.nodeRuns.length,
      })),
      nextCursor: records.nextCursor,
    };
  }
}

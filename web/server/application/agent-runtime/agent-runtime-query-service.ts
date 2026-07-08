import { PI_AGENT_RUN_TEMPLATE_CODE } from "~/server/domain/workflow/types";
import type { AgentRuntimeClient } from "~/server/infrastructure/agent-runtime/agent-runtime-client";
import type { PrismaAgentRuntimeRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-runtime-repository";
import type { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";

export class AgentRuntimeQueryService {
  constructor(
    private readonly workflowRepository: PrismaWorkflowRunRepository,
    private readonly agentRuntimeRepository: PrismaAgentRuntimeRepository,
    private readonly agentRuntimeClient: AgentRuntimeClient,
  ) {}

  async listSkills() {
    return this.agentRuntimeClient.listSkills();
  }

  async listRuns(params: {
    userId: string;
    limit: number;
    cursor?: string;
    search?: string;
  }) {
    const records = await this.workflowRepository.listRunsForUser({
      userId: params.userId,
      limit: params.limit,
      cursor: params.cursor,
      templateCode: PI_AGENT_RUN_TEMPLATE_CODE,
      search: params.search,
    });

    return {
      items: records.items.map((run) => ({
        id: run.id,
        query: run.query,
        status: run.status,
        progressPercent: run.progressPercent,
        currentNodeKey: run.currentNodeKey,
        errorCode: run.errorCode,
        errorMessage: run.errorMessage,
        createdAt: run.createdAt,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        templateCode: run.template.code,
        templateVersion: run.template.version,
      })),
      nextCursor: records.nextCursor,
    };
  }

  async getRun(userId: string, runId: string) {
    const run = await this.workflowRepository.getRunDetailForUser(runId, userId);

    if (!run || run.template.code !== PI_AGENT_RUN_TEMPLATE_CODE) {
      return null;
    }

    const [toolCalls, artifacts] = await Promise.all([
      this.agentRuntimeRepository.listToolCalls(run.id),
      this.agentRuntimeRepository.listArtifacts(run.id),
    ]);

    return {
      id: run.id,
      query: run.query,
      status: run.status,
      progressPercent: run.progressPercent,
      currentNodeKey: run.currentNodeKey,
      input: run.input,
      result: run.result,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      events: run.events.map((event) => ({
        id: event.id,
        sequence: event.sequence,
        eventType: event.eventType,
        payload: event.payload,
        occurredAt: event.occurredAt,
      })),
      toolCalls: toolCalls.map((toolCall) => ({
        id: toolCall.id,
        skillId: toolCall.skillId,
        externalToolCallId: toolCall.externalToolCallId,
        toolName: toolCall.toolName,
        inputSummary: toolCall.inputSummary,
        outputSummary: toolCall.outputSummary,
        status: toolCall.status,
        durationMs: toolCall.durationMs,
        errorCode: toolCall.errorCode,
        errorMessage: toolCall.errorMessage,
        createdAt: toolCall.createdAt,
      })),
      artifacts: artifacts.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        title: artifact.title,
        contentType: artifact.contentType,
        uri: artifact.uri,
        payload: artifact.payload,
        createdAt: artifact.createdAt,
      })),
    };
  }
}

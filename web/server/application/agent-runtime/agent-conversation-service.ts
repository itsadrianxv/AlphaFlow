import type { WorkflowCommandService } from "~/server/application/workflow/command-service";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";
import type { PrismaAgentConversationRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-conversation-repository";

export class AgentConversationService {
  constructor(
    private readonly conversationRepository: PrismaAgentConversationRepository,
    private readonly workflowCommandService: WorkflowCommandService,
  ) {}

  async sendMessage(params: {
    userId: string;
    conversationId?: string;
    prompt: string;
    skillId: string;
    title?: string;
    context?: Record<string, unknown>;
    idempotencyKey?: string;
  }) {
    let turn: Awaited<
      ReturnType<PrismaAgentConversationRepository["createTurn"]>
    >;

    try {
      turn = await this.conversationRepository.createTurn({
        userId: params.userId,
        conversationId: params.conversationId,
        prompt: params.prompt,
        skillId: params.skillId,
        title: params.title,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "AGENT_CONVERSATION_BUSY"
      ) {
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.WORKFLOW_INVALID_STATUS_TRANSITION,
          "上一条回复仍在生成，请稍后再发送。",
        );
      }
      throw error;
    }

    const result = await this.workflowCommandService.startPiAgentRun({
      userId: params.userId,
      skillId: params.skillId,
      prompt: params.prompt,
      title: params.title,
      conversationId: turn.conversation.id,
      userMessageId: turn.userMessage.id,
      assistantMessageId: turn.assistantMessage.id,
      context: params.context,
      idempotencyKey:
        params.idempotencyKey ??
        `pi-agent-message:${params.userId}:${turn.assistantMessage.id}`,
    });

    await this.conversationRepository.bindAssistantRun({
      messageId: turn.assistantMessage.id,
      runId: result.runId,
    });
    await this.conversationRepository.markAssistantStreaming(
      turn.assistantMessage.id,
    );

    return {
      conversationId: turn.conversation.id,
      runId: result.runId,
      userMessageId: turn.userMessage.id,
      assistantMessageId: turn.assistantMessage.id,
      status: result.status,
      createdAt: result.createdAt,
    };
  }
}

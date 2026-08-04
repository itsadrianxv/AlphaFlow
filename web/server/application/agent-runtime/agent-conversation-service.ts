import type { UserSkillRuntimeDefinition } from "~/server/application/agent-runtime/user-skill-service";
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
    skillIds: string[];
    title?: string;
    context?: Record<string, unknown>;
    userSkillDefinitions?: UserSkillRuntimeDefinition[];
    routingMode?: "AUTO" | "SCHEDULED_TASK_SETUP" | "SCHEDULED_TASK_EDIT";
    scheduledTaskEditTaskId?: string;
    idempotencyKey?: string;
  }) {
    if (params.conversationId) {
      const resumed = await this.conversationRepository.resumeWaitingForInput({
        userId: params.userId,
        conversationId: params.conversationId,
        prompt: params.prompt,
        skillId: params.skillId,
      });

      if (resumed) {
        return {
          conversationId: resumed.conversation.id,
          runId: resumed.run.id,
          userMessageId: resumed.userMessage.id,
          assistantMessageId: resumed.assistantMessage.id,
          status: "PENDING",
          createdAt: resumed.run.createdAt,
        };
      }
    }

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
        routingMode: params.routingMode,
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

    if (params.scheduledTaskEditTaskId) {
      await this.conversationRepository.bindScheduledTaskEdit({
        userId: params.userId,
        conversationId: turn.conversation.id,
        taskId: params.scheduledTaskEditTaskId,
      });
    }

    const result = await this.workflowCommandService.startPiAgentRun({
      userId: params.userId,
      skillId: params.skillId,
      skillIds: params.skillIds,
      prompt: params.prompt,
      title: params.title,
      conversationId: turn.conversation.id,
      userMessageId: turn.userMessage.id,
      assistantMessageId: turn.assistantMessage.id,
      context: params.context,
      userSkillDefinitions: params.userSkillDefinitions,
      idempotencyKey:
        params.idempotencyKey ??
        `pi-agent-message:${params.userId}:${turn.assistantMessage.id}`,
    });

    try {
      await this.conversationRepository.bindAssistantRun({
        messageId: turn.assistantMessage.id,
        runId: result.runId,
      });
      await this.conversationRepository.markAssistantStreaming(
        turn.assistantMessage.id,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "AGENT_WORKFLOW_RUN_ALREADY_BOUND"
      ) {
        await this.conversationRepository.markAssistantFailed({
          messageId: turn.assistantMessage.id,
          status: "FAILED",
          errorCode: "WORKFLOW_RUN_ALREADY_BOUND",
          errorMessage: "该工作流运行已绑定到其他对话",
        });
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.WORKFLOW_INVALID_STATUS_TRANSITION,
          "该工作流运行已绑定到其他对话，请重新发送消息。",
        );
      }
      throw error;
    }

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

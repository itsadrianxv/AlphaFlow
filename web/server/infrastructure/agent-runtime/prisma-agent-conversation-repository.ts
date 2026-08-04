import {
  Prisma,
  type PrismaClient,
  WorkflowEventType,
  WorkflowNodeRunStatus,
  WorkflowRunStatus,
} from "@prisma/client";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;
const AgentConversationStatus = {
  ACTIVE: "ACTIVE",
} as const;
const AgentConversationMessageRole = {
  USER: "USER",
  ASSISTANT: "ASSISTANT",
} as const;
const AgentConversationMessageStatus = {
  PENDING: "PENDING",
  STREAMING: "STREAMING",
  WAITING_FOR_INPUT: "WAITING_FOR_INPUT",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export class PrismaAgentConversationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listConversations(params: {
    userId: string;
    limit: number;
    cursor?: string;
    search?: string;
  }) {
    const items = await this.prisma.agentConversation.findMany({
      where: {
        userId: params.userId,
        status: AgentConversationStatus.ACTIVE,
        ...(params.search
          ? {
              title: {
                contains: params.search,
                mode: "insensitive",
              },
            }
          : {}),
      },
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      include: {
        messages: {
          orderBy: { sequence: "desc" },
          take: 1,
        },
      },
    });

    const hasNext = items.length > params.limit;
    const pageItems = hasNext ? items.slice(0, params.limit) : items;

    return {
      items: pageItems,
      nextCursor: hasNext ? pageItems.at(-1)?.id : undefined,
    };
  }

  async getConversation(userId: string, conversationId: string) {
    return this.prisma.agentConversation.findFirst({
      where: {
        id: conversationId,
        userId,
      },
      include: {
        messages: {
          orderBy: { sequence: "asc" },
        },
      },
    });
  }

  async createConversation(params: { userId: string; title: string }) {
    return this.prisma.agentConversation
      .create({
        data: {
          userId: params.userId,
          title: params.title,
          piSessionId: "",
        },
      })
      .then((conversation) =>
        this.prisma.agentConversation.update({
          where: { id: conversation.id },
          data: { piSessionId: conversation.id },
          include: { messages: { orderBy: { sequence: "asc" } } },
        }),
      );
  }

  async getSeedMessages(conversationId: string) {
    const messages = await this.prisma.agentConversationMessage.findMany({
      where: {
        conversationId,
        status: {
          in: [
            AgentConversationMessageStatus.SUCCEEDED,
            AgentConversationMessageStatus.STREAMING,
            AgentConversationMessageStatus.WAITING_FOR_INPUT,
          ],
        },
      },
      orderBy: { sequence: "asc" },
    });

    return messages
      .filter((message) => message.content.trim())
      .map((message) => ({
        role:
          message.role === AgentConversationMessageRole.USER
            ? ("user" as const)
            : ("assistant" as const),
        content: message.content,
        skillId: message.skillId ?? undefined,
      }));
  }

  async createTurn(params: {
    userId: string;
    conversationId?: string;
    prompt: string;
    skillId: string;
    title?: string;
    routingMode?: "AUTO" | "SCHEDULED_TASK_SETUP" | "SCHEDULED_TASK_EDIT";
  }) {
    return this.prisma.$transaction(async (tx) => {
      let conversation = params.conversationId
        ? await tx.agentConversation.findFirst({
            where: {
              id: params.conversationId,
              userId: params.userId,
            },
          })
        : null;

      if (!conversation) {
        const created = await tx.agentConversation.create({
          data: {
            userId: params.userId,
            title: params.title ?? params.prompt.slice(0, 80),
            piSessionId: "",
            lastMessageAt: new Date(),
            routingMode: params.routingMode ?? "AUTO",
          },
        });
        conversation = await tx.agentConversation.update({
          where: { id: created.id },
          data: { piSessionId: created.id },
        });
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "AgentConversation" WHERE "id" = ${conversation.id} AND "userId" = ${params.userId} FOR UPDATE`,
      );

      const runningAssistant = await tx.agentConversationMessage.findFirst({
        where: {
          conversationId: conversation.id,
          role: AgentConversationMessageRole.ASSISTANT,
          status: {
            in: [
              AgentConversationMessageStatus.PENDING,
              AgentConversationMessageStatus.STREAMING,
            ],
          },
        },
      });

      if (runningAssistant) {
        throw new Error("AGENT_CONVERSATION_BUSY");
      }

      const lastMessage = await tx.agentConversationMessage.findFirst({
        where: { conversationId: conversation.id },
        orderBy: { sequence: "desc" },
      });
      const userSequence = (lastMessage?.sequence ?? 0) + 1;
      const assistantSequence = userSequence + 1;
      const now = new Date();

      if (
        params.routingMode &&
        conversation.routingMode !== params.routingMode
      ) {
        conversation = await tx.agentConversation.update({
          where: { id: conversation.id },
          data: { routingMode: params.routingMode },
        });
      }

      const userMessage = await tx.agentConversationMessage.create({
        data: {
          conversationId: conversation.id,
          role: AgentConversationMessageRole.USER,
          content: params.prompt,
          skillId: params.skillId,
          status: AgentConversationMessageStatus.SUCCEEDED,
          sequence: userSequence,
        },
      });
      const assistantMessage = await tx.agentConversationMessage.create({
        data: {
          conversationId: conversation.id,
          role: AgentConversationMessageRole.ASSISTANT,
          content: "",
          skillId: params.skillId,
          status: AgentConversationMessageStatus.PENDING,
          sequence: assistantSequence,
        },
      });

      await tx.agentConversation.update({
        where: { id: conversation.id },
        data: {
          title: conversation.title || params.prompt.slice(0, 80),
          lastMessageAt: now,
        },
      });

      return { conversation, userMessage, assistantMessage };
    });
  }

  async bindScheduledTaskEdit(params: {
    userId: string;
    conversationId: string;
    taskId: string;
  }) {
    const updated = await this.prisma.agentConversation.updateMany({
      where: { id: params.conversationId, userId: params.userId },
      data: {
        routingMode: "SCHEDULED_TASK_EDIT",
        activeScheduledTaskEditTaskId: params.taskId,
      },
    });
    if (updated.count !== 1) throw new Error("AGENT_CONVERSATION_NOT_FOUND");
  }

  async resumeWaitingForInput(params: {
    userId: string;
    conversationId: string;
    prompt: string;
    skillId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "AgentConversation" WHERE "id" = ${params.conversationId} AND "userId" = ${params.userId} FOR UPDATE`,
      );

      const waitingMessage = await tx.agentConversationMessage.findFirst({
        where: {
          conversationId: params.conversationId,
          role: AgentConversationMessageRole.ASSISTANT,
          status: AgentConversationMessageStatus.WAITING_FOR_INPUT,
        },
        orderBy: { sequence: "desc" },
      });

      if (!waitingMessage?.workflowRunId) {
        return null;
      }

      const latestMessage = await tx.agentConversationMessage.findFirst({
        where: { conversationId: params.conversationId },
        orderBy: { sequence: "desc" },
        select: { id: true },
      });
      if (latestMessage?.id !== waitingMessage.id) {
        return null;
      }

      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "WorkflowRun" WHERE "id" = ${waitingMessage.workflowRunId} FOR UPDATE`,
      );
      const run = await tx.workflowRun.findUnique({
        where: { id: waitingMessage.workflowRunId },
      });

      if (
        !run ||
        run.status !== WorkflowRunStatus.PAUSED ||
        run.cancellationRequestedAt
      ) {
        await tx.agentConversationMessage.update({
          where: { id: waitingMessage.id },
          data: {
            status: AgentConversationMessageStatus.FAILED,
            errorCode: "AGENT_WAITING_RUN_NOT_RESUMABLE",
            errorMessage: "原工作流已不可恢复，已创建新的对话轮次。",
          },
        });
        return null;
      }

      const pausedEvent = await tx.workflowEvent.findFirst({
        where: {
          runId: run.id,
          eventType: WorkflowEventType.RUN_PAUSED,
        },
        orderBy: { sequence: "desc" },
      });
      const pausedPayload = asRecord(pausedEvent?.payload);
      if (pausedPayload.reason !== "user_input_required") {
        await tx.agentConversationMessage.update({
          where: { id: waitingMessage.id },
          data: {
            status: AgentConversationMessageStatus.FAILED,
            errorCode: "AGENT_WAITING_RUN_NOT_RESUMABLE",
            errorMessage: "原工作流已不可恢复，已创建新的对话轮次。",
          },
        });
        return null;
      }

      const lastMessage = await tx.agentConversationMessage.findFirst({
        where: { conversationId: params.conversationId },
        orderBy: { sequence: "desc" },
      });
      const userSequence = (lastMessage?.sequence ?? 0) + 1;
      const assistantSequence = userSequence + 1;
      const now = new Date();
      const input = asRecord(run.input);

      const userMessage = await tx.agentConversationMessage.create({
        data: {
          conversationId: params.conversationId,
          role: AgentConversationMessageRole.USER,
          content: params.prompt,
          skillId: waitingMessage.skillId ?? params.skillId,
          status: "SUCCEEDED",
          sequence: userSequence,
        },
      });
      await tx.agentConversationMessage.update({
        where: { id: waitingMessage.id },
        data: { workflowRunId: null },
      });
      const assistantMessage = await tx.agentConversationMessage.create({
        data: {
          conversationId: params.conversationId,
          role: AgentConversationMessageRole.ASSISTANT,
          content: "",
          skillId: waitingMessage.skillId ?? params.skillId,
          status: "PENDING",
          workflowRunId: run.id,
          sequence: assistantSequence,
        },
      });

      await tx.workflowRun.update({
        where: { id: run.id },
        data: {
          status: WorkflowRunStatus.PENDING,
          input: toJson({
            ...input,
            prompt: params.prompt,
            userMessageId: userMessage.id,
            assistantMessageId: assistantMessage.id,
          }),
          cancellationRequestedAt: null,
          completedAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });

      await tx.workflowNodeRun.updateMany({
        where: {
          runId: run.id,
          ...(run.currentNodeKey ? { nodeKey: run.currentNodeKey } : {}),
          status: WorkflowNodeRunStatus.WAITING_FOR_INPUT,
        },
        data: {
          status: WorkflowNodeRunStatus.PENDING,
          completedAt: null,
          errorCode: null,
          errorMessage: null,
        },
      });

      await this.createWorkflowEventTx(tx, {
        runId: run.id,
        eventType: WorkflowEventType.RUN_RESUMED,
        payload: {
          reason: "user_input_required",
          nodeKey: run.currentNodeKey,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
        },
      });

      const conversation = await tx.agentConversation.update({
        where: { id: params.conversationId },
        data: { lastMessageAt: now },
      });

      return { conversation, userMessage, assistantMessage, run };
    });
  }

  async markAssistantStreaming(messageId: string) {
    return this.prisma.agentConversationMessage.updateMany({
      where: {
        id: messageId,
        status: {
          in: [
            AgentConversationMessageStatus.PENDING,
            AgentConversationMessageStatus.STREAMING,
          ],
        },
      },
      data: { status: AgentConversationMessageStatus.STREAMING },
    });
  }

  async bindAssistantRun(params: { messageId: string; runId: string }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "WorkflowRun" WHERE "id" = ${params.runId} FOR UPDATE`,
      );

      const message = await tx.agentConversationMessage.findUnique({
        where: { id: params.messageId },
      });

      if (!message) {
        throw new Error("AGENT_MESSAGE_NOT_FOUND");
      }

      if (message.workflowRunId && message.workflowRunId !== params.runId) {
        throw new Error("AGENT_MESSAGE_ALREADY_BOUND");
      }

      const existingBinding = await tx.agentConversationMessage.findFirst({
        where: {
          workflowRunId: params.runId,
          role: AgentConversationMessageRole.ASSISTANT,
        },
        select: { id: true },
      });

      if (existingBinding && existingBinding.id !== params.messageId) {
        throw new Error("AGENT_WORKFLOW_RUN_ALREADY_BOUND");
      }

      return tx.agentConversationMessage.update({
        where: { id: params.messageId },
        data: { workflowRunId: params.runId },
      });
    });
  }

  async appendAssistantDelta(messageId: string, delta: string) {
    if (!delta) {
      return null;
    }

    return this.prisma.$transaction(async (tx) => {
      const message = await tx.agentConversationMessage.findUnique({
        where: { id: messageId },
      });
      if (!message) {
        return null;
      }

      if (
        message.status !== AgentConversationMessageStatus.PENDING &&
        message.status !== AgentConversationMessageStatus.STREAMING
      ) {
        return null;
      }

      return tx.agentConversationMessage.update({
        where: { id: messageId },
        data: {
          status: AgentConversationMessageStatus.STREAMING,
          content: `${message.content}${delta}`,
        },
      });
    });
  }

  async markAssistantSucceeded(params: {
    messageId: string;
    content: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.prisma.agentConversationMessage.updateMany({
      where: {
        id: params.messageId,
        status: {
          in: [
            AgentConversationMessageStatus.PENDING,
            AgentConversationMessageStatus.STREAMING,
          ],
        },
      },
      data: {
        content: params.content,
        status: AgentConversationMessageStatus.SUCCEEDED,
        metadata: params.metadata ? toJson(params.metadata) : undefined,
        errorCode: null,
        errorMessage: null,
      },
    });
  }

  async markAssistantFailed(params: {
    messageId: string;
    status: "FAILED" | "CANCELLED";
    errorCode?: string;
    errorMessage?: string;
  }) {
    return this.prisma.agentConversationMessage.updateMany({
      where: {
        id: params.messageId,
        status: {
          in: [
            AgentConversationMessageStatus.PENDING,
            AgentConversationMessageStatus.STREAMING,
          ],
        },
      },
      data: {
        status:
          params.status === "CANCELLED"
            ? AgentConversationMessageStatus.CANCELLED
            : AgentConversationMessageStatus.FAILED,
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
      },
    });
  }

  async markAssistantWaitingByRun(
    runId: string,
    request: {
      question: string;
      options?: Array<{ label: string; value: string }>;
    },
  ) {
    return this.prisma.agentConversationMessage.updateMany({
      where: {
        workflowRunId: runId,
        role: AgentConversationMessageRole.ASSISTANT,
        status: {
          in: [
            AgentConversationMessageStatus.PENDING,
            AgentConversationMessageStatus.STREAMING,
          ],
        },
      },
      data: {
        content: request.question,
        status: AgentConversationMessageStatus.WAITING_FOR_INPUT,
        metadata: toJson({
          inputRequest: request,
          question: request.question,
          options: request.options ?? [],
        }),
        errorCode: null,
        errorMessage: null,
      },
    });
  }

  async markAssistantCancelledByRun(runId: string, reason: string) {
    return this.prisma.agentConversationMessage.updateMany({
      where: {
        workflowRunId: runId,
        role: AgentConversationMessageRole.ASSISTANT,
        status: {
          in: [
            AgentConversationMessageStatus.PENDING,
            AgentConversationMessageStatus.STREAMING,
            AgentConversationMessageStatus.WAITING_FOR_INPUT,
          ],
        },
      },
      data: {
        status: AgentConversationMessageStatus.CANCELLED,
        errorCode: "PI_AGENT_CANCELLED",
        errorMessage: reason,
      },
    });
  }

  async markAssistantFailedByRun(
    runId: string,
    reason: string,
    errorCode = "WORKFLOW_NODE_TIMEOUT",
  ) {
    return this.prisma.agentConversationMessage.updateMany({
      where: {
        workflowRunId: runId,
        role: AgentConversationMessageRole.ASSISTANT,
        status: {
          in: [
            AgentConversationMessageStatus.PENDING,
            AgentConversationMessageStatus.STREAMING,
            AgentConversationMessageStatus.WAITING_FOR_INPUT,
          ],
        },
      },
      data: {
        status: AgentConversationMessageStatus.FAILED,
        errorCode,
        errorMessage: reason,
      },
    });
  }

  private async createWorkflowEventTx(
    tx: Prisma.TransactionClient,
    params: {
      runId: string;
      eventType: WorkflowEventType;
      payload: Record<string, unknown>;
    },
  ) {
    await tx.$queryRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${params.runId}, 0))::text`,
    );
    const latest = await tx.workflowEvent.findFirst({
      where: { runId: params.runId },
      select: { sequence: true },
      orderBy: { sequence: "desc" },
    });

    return tx.workflowEvent.create({
      data: {
        runId: params.runId,
        sequence: (latest?.sequence ?? 0) + 1,
        eventType: params.eventType,
        payload: toJson(params.payload),
        occurredAt: new Date(),
      },
    });
  }
}

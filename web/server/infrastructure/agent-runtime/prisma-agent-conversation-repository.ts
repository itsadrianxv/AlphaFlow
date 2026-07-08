import type { Prisma, PrismaClient } from "@prisma/client";
import { PI_AGENT_RUN_TEMPLATE_CODE } from "~/server/domain/workflow/types";

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
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;
const WorkflowRunStatus = {
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

function readTextPayload(value: unknown) {
  if (!value || typeof value !== "object") {
    return "";
  }

  const payload = value as Record<string, unknown>;
  if (typeof payload.text === "string") {
    return payload.text.trim();
  }

  return "";
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

  async createConversation(params: {
    userId: string;
    title: string;
    legacyWorkflowRunId?: string;
  }) {
    return this.prisma.agentConversation
      .create({
        data: {
          userId: params.userId,
          title: params.title,
          piSessionId: "",
          legacyWorkflowRunId: params.legacyWorkflowRunId,
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
          },
        });
        conversation = await tx.agentConversation.update({
          where: { id: created.id },
          data: { piSessionId: created.id },
        });
      }

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

  async markAssistantStreaming(messageId: string) {
    return this.prisma.agentConversationMessage.update({
      where: { id: messageId },
      data: { status: AgentConversationMessageStatus.STREAMING },
    });
  }

  async bindAssistantRun(params: { messageId: string; runId: string }) {
    return this.prisma.agentConversationMessage.update({
      where: { id: params.messageId },
      data: { workflowRunId: params.runId },
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
    return this.prisma.agentConversationMessage.update({
      where: { id: params.messageId },
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
    return this.prisma.agentConversationMessage.update({
      where: { id: params.messageId },
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

  async markAssistantCancelledByRun(runId: string, reason: string) {
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
        status: AgentConversationMessageStatus.CANCELLED,
        errorCode: "PI_AGENT_CANCELLED",
        errorMessage: reason,
      },
    });
  }

  async migrateLegacyRuns(userId: string, limit = 50) {
    const runs = await this.prisma.workflowRun.findMany({
      where: {
        userId,
        template: { code: PI_AGENT_RUN_TEMPLATE_CODE },
        legacyAgentConversation: null,
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      include: {
        agentArtifacts: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    let migrated = 0;
    for (const run of runs) {
      const input =
        run.input && typeof run.input === "object"
          ? (run.input as Record<string, unknown>)
          : {};
      const prompt =
        typeof input.prompt === "string" ? input.prompt : run.query;
      const skillId =
        typeof input.skillId === "string" ? input.skillId : undefined;
      const artifact = run.agentArtifacts.find(
        (item) => item.kind === "report" && item.payload,
      );
      const assistantText =
        readTextPayload(artifact?.payload) ||
        readTextPayload(
          run.result && typeof run.result === "object"
            ? (run.result as Record<string, unknown>).finalOutput
            : undefined,
        );
      const title = run.query.replace(/^Pi Agent - /, "").slice(0, 120);

      await this.prisma.$transaction(async (tx) => {
        const created = await tx.agentConversation.create({
          data: {
            userId,
            title,
            piSessionId: "",
            legacyWorkflowRunId: run.id,
            lastMessageAt: run.completedAt ?? run.createdAt,
          },
        });
        const conversation = await tx.agentConversation.update({
          where: { id: created.id },
          data: { piSessionId: created.id },
        });
        await tx.agentConversationMessage.create({
          data: {
            conversationId: conversation.id,
            role: AgentConversationMessageRole.USER,
            content: prompt,
            skillId,
            status: AgentConversationMessageStatus.SUCCEEDED,
            sequence: 1,
            createdAt: run.createdAt,
          },
        });
        await tx.agentConversationMessage.create({
          data: {
            conversationId: conversation.id,
            role: AgentConversationMessageRole.ASSISTANT,
            content: assistantText,
            skillId,
            status:
              run.status === WorkflowRunStatus.CANCELLED
                ? AgentConversationMessageStatus.CANCELLED
                : run.status === WorkflowRunStatus.FAILED
                  ? AgentConversationMessageStatus.FAILED
                  : AgentConversationMessageStatus.SUCCEEDED,
            workflowRunId: run.id,
            sequence: 2,
            errorCode: run.errorCode,
            errorMessage: run.errorMessage,
            createdAt: run.completedAt ?? run.createdAt,
          },
        });
      });
      migrated += 1;
    }

    return { migrated };
  }
}

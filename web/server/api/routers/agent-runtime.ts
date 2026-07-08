import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { AgentConversationService } from "~/server/application/agent-runtime/agent-conversation-service";
import { AgentRuntimeCommandService } from "~/server/application/agent-runtime/agent-runtime-command-service";
import { AgentRuntimeQueryService } from "~/server/application/agent-runtime/agent-runtime-query-service";
import { WorkflowCommandService } from "~/server/application/workflow/command-service";
import { isWorkflowDomainError } from "~/server/domain/workflow/errors";
import { AgentRuntimeClient } from "~/server/infrastructure/agent-runtime/agent-runtime-client";
import { PrismaAgentConversationRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-conversation-repository";
import { PrismaAgentRuntimeRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-runtime-repository";
import { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";

function mapError(error: unknown): TRPCError {
  if (error instanceof TRPCError) {
    return error;
  }

  if (isWorkflowDomainError(error)) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: error.message,
    });
  }

  if (error instanceof Error) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  }

  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "未知 agent-runtime 错误",
  });
}

const startRunInput = z.object({
  skillId: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  title: z.string().trim().min(1).max(120).optional(),
  conversationId: z.string().cuid().optional(),
  userMessageId: z.string().cuid().optional(),
  assistantMessageId: z.string().cuid().optional(),
  context: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const listRunsInput = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().cuid().optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

const runIdInput = z.object({
  runId: z.string().cuid(),
});

const conversationListInput = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().cuid().optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

const conversationIdInput = z.object({
  conversationId: z.string().cuid(),
});

const sendMessageInput = z.object({
  conversationId: z.string().cuid().optional(),
  skillId: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
  title: z.string().trim().min(1).max(120).optional(),
  context: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const agentRuntimeRouter = createTRPCRouter({
  listSkills: protectedProcedure.query(async ({ ctx }) => {
    try {
      const client = new AgentRuntimeClient();
      const workflowRepository = new PrismaWorkflowRunRepository(ctx.db);
      const agentRuntimeRepository = new PrismaAgentRuntimeRepository(ctx.db);
      const queryService = new AgentRuntimeQueryService(
        workflowRepository,
        agentRuntimeRepository,
        client,
      );

      return await queryService.listSkills();
    } catch (error) {
      throw mapError(error);
    }
  }),

  listConversations: protectedProcedure
    .input(conversationListInput)
    .query(async ({ ctx, input }) => {
      try {
        const repository = new PrismaAgentConversationRepository(ctx.db);
        return await repository.listConversations({
          userId: ctx.session.user.id,
          limit: input.limit,
          cursor: input.cursor,
          search: input.search,
        });
      } catch (error) {
        throw mapError(error);
      }
    }),

  getConversation: protectedProcedure
    .input(conversationIdInput)
    .query(async ({ ctx, input }) => {
      try {
        const repository = new PrismaAgentConversationRepository(ctx.db);
        const conversation = await repository.getConversation(
          ctx.session.user.id,
          input.conversationId,
        );

        if (!conversation) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Pi agent 对话不存在",
          });
        }

        return conversation;
      } catch (error) {
        throw mapError(error);
      }
    }),

  sendMessage: protectedProcedure
    .input(sendMessageInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const agentRuntimeClient = new AgentRuntimeClient();
        const skills = await agentRuntimeClient.listSkills();
        const skill = skills.items.find((item) => item.id === input.skillId);
        if (!skill) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Skill 不存在: ${input.skillId}`,
          });
        }

        const workflowRepository = new PrismaWorkflowRunRepository(ctx.db);
        const conversationRepository = new PrismaAgentConversationRepository(
          ctx.db,
        );
        const workflowCommandService = new WorkflowCommandService(
          workflowRepository,
        );
        const service = new AgentConversationService(
          conversationRepository,
          workflowCommandService,
        );

        return await service.sendMessage({
          userId: ctx.session.user.id,
          conversationId: input.conversationId,
          skillId: input.skillId,
          prompt: input.prompt,
          title: input.title,
          context: input.context,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw mapError(error);
      }
    }),

  ensureLegacyRunsMigrated: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      const repository = new PrismaAgentConversationRepository(ctx.db);
      return await repository.migrateLegacyRuns(ctx.session.user.id);
    } catch (error) {
      throw mapError(error);
    }
  }),

  startRun: protectedProcedure
    .input(startRunInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const agentRuntimeClient = new AgentRuntimeClient();
        const skills = await agentRuntimeClient.listSkills();
        const skill = skills.items.find((item) => item.id === input.skillId);
        if (!skill) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Skill 不存在: ${input.skillId}`,
          });
        }

        const workflowRepository = new PrismaWorkflowRunRepository(ctx.db);
        const workflowCommandService = new WorkflowCommandService(
          workflowRepository,
        );
        const commandService = new AgentRuntimeCommandService(
          workflowCommandService,
        );

        return await commandService.startRun({
          userId: ctx.session.user.id,
          skillId: input.skillId,
          prompt: input.prompt,
          title: input.title,
          conversationId: input.conversationId,
          userMessageId: input.userMessageId,
          assistantMessageId: input.assistantMessageId,
          context: input.context,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw mapError(error);
      }
    }),

  listRuns: protectedProcedure
    .input(listRunsInput)
    .query(async ({ ctx, input }) => {
      try {
        const workflowRepository = new PrismaWorkflowRunRepository(ctx.db);
        const agentRuntimeRepository = new PrismaAgentRuntimeRepository(ctx.db);
        const queryService = new AgentRuntimeQueryService(
          workflowRepository,
          agentRuntimeRepository,
          new AgentRuntimeClient(),
        );

        return await queryService.listRuns({
          userId: ctx.session.user.id,
          limit: input.limit,
          cursor: input.cursor,
          search: input.search,
        });
      } catch (error) {
        throw mapError(error);
      }
    }),

  getRun: protectedProcedure.input(runIdInput).query(async ({ ctx, input }) => {
    try {
      const workflowRepository = new PrismaWorkflowRunRepository(ctx.db);
      const agentRuntimeRepository = new PrismaAgentRuntimeRepository(ctx.db);
      const queryService = new AgentRuntimeQueryService(
        workflowRepository,
        agentRuntimeRepository,
        new AgentRuntimeClient(),
      );
      const run = await queryService.getRun(ctx.session.user.id, input.runId);

      if (!run) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pi agent 运行不存在",
        });
      }

      return run;
    } catch (error) {
      throw mapError(error);
    }
  }),

  cancelRun: protectedProcedure
    .input(runIdInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const workflowRepository = new PrismaWorkflowRunRepository(ctx.db);
        const workflowCommandService = new WorkflowCommandService(
          workflowRepository,
        );
        const commandService = new AgentRuntimeCommandService(
          workflowCommandService,
        );

        const result = await commandService.cancelRun(
          ctx.session.user.id,
          input.runId,
        );

        await new AgentRuntimeClient().cancelRun(input.runId).catch(() => null);
        await new PrismaAgentConversationRepository(
          ctx.db,
        ).markAssistantCancelledByRun(input.runId, "用户已请求取消");
        return result;
      } catch (error) {
        throw mapError(error);
      }
    }),
});

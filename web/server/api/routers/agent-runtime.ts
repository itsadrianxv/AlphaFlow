import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { AgentRuntimeCommandService } from "~/server/application/agent-runtime/agent-runtime-command-service";
import { AgentRuntimeQueryService } from "~/server/application/agent-runtime/agent-runtime-query-service";
import { WorkflowCommandService } from "~/server/application/workflow/command-service";
import { isWorkflowDomainError } from "~/server/domain/workflow/errors";
import { AgentRuntimeClient } from "~/server/infrastructure/agent-runtime/agent-runtime-client";
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
        return result;
      } catch (error) {
        throw mapError(error);
      }
    }),
});

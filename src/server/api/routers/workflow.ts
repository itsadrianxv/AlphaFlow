import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { WorkflowRunStatus } from "~/generated/prisma";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { WorkflowCommandService } from "~/server/application/workflow/command-service";
import { WorkflowQueryService } from "~/server/application/workflow/query-service";
import {
  isWorkflowDomainError,
  WORKFLOW_ERROR_CODES,
} from "~/server/domain/workflow/errors";
import { QUICK_RESEARCH_TEMPLATE_CODE } from "~/server/domain/workflow/types";
import { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";

function mapWorkflowError(error: unknown): TRPCError {
  if (isWorkflowDomainError(error)) {
    if (error.code === WORKFLOW_ERROR_CODES.WORKFLOW_TEMPLATE_NOT_FOUND) {
      return new TRPCError({ code: "NOT_FOUND", message: error.message });
    }

    if (error.code === WORKFLOW_ERROR_CODES.WORKFLOW_RUN_NOT_FOUND) {
      return new TRPCError({ code: "NOT_FOUND", message: error.message });
    }

    if (error.code === WORKFLOW_ERROR_CODES.WORKFLOW_RUN_FORBIDDEN) {
      return new TRPCError({ code: "FORBIDDEN", message: error.message });
    }

    if (error.code === WORKFLOW_ERROR_CODES.WORKFLOW_CANCEL_NOT_ALLOWED) {
      return new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }

    return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
  }

  if (error instanceof TRPCError) {
    return error;
  }

  if (error instanceof Error) {
    return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
  }

  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "未知错误" });
}

const startQuickResearchInput = z.object({
  query: z.string().min(1, "query 不能为空"),
  templateCode: z.string().default(QUICK_RESEARCH_TEMPLATE_CODE),
  templateVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const getRunInput = z.object({
  runId: z.string().cuid(),
});

const listRunsInput = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().cuid().optional(),
  status: z.nativeEnum(WorkflowRunStatus).optional(),
});

const cancelRunInput = z.object({
  runId: z.string().cuid(),
});

export const workflowRouter = createTRPCRouter({
  startQuickResearch: protectedProcedure
    .input(startQuickResearchInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWorkflowRunRepository(ctx.db);
        const commandService = new WorkflowCommandService(repository);

        return await commandService.startQuickResearch({
          userId: ctx.session.user.id,
          query: input.query,
          templateCode: input.templateCode,
          templateVersion: input.templateVersion,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw mapWorkflowError(error);
      }
    }),

  getRun: protectedProcedure.input(getRunInput).query(async ({ ctx, input }) => {
    try {
      const repository = new PrismaWorkflowRunRepository(ctx.db);
      const queryService = new WorkflowQueryService(repository);

      return await queryService.getRun(ctx.session.user.id, input.runId);
    } catch (error) {
      throw mapWorkflowError(error);
    }
  }),

  listRuns: protectedProcedure
    .input(listRunsInput)
    .query(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWorkflowRunRepository(ctx.db);
        const queryService = new WorkflowQueryService(repository);

        return await queryService.listRuns({
          userId: ctx.session.user.id,
          limit: input.limit,
          cursor: input.cursor,
          status: input.status,
        });
      } catch (error) {
        throw mapWorkflowError(error);
      }
    }),

  cancelRun: protectedProcedure
    .input(cancelRunInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWorkflowRunRepository(ctx.db);
        const commandService = new WorkflowCommandService(repository);

        return await commandService.cancelRun(ctx.session.user.id, input.runId);
      } catch (error) {
        throw mapWorkflowError(error);
      }
    }),
});

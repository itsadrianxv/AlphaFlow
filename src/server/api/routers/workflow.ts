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
import {
  QUICK_RESEARCH_TEMPLATE_CODE,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
  SCREENING_TO_TIMING_TEMPLATE_CODE,
  TIMING_REVIEW_LOOP_TEMPLATE_CODE,
  TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
} from "~/server/domain/workflow/types";
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

    if (
      error.code === WORKFLOW_ERROR_CODES.WORKFLOW_INVALID_STATUS_TRANSITION
    ) {
      return new TRPCError({ code: "BAD_REQUEST", message: error.message });
    }

    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  }

  if (error instanceof TRPCError) {
    return error;
  }

  if (error instanceof Error) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  }

  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "未知错误" });
}

async function assertTimingPresetExists(params: {
  db: typeof import("~/server/db").db;
  userId: string;
  presetId?: string;
}) {
  if (!params.presetId) {
    return null;
  }

  const preset = await params.db.timingPreset.findFirst({
    where: {
      id: params.presetId,
      userId: params.userId,
    },
    select: {
      id: true,
      name: true,
    },
  });

  if (!preset) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Timing preset 不存在",
    });
  }

  return preset;
}

const startQuickResearchInput = z.object({
  researchPreferences: z
    .object({
      researchGoal: z.string().trim().min(1).optional(),
      mustAnswerQuestions: z.array(z.string().min(1)).max(8).optional(),
      forbiddenEvidenceTypes: z.array(z.string().min(1)).max(8).optional(),
      preferredSources: z.array(z.string().min(1)).max(8).optional(),
      freshnessWindowDays: z.number().int().min(1).max(3650).optional(),
    })
    .optional(),
  query: z.string().min(1, "query 不能为空"),
  templateCode: z.string().default(QUICK_RESEARCH_TEMPLATE_CODE),
  templateVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const startCompanyResearchInput = z.object({
  researchPreferences: z
    .object({
      researchGoal: z.string().trim().min(1).optional(),
      mustAnswerQuestions: z.array(z.string().min(1)).max(8).optional(),
      forbiddenEvidenceTypes: z.array(z.string().min(1)).max(8).optional(),
      preferredSources: z.array(z.string().min(1)).max(8).optional(),
      freshnessWindowDays: z.number().int().min(1).max(3650).optional(),
    })
    .optional(),
  companyName: z.string().min(1, "companyName 不能为空"),
  stockCode: z.string().trim().min(1).optional(),
  officialWebsite: z.string().url().optional(),
  focusConcepts: z.array(z.string().min(1)).max(8).optional(),
  keyQuestion: z.string().trim().min(1).optional(),
  supplementalUrls: z.array(z.string().url()).max(8).optional(),
  templateVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const startScreeningInsightPipelineInput = z.object({
  screeningSessionId: z.string().cuid(),
  strategyName: z.string().trim().min(1).optional(),
  maxInsightsPerSession: z.number().int().min(1).max(50).optional(),
  templateCode: z.string().default(SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE),
  templateVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const startTimingSignalPipelineInput = z.object({
  stockCode: z.string().regex(/^\d{6}$/, "stockCode 必须是 6 位数字"),
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  presetId: z.string().cuid().optional(),
  templateCode: z.string().default(TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE),
  templateVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const startWatchlistTimingCardsPipelineInput = z.object({
  watchListId: z.string().cuid(),
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  presetId: z.string().cuid().optional(),
  templateCode: z
    .string()
    .default(WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE),
  templateVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const startWatchlistTimingPipelineInput = z.object({
  watchListId: z.string().cuid(),
  portfolioSnapshotId: z.string().cuid(),
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  presetId: z.string().cuid().optional(),
  templateCode: z.string().default(WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE),
  templateVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const startScreeningToTimingPipelineInput = z.object({
  screeningSessionId: z.string().cuid(),
  candidateLimit: z.number().int().min(1).max(50).optional(),
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  presetId: z.string().cuid().optional(),
  templateCode: z.string().default(SCREENING_TO_TIMING_TEMPLATE_CODE),
  templateVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const startTimingReviewLoopInput = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  limit: z.number().int().min(1).max(500).optional(),
  templateCode: z.string().default(TIMING_REVIEW_LOOP_TEMPLATE_CODE),
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
  templateCode: z.string().optional(),
});

const cancelRunInput = z.object({
  runId: z.string().cuid(),
});

const approveScreeningInsightsInput = z.object({
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
          researchPreferences: input.researchPreferences,
          templateCode: input.templateCode,
          templateVersion: input.templateVersion,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw mapWorkflowError(error);
      }
    }),

  startCompanyResearch: protectedProcedure
    .input(startCompanyResearchInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWorkflowRunRepository(ctx.db);
        const commandService = new WorkflowCommandService(repository);

        return await commandService.startCompanyResearch({
          userId: ctx.session.user.id,
          companyName: input.companyName,
          stockCode: input.stockCode,
          officialWebsite: input.officialWebsite,
          focusConcepts: input.focusConcepts,
          keyQuestion: input.keyQuestion,
          supplementalUrls: input.supplementalUrls,
          researchPreferences: input.researchPreferences,
          templateVersion: input.templateVersion,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw mapWorkflowError(error);
      }
    }),

  startScreeningInsightPipeline: protectedProcedure
    .input(startScreeningInsightPipelineInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const session = await ctx.db.screeningSession.findFirst({
          where: {
            id: input.screeningSessionId,
            userId: ctx.session.user.id,
          },
          select: {
            id: true,
            strategyName: true,
          },
        });

        if (!session) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "筛选会话不存在",
          });
        }

        const repository = new PrismaWorkflowRunRepository(ctx.db);
        const commandService = new WorkflowCommandService(repository);

        return await commandService.startScreeningInsightPipeline({
          userId: ctx.session.user.id,
          screeningSessionId: input.screeningSessionId,
          strategyName: input.strategyName ?? session.strategyName ?? undefined,
          maxInsightsPerSession: input.maxInsightsPerSession,
          templateVersion: input.templateVersion,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        throw mapWorkflowError(error);
      }
    }),

  startTimingSignalPipeline: protectedProcedure
    .input(startTimingSignalPipelineInput)
    .mutation(async ({ ctx, input }) => {
      try {
        await assertTimingPresetExists({
          db: ctx.db,
          userId: ctx.session.user.id,
          presetId: input.presetId,
        });

        const repository = new PrismaWorkflowRunRepository(ctx.db);
        const commandService = new WorkflowCommandService(repository);

        return await commandService.startTimingSignalPipeline({
          userId: ctx.session.user.id,
          stockCode: input.stockCode,
          asOfDate: input.asOfDate,
          presetId: input.presetId,
          templateVersion: input.templateVersion,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw mapWorkflowError(error);
      }
    }),

  startWatchlistTimingCardsPipeline: protectedProcedure
    .input(startWatchlistTimingCardsPipelineInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const [watchList] = await Promise.all([
          ctx.db.watchList.findFirst({
            where: {
              id: input.watchListId,
              userId: ctx.session.user.id,
            },
            select: {
              id: true,
              name: true,
            },
          }),
          assertTimingPresetExists({
            db: ctx.db,
            userId: ctx.session.user.id,
            presetId: input.presetId,
          }),
        ]);

        if (!watchList) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "自选股列表不存在",
          });
        }

        const repository = new PrismaWorkflowRunRepository(ctx.db);
        const commandService = new WorkflowCommandService(repository);

        return await commandService.startWatchlistTimingCardsPipeline({
          userId: ctx.session.user.id,
          watchListId: input.watchListId,
          asOfDate: input.asOfDate,
          presetId: input.presetId,
          watchListName: watchList.name,
          templateVersion: input.templateVersion,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        throw mapWorkflowError(error);
      }
    }),

  startWatchlistTimingPipeline: protectedProcedure
    .input(startWatchlistTimingPipelineInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const [watchList, portfolioSnapshot] = await Promise.all([
          ctx.db.watchList.findFirst({
            where: {
              id: input.watchListId,
              userId: ctx.session.user.id,
            },
            select: {
              id: true,
              name: true,
            },
          }),
          ctx.db.portfolioSnapshot.findFirst({
            where: {
              id: input.portfolioSnapshotId,
              userId: ctx.session.user.id,
            },
            select: {
              id: true,
              name: true,
            },
          }),
          assertTimingPresetExists({
            db: ctx.db,
            userId: ctx.session.user.id,
            presetId: input.presetId,
          }),
        ]);

        if (!watchList) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "自选股列表不存在",
          });
        }

        if (!portfolioSnapshot) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "组合快照不存在",
          });
        }

        const repository = new PrismaWorkflowRunRepository(ctx.db);
        const commandService = new WorkflowCommandService(repository);

        return await commandService.startWatchlistTimingPipeline({
          userId: ctx.session.user.id,
          watchListId: input.watchListId,
          portfolioSnapshotId: input.portfolioSnapshotId,
          asOfDate: input.asOfDate,
          presetId: input.presetId,
          watchListName: watchList.name,
          portfolioSnapshotName: portfolioSnapshot.name,
          templateVersion: input.templateVersion,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        throw mapWorkflowError(error);
      }
    }),

  startScreeningToTimingPipeline: protectedProcedure
    .input(startScreeningToTimingPipelineInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const [screeningSession] = await Promise.all([
          ctx.db.screeningSession.findFirst({
            where: {
              id: input.screeningSessionId,
              userId: ctx.session.user.id,
            },
            select: {
              id: true,
              strategyName: true,
            },
          }),
          assertTimingPresetExists({
            db: ctx.db,
            userId: ctx.session.user.id,
            presetId: input.presetId,
          }),
        ]);

        if (!screeningSession) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "筛选会话不存在",
          });
        }

        const repository = new PrismaWorkflowRunRepository(ctx.db);
        const commandService = new WorkflowCommandService(repository);

        return await commandService.startScreeningToTimingPipeline({
          userId: ctx.session.user.id,
          screeningSessionId: input.screeningSessionId,
          strategyName: screeningSession.strategyName,
          candidateLimit: input.candidateLimit,
          asOfDate: input.asOfDate,
          presetId: input.presetId,
          templateVersion: input.templateVersion,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        throw mapWorkflowError(error);
      }
    }),

  startTimingReviewLoop: protectedProcedure
    .input(startTimingReviewLoopInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWorkflowRunRepository(ctx.db);
        const commandService = new WorkflowCommandService(repository);

        return await commandService.startTimingReviewLoop({
          userId: ctx.session.user.id,
          date: input.date,
          limit: input.limit,
          templateVersion: input.templateVersion,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw mapWorkflowError(error);
      }
    }),

  getRun: protectedProcedure
    .input(getRunInput)
    .query(async ({ ctx, input }) => {
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
          templateCode: input.templateCode,
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

  approveScreeningInsights: protectedProcedure
    .input(approveScreeningInsightsInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWorkflowRunRepository(ctx.db);
        const commandService = new WorkflowCommandService(repository);

        return await commandService.approveScreeningInsights({
          userId: ctx.session.user.id,
          runId: input.runId,
        });
      } catch (error) {
        throw mapWorkflowError(error);
      }
    }),
});

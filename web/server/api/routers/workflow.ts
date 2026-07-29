import { WorkflowRunStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { WorkflowCommandService } from "~/server/application/workflow/command-service";
import { WorkflowQueryService } from "~/server/application/workflow/query-service";
import { impactMappingInputSchema } from "~/server/domain/intelligence/impact-mapping";
import {
  isWorkflowDomainError,
  WORKFLOW_ERROR_CODES,
} from "~/server/domain/workflow/errors";
import {
  IMPACT_MAPPING_TEMPLATE_CODE,
  INDUSTRY_RESEARCH_TEMPLATE_CODE,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
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

  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "鏈煡閿欒",
  });
}

const startIndustryResearchInput = z.object({
  taskContract: z
    .object({
      requiredSources: z.array(z.string().min(1)).max(8),
      requiredSections: z.array(z.string().min(1)).max(12),
      citationRequired: z.boolean(),
      analysisDepth: z.enum(["standard", "deep"]),
      deadlineMinutes: z
        .number()
        .int()
        .min(5)
        .max(24 * 60),
    })
    .optional(),
  researchPreferences: z
    .object({
      researchGoal: z.string().trim().min(1).optional(),
      mustAnswerQuestions: z.array(z.string().min(1)).max(8).optional(),
      forbiddenEvidenceTypes: z.array(z.string().min(1)).max(8).optional(),
      preferredSources: z.array(z.string().min(1)).max(8).optional(),
      freshnessWindowDays: z.number().int().min(1).max(3650).optional(),
    })
    .optional(),
  query: z.string().min(1, "query 涓嶈兘涓虹┖"),
  targetRef: z
    .object({
      type: z.enum(["company", "industry", "watchlist", "workflow_run"]),
      id: z.string().min(1),
    })
    .optional(),
  templateCode: z.string().default(INDUSTRY_RESEARCH_TEMPLATE_CODE),
  templateVersion: z.number().int().positive().optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

const startCompanyResearchInput = z.object({
  taskContract: z
    .object({
      requiredSources: z.array(z.string().min(1)).max(8),
      requiredSections: z.array(z.string().min(1)).max(12),
      citationRequired: z.boolean(),
      analysisDepth: z.enum(["standard", "deep"]),
      deadlineMinutes: z
        .number()
        .int()
        .min(5)
        .max(24 * 60),
    })
    .optional(),
  researchPreferences: z
    .object({
      researchGoal: z.string().trim().min(1).optional(),
      mustAnswerQuestions: z.array(z.string().min(1)).max(8).optional(),
      forbiddenEvidenceTypes: z.array(z.string().min(1)).max(8).optional(),
      preferredSources: z.array(z.string().min(1)).max(8).optional(),
      freshnessWindowDays: z.number().int().min(1).max(3650).optional(),
    })
    .optional(),
  companyName: z.string().min(1, "companyName 涓嶈兘涓虹┖"),
  targetRef: z
    .object({
      type: z.enum(["company", "industry", "watchlist", "workflow_run"]),
      id: z.string().min(1),
    })
    .optional(),
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

const startImpactMappingInput = z.intersection(
  impactMappingInputSchema,
  z.object({
    templateVersion: z.number().int().positive().optional(),
    idempotencyKey: z.string().min(8).max(160).optional(),
  }),
);

const ensureImpactMappingAnalysesInput = z
  .object({
    baseRunId: z.string().cuid(),
    eventIds: z.array(z.string().min(1)).min(1).max(3),
  })
  .refine((value) => new Set(value.eventIds).size === value.eventIds.length, {
    message: "eventIds 不能重复",
    path: ["eventIds"],
  });

const getRunInput = z.object({
  runId: z.string().cuid(),
});

const listRunsInput = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().cuid().optional(),
  status: z.nativeEnum(WorkflowRunStatus).optional(),
  templateCode: z.string().optional(),
  templateCodes: z.array(z.string().min(1)).max(8).optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

const cancelRunInput = z.object({
  runId: z.string().cuid(),
});

const approveScreeningInsightsInput = z.object({
  runId: z.string().cuid(),
});

function hasNonEmptyImpactEvents(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const events = (value as Record<string, unknown>).events;
  return Array.isArray(events) && events.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function embeddedEventAnalysis(
  result: Record<string, unknown>,
  eventId: string,
) {
  const events = Array.isArray(result.events) ? result.events : [];
  const item = events.find((candidate) => {
    if (!isRecord(candidate) || !isRecord(candidate.event)) return false;
    return candidate.event.id === eventId;
  });
  if (!isRecord(item) || !isRecord(item.event) || !isRecord(item.analysis)) {
    return undefined;
  }
  return {
    ...result,
    mode: "trace",
    selectedEvent: item.event,
    impactEdges: Array.isArray(item.impactEdges) ? item.impactEdges : [],
    timeline: Array.isArray(item.analysis.timeline)
      ? item.analysis.timeline
      : [],
    scenarios: Array.isArray(item.analysis.scenarios)
      ? item.analysis.scenarios
      : [],
    warnings: Array.isArray(item.analysis.warnings)
      ? item.analysis.warnings
      : [],
    traceState: isRecord(item.analysis.traceState)
      ? item.analysis.traceState
      : undefined,
  };
}

export const workflowRouter = createTRPCRouter({
  startImpactMapping: protectedProcedure
    .input(startImpactMappingInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWorkflowRunRepository(ctx.db);
        const commandService = new WorkflowCommandService(repository);
        return await commandService.startImpactMapping({
          userId: ctx.session.user.id,
          input: impactMappingInputSchema.parse(input),
          templateVersion: input.templateVersion,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        throw mapWorkflowError(error);
      }
    }),

  ensureImpactMappingAnalyses: protectedProcedure
    .input(ensureImpactMappingAnalysesInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const baseRun = await ctx.db.workflowRun.findFirst({
        where: {
          id: input.baseRunId,
          userId,
          status: WorkflowRunStatus.SUCCEEDED,
          template: { is: { code: IMPACT_MAPPING_TEMPLATE_CODE } },
        },
        select: { input: true, result: true },
      });
      if (!baseRun || !isRecord(baseRun.input) || !isRecord(baseRun.result)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "新闻雷达基准快照不存在",
        });
      }
      if (baseRun.input.mode !== "overview") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "只能基于 overview 新闻雷达加载分析",
        });
      }
      const baseResult = baseRun.result as Record<string, unknown>;

      const events = Array.isArray(baseResult.events) ? baseResult.events : [];
      const availableEventIds = new Set(
        events.flatMap((candidate) => {
          if (!isRecord(candidate) || !isRecord(candidate.event)) return [];
          return typeof candidate.event.id === "string"
            ? [candidate.event.id]
            : [];
        }),
      );
      const missingEventId = input.eventIds.find(
        (eventId) => !availableEventIds.has(eventId),
      );
      if (missingEventId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `基准快照中不存在新闻事件: ${missingEventId}`,
        });
      }

      const repository = new PrismaWorkflowRunRepository(ctx.db);
      const commandService = new WorkflowCommandService(repository);
      return Promise.all(
        input.eventIds.map(async (eventId) => {
          const embedded = embeddedEventAnalysis(baseResult, eventId);
          if (embedded) {
            return {
              eventId,
              status: WorkflowRunStatus.SUCCEEDED,
              source: "base" as const,
              result: embedded,
            };
          }

          const idempotencyKey = `impact-analysis:${input.baseRunId}:${eventId}`;
          const existing = await ctx.db.workflowRun.findFirst({
            where: { userId, idempotencyKey },
            orderBy: { createdAt: "desc" },
            select: { id: true, status: true, result: true },
          });
          if (
            existing?.status === WorkflowRunStatus.SUCCEEDED &&
            isRecord(existing.result)
          ) {
            return {
              eventId,
              runId: existing.id,
              status: existing.status,
              source: "run" as const,
              result: existing.result,
            };
          }
          const activeStatuses = new Set<WorkflowRunStatus>([
            WorkflowRunStatus.PENDING,
            WorkflowRunStatus.RUNNING,
            WorkflowRunStatus.PAUSED,
          ]);
          if (existing && activeStatuses.has(existing.status)) {
            return {
              eventId,
              runId: existing.id,
              status: existing.status,
              source: "run" as const,
            };
          }

          const started = await commandService.startImpactMapping({
            userId,
            input: impactMappingInputSchema.parse({
              mode: "trace",
              baseRunId: input.baseRunId,
              eventId,
              traceMaxDays: 365,
              traceMaxEvents: 30,
            }),
            idempotencyKey,
          });
          return {
            eventId,
            runId: started.runId,
            status: started.status,
            source: "run" as const,
          };
        }),
      );
    }),

  getLatestImpactMapping: protectedProcedure.query(async ({ ctx }) => {
    const runs = await ctx.db.workflowRun.findMany({
      where: {
        userId: ctx.session.user.id,
        status: WorkflowRunStatus.SUCCEEDED,
        template: { is: { code: IMPACT_MAPPING_TEMPLATE_CODE } },
      },
      orderBy: { completedAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        progressPercent: true,
        input: true,
        result: true,
        createdAt: true,
        completedAt: true,
      },
    });
    return (
      runs.find((run) => {
        const input = run.input;
        return (
          input !== null &&
          typeof input === "object" &&
          !Array.isArray(input) &&
          input.mode === "overview" &&
          hasNonEmptyImpactEvents(run.result)
        );
      }) ?? null
    );
  }),

  startIndustryResearch: protectedProcedure
    .input(startIndustryResearchInput)
    .mutation(async ({ ctx, input }) => {
      try {
        const repository = new PrismaWorkflowRunRepository(ctx.db);
        const commandService = new WorkflowCommandService(repository);

        return await commandService.startIndustryResearch({
          userId: ctx.session.user.id,
          query: input.query,
          targetRef: input.targetRef,
          taskContract: input.taskContract,
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
          targetRef: input.targetRef,
          stockCode: input.stockCode,
          officialWebsite: input.officialWebsite,
          focusConcepts: input.focusConcepts,
          keyQuestion: input.keyQuestion,
          supplementalUrls: input.supplementalUrls,
          taskContract: input.taskContract,
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
    .mutation(async () => {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "旧 screening insight 流水线已下线，请改用新的筛选工作台。",
      });
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
          templateCodes: input.templateCodes,
          search: input.search,
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

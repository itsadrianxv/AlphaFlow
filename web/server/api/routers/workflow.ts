import { WorkflowRunStatus } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  getLatestWorkflowPauseReason,
  WORKFLOW_NODE_TIMEOUT_PAUSE_REASON,
} from "~/contracts/workflow-pause";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { readHomepageNewsRadar } from "~/server/application/homepage/homepage-news-radar";
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
    baseRunId: z.string().cuid().optional(),
    baseSnapshotId: z.string().cuid().optional(),
    eventIds: z.array(z.string().min(1)).min(1).max(3),
  })
  .refine(
    (value) => Boolean(value.baseRunId) !== Boolean(value.baseSnapshotId),
    {
      message: "baseRunId 与 baseSnapshotId 必须且只能提供一个",
      path: ["baseRunId"],
    },
  )
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

function isPrismaUniqueConstraintError(error: unknown) {
  if (!isRecord(error) || error.code !== "P2002" || !isRecord(error.meta)) {
    return false;
  }
  const target = error.meta.target;
  if (Array.isArray(target)) {
    return target.includes("userId") && target.includes("idempotencyKey");
  }
  return (
    typeof target === "string" &&
    target.includes("WorkflowRun_active_user_idempotency_key")
  );
}

const IMPACT_ANALYSIS_MAX_ATTEMPTS = 2;

function impactAnalysisIdempotencyKey(stableKey: string, attempt: number) {
  return attempt === 1 ? stableKey : `${stableKey}:attempt:${attempt}`;
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
      let baseResult: Record<string, unknown> | undefined;
      if (input.baseRunId) {
        const baseRun = await ctx.db.workflowRun.findFirst({
          where: {
            id: input.baseRunId,
            userId,
            status: WorkflowRunStatus.SUCCEEDED,
            template: { is: { code: IMPACT_MAPPING_TEMPLATE_CODE } },
          },
          select: { input: true, result: true },
        });
        if (
          baseRun &&
          isRecord(baseRun.input) &&
          baseRun.input.mode === "overview" &&
          isRecord(baseRun.result)
        ) {
          baseResult = baseRun.result;
        }
      } else if (input.baseSnapshotId) {
        baseResult = (
          await readHomepageNewsRadar(ctx.db, input.baseSnapshotId, userId)
        )?.result as unknown as Record<string, unknown> | undefined;
      }
      if (!baseResult) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "新闻雷达基准快照不存在",
        });
      }

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

          const sourceId = input.baseRunId ?? input.baseSnapshotId;
          const sourceKind = input.baseRunId ? "run" : "snapshot";
          const stableIdempotencyKey = `impact-analysis:${sourceKind}:${sourceId}:${eventId}`;
          const attemptKeys = Array.from(
            { length: IMPACT_ANALYSIS_MAX_ATTEMPTS },
            (_, index) =>
              impactAnalysisIdempotencyKey(stableIdempotencyKey, index + 1),
          );
          const existing = await ctx.db.workflowRun.findFirst({
            where: {
              userId,
              idempotencyKey: { in: attemptKeys },
            },
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              idempotencyKey: true,
              status: true,
              result: true,
              events: {
                where: { eventType: "RUN_PAUSED" },
                orderBy: { sequence: "desc" },
                take: 1,
                select: { eventType: true, payload: true },
              },
            },
          });
          const existingAttempt = existing?.idempotencyKey
            ? Math.max(1, attemptKeys.indexOf(existing.idempotencyKey) + 1)
            : 1;
          const pauseReason = getLatestWorkflowPauseReason(existing?.events);
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
              attempt: existingAttempt,
            };
          }
          const activeStatuses = new Set<WorkflowRunStatus>([
            WorkflowRunStatus.PENDING,
            WorkflowRunStatus.RUNNING,
          ]);
          if (existing && activeStatuses.has(existing.status)) {
            return {
              eventId,
              runId: existing.id,
              status: existing.status,
              source: "run" as const,
              attempt: existingAttempt,
            };
          }

          if (existing?.status === WorkflowRunStatus.PAUSED) {
            const retryExhausted =
              pauseReason === WORKFLOW_NODE_TIMEOUT_PAUSE_REASON &&
              existingAttempt >= IMPACT_ANALYSIS_MAX_ATTEMPTS;
            if (
              pauseReason !== WORKFLOW_NODE_TIMEOUT_PAUSE_REASON ||
              retryExhausted
            ) {
              return {
                eventId,
                runId: existing.id,
                status: existing.status,
                source: "run" as const,
                pauseReason,
                retryExhausted,
                attempt: existingAttempt,
              };
            }
          }

          const nextAttempt =
            existing?.status === WorkflowRunStatus.PAUSED
              ? existingAttempt + 1
              : existingAttempt;

          const nextIdempotencyKey = impactAnalysisIdempotencyKey(
            stableIdempotencyKey,
            nextAttempt,
          );
          let started: {
            runId: string;
            status: WorkflowRunStatus;
          };
          try {
            started = await commandService.startImpactMapping({
              userId,
              input: impactMappingInputSchema.parse({
                mode: "trace",
                baseRunId: input.baseRunId,
                baseSnapshotId: input.baseSnapshotId,
                eventId,
                traceMaxDays: 365,
                traceMaxEvents: 30,
              }),
              idempotencyKey: nextIdempotencyKey,
            });
          } catch (error) {
            if (!isPrismaUniqueConstraintError(error)) throw error;
            const concurrentRun = await ctx.db.workflowRun.findFirst({
              where: { userId, idempotencyKey: nextIdempotencyKey },
              orderBy: { createdAt: "desc" },
              select: { id: true, status: true },
            });
            if (!concurrentRun) throw error;
            started = {
              runId: concurrentRun.id,
              status: concurrentRun.status,
            };
          }
          return {
            eventId,
            runId: started.runId,
            status: started.status,
            source: "run" as const,
            attempt: nextAttempt,
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
    const latestRun = runs.find((run) => {
      const input = run.input;
      return (
        input !== null &&
        typeof input === "object" &&
        !Array.isArray(input) &&
        input.mode === "overview" &&
        hasNonEmptyImpactEvents(run.result)
      );
    });
    if (latestRun) return { ...latestRun, baseRunId: latestRun.id };
    const projection = await ctx.db.homepageCurrentSnapshotProjection.findFirst(
      {
        where: { scope: "BASELINE", userId: null },
        orderBy: { activationSequence: "desc" },
        select: { snapshotId: true },
      },
    );
    if (!projection) return null;
    const cached = await readHomepageNewsRadar(
      ctx.db,
      projection.snapshotId,
      ctx.session.user.id,
    );
    if (!cached || cached.result.events.length === 0) return null;
    return {
      id: cached.snapshotId,
      baseSnapshotId: cached.snapshotId,
      status: WorkflowRunStatus.SUCCEEDED,
      progressPercent: 100,
      input: { mode: "overview", source: "homepage_snapshot" },
      result: cached.result,
      createdAt: cached.generatedAt,
      completedAt: cached.generatedAt,
    };
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

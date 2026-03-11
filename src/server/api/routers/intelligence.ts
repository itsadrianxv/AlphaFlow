import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { ConfidenceAnalysisService } from "~/server/application/intelligence/confidence-analysis-service";
import { InsightArchiveService } from "~/server/application/intelligence/insight-archive-service";
import { InsightSynthesisService } from "~/server/application/intelligence/insight-synthesis-service";
import { ReminderSchedulingService } from "~/server/application/intelligence/reminder-scheduling-service";
import { InsightQualityService } from "~/server/domain/intelligence/services/insight-quality-service";
import { ReviewPlanPolicy } from "~/server/domain/intelligence/services/review-plan-policy";
import { ScreeningSessionStatus } from "~/server/domain/screening/enums/screening-session-status";
import { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";
import { PrismaResearchReminderRepository } from "~/server/infrastructure/intelligence/prisma-research-reminder-repository";
import { PrismaScreeningInsightRepository } from "~/server/infrastructure/intelligence/prisma-screening-insight-repository";
import { PythonConfidenceAnalysisClient } from "~/server/infrastructure/intelligence/python-confidence-analysis-client";
import { PythonIntelligenceDataClient } from "~/server/infrastructure/intelligence/python-intelligence-data-client";
import { PrismaScreeningSessionRepository } from "~/server/infrastructure/screening/prisma-screening-session-repository";

const paginationSchema = z.object({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

function createArchiveService(db: PrismaClient) {
  const reminderRepository = new PrismaResearchReminderRepository(db);
  const confidenceAnalysisService = new ConfidenceAnalysisService({
    client: new PythonConfidenceAnalysisClient(),
  });

  return new InsightArchiveService({
    insightRepository: new PrismaScreeningInsightRepository(db),
    dataClient: new PythonIntelligenceDataClient(),
    synthesisService: new InsightSynthesisService({
      completionClient: new DeepSeekClient(),
      reviewPlanPolicy: new ReviewPlanPolicy(),
      qualityService: new InsightQualityService(),
    }),
    confidenceAnalysisService,
    reminderSchedulingService: new ReminderSchedulingService({
      reminderRepository,
    }),
  });
}

export const intelligenceRouter = createTRPCRouter({
  listInsights: protectedProcedure
    .input(paginationSchema)
    .query(async ({ ctx, input }) => {
      const repository = new PrismaScreeningInsightRepository(ctx.db);
      const insights = await repository.findByUserId(
        ctx.session.user.id,
        input.limit,
        input.offset,
      );

      return insights.map((item) => ({
        id: item.id,
        screeningSessionId: item.screeningSessionId,
        stockCode: item.stockCode,
        stockName: item.stockName,
        score: item.score,
        summary: item.summary,
        status: item.status,
        version: item.version,
        confidenceScore: item.confidenceScore,
        confidenceLevel: item.confidenceLevel,
        confidenceStatus: item.confidenceStatus,
        supportedClaimCount: item.supportedClaimCount,
        insufficientClaimCount: item.insufficientClaimCount,
        contradictedClaimCount: item.contradictedClaimCount,
        nextReviewAt: item.reviewPlan.nextReviewAt,
        qualityFlags: [...item.qualityFlags],
        updatedAt: item.updatedAt,
      }));
    }),

  getInsightDetail: protectedProcedure
    .input(z.object({ insightId: z.string() }))
    .query(async ({ ctx, input }) => {
      const repository = new PrismaScreeningInsightRepository(ctx.db);
      const insight = await repository.findById(input.insightId);

      if (!insight || insight.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Insight 不存在",
        });
      }

      const versions = await repository.findVersions(insight.id);

      return {
        id: insight.id,
        screeningSessionId: insight.screeningSessionId,
        stockCode: insight.stockCode,
        stockName: insight.stockName,
        score: insight.score,
        summary: insight.summary,
        thesis: insight.thesis.toDict(),
        risks: insight.risks.map((item) => item.toDict()),
        catalysts: insight.catalysts.map((item) => item.toDict()),
        reviewPlan: insight.reviewPlan.toDict(),
        evidenceRefs: insight.evidenceRefs.map((item) => item.toDict()),
        qualityFlags: [...insight.qualityFlags],
        confidenceScore: insight.confidenceScore,
        confidenceLevel: insight.confidenceLevel,
        confidenceStatus: insight.confidenceStatus,
        supportedClaimCount: insight.supportedClaimCount,
        insufficientClaimCount: insight.insufficientClaimCount,
        contradictedClaimCount: insight.contradictedClaimCount,
        confidenceAnalysis: insight.confidenceAnalysis,
        status: insight.status,
        version: insight.version,
        latestVersionId: insight.latestVersionId,
        createdAt: insight.createdAt,
        updatedAt: insight.updatedAt,
        versions: versions.map((item) => item.toDict()),
      };
    }),

  getSessionInsights: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sessionRepository = new PrismaScreeningSessionRepository(ctx.db);
      const session = await sessionRepository.findById(input.sessionId);

      if (!session || session.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "筛选会话不存在",
        });
      }

      const repository = new PrismaScreeningInsightRepository(ctx.db);
      const insights = await repository.findByScreeningSessionId(
        input.sessionId,
      );

      return insights.map((item) => ({
        id: item.id,
        stockCode: item.stockCode,
        stockName: item.stockName,
        score: item.score,
        summary: item.summary,
        status: item.status,
        version: item.version,
        confidenceScore: item.confidenceScore,
        confidenceLevel: item.confidenceLevel,
        confidenceStatus: item.confidenceStatus,
        supportedClaimCount: item.supportedClaimCount,
        insufficientClaimCount: item.insufficientClaimCount,
        contradictedClaimCount: item.contradictedClaimCount,
        nextReviewAt: item.reviewPlan.nextReviewAt,
        qualityFlags: [...item.qualityFlags],
      }));
    }),

  generateSessionInsights: protectedProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const sessionRepository = new PrismaScreeningSessionRepository(ctx.db);
      const session = await sessionRepository.findById(input.sessionId);

      if (!session || session.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "筛选会话不存在",
        });
      }

      if (session.status !== ScreeningSessionStatus.SUCCEEDED) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "仅支持为已完成的筛选会话生成 insight",
        });
      }

      const archiveService = createArchiveService(ctx.db);
      const insights = await archiveService.archiveSessionInsights(session);

      return {
        count: insights.length,
        insightIds: insights.map((item) => item.id),
      };
    }),

  listPendingReminders: protectedProcedure
    .input(paginationSchema)
    .query(async ({ ctx, input }) => {
      const repository = new PrismaResearchReminderRepository(ctx.db);
      const reminders = await repository.findPendingByUserId(
        ctx.session.user.id,
        input.limit,
        input.offset,
      );

      return reminders.map((item) => ({
        id: item.id,
        insightId: item.insightId,
        stockCode: item.stockCode,
        reminderType: item.reminderType,
        scheduledAt: item.scheduledAt,
        status: item.status,
        payload: item.payload,
        triggeredAt: item.triggeredAt,
      }));
    }),

  acknowledgeReminder: protectedProcedure
    .input(z.object({ reminderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const repository = new PrismaResearchReminderRepository(ctx.db);
      const reminder = await repository.findById(input.reminderId);

      if (!reminder || reminder.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "提醒不存在",
        });
      }

      reminder.markTriggered();
      await repository.save(reminder);

      return {
        id: reminder.id,
        status: reminder.status,
        triggeredAt: reminder.triggeredAt,
      };
    }),
});

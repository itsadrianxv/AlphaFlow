import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  portfolioCompositionSchema,
  portfolioCompositionObjectSchema,
  timingResearchRunInputSchema,
  validatePortfolioCompositionWeights,
} from "~/contracts/timing-research";
import { TimingReportService } from "~/server/application/timing/timing-report-service";
import { TimingResearchRunService } from "~/server/application/timing/timing-research-run-service";
import { KronosResearchForecastModule } from "~/server/application/timing/kronos-research-forecast-module";
import {
  createTimingResearchRuleConfig,
  validateTimingResearchRuleConfig,
} from "~/server/domain/timing/strategy-v2";
import {
  TIMING_HORIZON_TEMPLATES,
  TIMING_SETUP_TYPES,
  type TimingResearchRuleConfig,
} from "~/server/domain/timing/types";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { PrismaPortfolioCompositionRepository } from "~/server/infrastructure/timing/prisma-portfolio-composition-repository";
import { PrismaPortfolioRiskDiagnosticRepository } from "~/server/infrastructure/timing/prisma-portfolio-risk-diagnostic-repository";
import { PrismaTimingKronosForecastSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-kronos-forecast-snapshot-repository";
import { KronosForecastClient } from "~/server/infrastructure/timing/kronos-forecast-client";
import { PrismaTimingMarketContextSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-market-context-snapshot-repository";
import {
  hashTimingPresetConfig,
  PrismaTimingPresetRevisionRepository,
} from "~/server/infrastructure/timing/prisma-timing-preset-revision-repository";
import { PrismaTimingResearchReportRepository } from "~/server/infrastructure/timing/prisma-timing-research-report-repository";
import { PrismaTimingSignalSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-signal-snapshot-repository";
import { PythonTimingDataClient } from "~/server/infrastructure/timing/python-timing-data-client";

const researchRuleConfigSchema = z.custom<TimingResearchRuleConfig>((value) => {
  if (!value || typeof value !== "object") return false;
  return validateTimingResearchRuleConfig(value as TimingResearchRuleConfig).length === 0;
}, "研究规则配置无效");

const reportListInput = z.object({
  limit: z.number().int().min(1).max(100).default(30),
  stockCode: z.string().regex(/^\d{6}$/).optional(),
  sourceType: z.enum(["single", "watchlist", "screening"]).optional(),
  watchListId: z.string().uuid().optional(),
  workflowRunId: z.string().cuid().optional(),
}).strict();

function researchService(ctx: { db: PrismaClient }) {
  const db = ctx.db;
  const forecastSnapshotRepository = new PrismaTimingKronosForecastSnapshotRepository(db);
  return new TimingResearchRunService({
    revisionRepository: new PrismaTimingPresetRevisionRepository(db),
    signalSnapshotRepository: new PrismaTimingSignalSnapshotRepository(db),
    researchReportRepository: new PrismaTimingResearchReportRepository(db),
    compositionRepository: new PrismaPortfolioCompositionRepository(db),
    diagnosticRepository: new PrismaPortfolioRiskDiagnosticRepository(db),
    marketContextRepository: new PrismaTimingMarketContextSnapshotRepository(db),
    timingDataClient: new PythonTimingDataClient(),
    kronosResearchForecastModule: new KronosResearchForecastModule({
      client: new KronosForecastClient(),
      snapshotRepository: forecastSnapshotRepository,
    }),
  });
}

export const timingRouter = createTRPCRouter({
  getResearchDefaults: protectedProcedure.query(() => ({
    horizons: TIMING_HORIZON_TEMPLATES,
    setups: TIMING_SETUP_TYPES,
    defaultHorizon: "SWING" as const,
    defaultSetup: "TREND_CONTINUATION" as const,
  })),

  previewResearchRun: protectedProcedure
    .input(timingResearchRunInputSchema)
    .query(({ ctx, input }) => researchService(ctx).preview(ctx.session.user.id, input)),

  startResearchRun: protectedProcedure
    .input(timingResearchRunInputSchema)
    .mutation(({ ctx, input }) => researchService(ctx).run(ctx.session.user.id, input)),

  listResearchReports: protectedProcedure
    .input(reportListInput)
    .query(({ ctx, input }) => new PrismaTimingResearchReportRepository(ctx.db).listForUser({ userId: ctx.session.user.id, ...input })),

  getResearchReport: protectedProcedure
    .input(z.object({ reportId: z.string().cuid() }).strict())
    .query(async ({ ctx, input }) => {
      const service = new TimingReportService({
        researchReportRepository: new PrismaTimingResearchReportRepository(ctx.db),
        signalSnapshotRepository: new PrismaTimingSignalSnapshotRepository(ctx.db),
        marketContextSnapshotRepository: new PrismaTimingMarketContextSnapshotRepository(ctx.db),
        timingDataClient: new PythonTimingDataClient(),
      });
      const report = await service.getTimingReport({ userId: ctx.session.user.id, reportId: input.reportId });
      if (!report) throw new TRPCError({ code: "NOT_FOUND", message: "研究报告不存在" });
      return report;
    }),

  getResearchSeries: protectedProcedure
    .input(z.object({ reportId: z.string().cuid(), timeframe: z.enum(["DAILY", "WEEKLY", "MONTHLY", "MINUTE_60", "MINUTE_30", "MINUTE_15", "MINUTE_1"]) }).strict())
    .query(async ({ ctx, input }) => {
      const service = new TimingReportService({
        researchReportRepository: new PrismaTimingResearchReportRepository(ctx.db),
        signalSnapshotRepository: new PrismaTimingSignalSnapshotRepository(ctx.db),
        marketContextSnapshotRepository: new PrismaTimingMarketContextSnapshotRepository(ctx.db),
        timingDataClient: new PythonTimingDataClient(),
      });
      const series = await service.getTimingSeries({ userId: ctx.session.user.id, ...input });
      if (!series) throw new TRPCError({ code: "NOT_FOUND", message: "研究序列不存在" });
      return series;
    }),

  createPortfolioComposition: protectedProcedure
    .input(portfolioCompositionSchema)
    .mutation(({ ctx, input }) => new PrismaPortfolioCompositionRepository(ctx.db).create({ userId: ctx.session.user.id, name: input.name, positions: input.positions, source: "SAVED" })),

  updatePortfolioComposition: protectedProcedure
    .input(
      portfolioCompositionObjectSchema
        .extend({ id: z.string().cuid() })
        .strict()
        .superRefine(validatePortfolioCompositionWeights),
    )
    .mutation(async ({ ctx, input }) => {
      const record = await new PrismaPortfolioCompositionRepository(ctx.db).update(input.id, ctx.session.user.id, { name: input.name, positions: input.positions });
      if (!record) throw new TRPCError({ code: "NOT_FOUND", message: "组合快照不存在" });
      return record;
    }),

  listPortfolioCompositions: protectedProcedure.query(({ ctx }) =>
    new PrismaPortfolioCompositionRepository(ctx.db).listForUser(ctx.session.user.id),
  ),

  listResearchStrategies: protectedProcedure.query(({ ctx }) =>
    new PrismaTimingPresetRevisionRepository(ctx.db).listStrategies(ctx.session.user.id),
  ),

  createResearchStrategy: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).optional(), setup: z.enum(TIMING_SETUP_TYPES), horizon: z.enum(TIMING_HORIZON_TEMPLATES) }).strict())
    .mutation(({ ctx, input }) => new PrismaTimingPresetRevisionRepository(ctx.db).createStrategy({ userId: ctx.session.user.id, name: input.name, description: input.description, config: createTimingResearchRuleConfig(input.setup, input.horizon) })),

  updateResearchStrategyDraft: protectedProcedure
    .input(z.object({ revisionId: z.string().cuid(), name: z.string().trim().min(1).max(80), description: z.string().trim().max(500).optional(), config: researchRuleConfigSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      const errors = validateTimingResearchRuleConfig(input.config);
      if (errors.length) throw new TRPCError({ code: "BAD_REQUEST", message: errors.join("；") });
      const result = await new PrismaTimingPresetRevisionRepository(ctx.db).updateDraft({ userId: ctx.session.user.id, ...input });
      if (!result) throw new TRPCError({ code: "BAD_REQUEST", message: "仅草稿修订可编辑" });
      return result;
    }),

  cloneResearchStrategyRevision: protectedProcedure
    .input(z.object({ revisionId: z.string().cuid() }).strict())
    .mutation(({ ctx, input }) => new PrismaTimingPresetRevisionRepository(ctx.db).cloneAsDraft({ userId: ctx.session.user.id, revisionId: input.revisionId })),

  validateResearchRuleRevision: protectedProcedure
    .input(z.object({ revisionId: z.string().cuid(), stockCodes: z.array(z.string().regex(/^\d{6}$/)).min(1).max(20) }).strict())
    .mutation(async ({ ctx, input }) => {
      const repository = new PrismaTimingPresetRevisionRepository(ctx.db);
      const revision = await repository.getRevision(ctx.session.user.id, input.revisionId);
      if (!revision || !["DRAFT", "VALIDATING"].includes(revision.status)) throw new TRPCError({ code: "BAD_REQUEST", message: "规则修订当前不可校验" });
      const configErrors = validateTimingResearchRuleConfig(revision.config);
      if (configErrors.length) throw new TRPCError({ code: "BAD_REQUEST", message: configErrors.join("；") });
      const rules = revision.config.ruleGroups.flatMap((group) => group.rules.filter((rule) => rule.enabled));
      const evidence = await new PythonTimingDataClient().getEvidenceBatch({ stockCodes: input.stockCodes, timeframes: [...new Set(rules.map((rule) => rule.timeframe))], indicatorIds: [...new Set(rules.map((rule) => rule.indicatorId))] });
      const allFeatures = evidence.items.flatMap((item) => item.features);
      const requiredEvidenceCount = evidence.items.length * rules.filter((rule) => rule.required).length;
      const availableEvidenceCount = evidence.items.reduce((total, item) => total + rules.filter((rule) => rule.required && item.features.some((feature) => feature.indicatorId === rule.indicatorId && feature.timeframe === rule.timeframe && feature.status === "AVAILABLE" && feature.asOfDate <= item.asOfDate)).length, 0);
      const coveragePct = requiredEvidenceCount ? (availableEvidenceCount / requiredEvidenceCount) * 100 : 100;
      const noLookaheadPassed = evidence.items.every((item) => item.features.every((feature) => feature.asOfDate <= item.asOfDate));
      const failures = [...(coveragePct < 95 ? ["必需证据覆盖率低于 95%。"] : []), ...(!noLookaheadPassed ? ["检测到未来数据引用。"] : [])];
      if (revision.status === "DRAFT") await repository.markValidating(ctx.session.user.id, revision.id);
      return ctx.db.timingRuleValidationRun.create({
        data: {
          userId: ctx.session.user.id,
          presetRevisionId: revision.id,
          status: failures.length ? "FAILED" : "SUCCEEDED",
          configHash: revision.configHash,
          sampleSnapshot: input.stockCodes,
          qualityMetrics: { stockCount: evidence.items.length, requiredEvidenceCount, availableEvidenceCount, coveragePct, noLookaheadPassed, gatePassed: failures.length === 0, failures },
          warnings: evidence.errors.map((item) => `${item.stockCode}：${item.message}`),
          startedAt: new Date(),
          completedAt: new Date(),
        },
      });
    }),

  publishResearchRuleRevision: protectedProcedure
    .input(z.object({ revisionId: z.string().cuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const repository = new PrismaTimingPresetRevisionRepository(ctx.db);
      const revision = await repository.getRevision(ctx.session.user.id, input.revisionId);
      if (!revision) throw new TRPCError({ code: "NOT_FOUND", message: "规则修订不存在" });
      const validation = await ctx.db.timingRuleValidationRun.findFirst({ where: { userId: ctx.session.user.id, presetRevisionId: revision.id, status: "SUCCEEDED", configHash: revision.configHash }, orderBy: { createdAt: "desc" } });
      if (!validation || hashTimingPresetConfig(revision.config) !== validation.configHash) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "当前配置尚未通过同版本覆盖校验" });
      const result = await repository.publish({ userId: ctx.session.user.id, revisionId: revision.id, validatedConfigHash: validation.configHash });
      if (!result) throw new TRPCError({ code: "BAD_REQUEST", message: "规则修订当前不可发布" });
      return result;
    }),
});

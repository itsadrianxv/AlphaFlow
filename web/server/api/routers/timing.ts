import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { MarketRegimeService } from "~/server/application/timing/market-regime-service";
import { applyTimingPresetPatch } from "~/server/application/timing/timing-feedback-service";
import { TimingReportService } from "~/server/application/timing/timing-report-service";
import { createTimingPresetConfigV2, validateTimingPresetConfigV2 } from "~/server/domain/timing/strategy-v2";
import type { TimingPresetConfigV2 } from "~/server/domain/timing/types";
import { PrismaPortfolioSnapshotRepository } from "~/server/infrastructure/timing/prisma-portfolio-snapshot-repository";
import { PrismaTimingAnalysisCardRepository } from "~/server/infrastructure/timing/prisma-timing-analysis-card-repository";
import { PrismaTimingKronosForecastSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-kronos-forecast-snapshot-repository";
import { PrismaTimingMarketContextSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-market-context-snapshot-repository";
import { PrismaTimingPresetAdjustmentSuggestionRepository } from "~/server/infrastructure/timing/prisma-timing-preset-adjustment-suggestion-repository";
import { PrismaTimingPresetRepository } from "~/server/infrastructure/timing/prisma-timing-preset-repository";
import { PrismaTimingPresetRevisionRepository } from "~/server/infrastructure/timing/prisma-timing-preset-revision-repository";
import { PrismaTimingBacktestRepository } from "~/server/infrastructure/timing/prisma-timing-backtest-repository";
import { PrismaTimingExecutionRecordRepository } from "~/server/infrastructure/timing/prisma-timing-execution-record-repository";
import { PrismaTimingRecommendationRepository } from "~/server/infrastructure/timing/prisma-timing-recommendation-repository";
import { PrismaTimingReviewRecordRepository } from "~/server/infrastructure/timing/prisma-timing-review-record-repository";
import { PrismaTimingSignalSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-signal-snapshot-repository";
import { PythonTimingDataClient } from "~/server/infrastructure/timing/python-timing-data-client";

const portfolioPositionInput = z.object({
  stockCode: z.string().regex(/^\d{6}$/, "stockCode must be 6 digits"),
  stockName: z.string().trim().min(1).max(64),
  quantity: z.number().nonnegative(),
  costBasis: z.number().nonnegative(),
  currentWeightPct: z.number().min(0).max(100),
  sector: z.string().trim().min(1).max(64).optional(),
  themes: z.array(z.string().trim().min(1).max(64)).max(10).optional(),
  openedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  lastAddedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  invalidationPrice: z.number().positive().optional(),
  plannedHoldingDays: z.number().int().positive().max(3650).optional(),
});

const portfolioRiskPreferencesInput = z.object({
  maxSingleNamePct: z.number().positive().max(100),
  maxThemeExposurePct: z.number().positive().max(100),
  defaultProbePct: z.number().positive().max(100),
  maxPortfolioRiskBudgetPct: z.number().positive().max(100),
});

const portfolioSnapshotFields = {
  name: z.string().trim().min(1).max(64),
  baseCurrency: z.string().trim().min(1).max(12).default("CNY"),
  cash: z.number().min(0),
  totalCapital: z.number().positive(),
  positions: z.array(portfolioPositionInput).max(100).default([]),
  riskPreferences: portfolioRiskPreferencesInput,
};

const portfolioSnapshotInput = z
  .object(portfolioSnapshotFields)
  .refine((value) => value.totalCapital >= value.cash, {
    message: "totalCapital must be greater than or equal to cash",
    path: ["totalCapital"],
  });

const listTimingCardsInput = z.object({
  limit: z.number().int().min(1).max(100).default(24),
  stockCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  sourceType: z.enum(["single", "watchlist", "screening"]).optional(),
  watchListId: z.string().uuid().optional(),
});

const getTimingCardInput = z.object({
  id: z.string().cuid(),
});

const getTimingReportInput = z.object({
  cardId: z.string().cuid(),
});

const getTimingSeriesInput = z.object({
  cardId: z.string().cuid(),
  timeframe: z.enum([
    "DAILY",
    "WEEKLY",
    "MONTHLY",
    "MINUTE_60",
    "MINUTE_30",
    "MINUTE_15",
    "MINUTE_1",
  ]),
});

const updatePortfolioSnapshotInput = z
  .object({
    id: z.string().cuid(),
    ...portfolioSnapshotFields,
  })
  .refine((value) => value.totalCapital >= value.cash, {
    message: "totalCapital must be greater than or equal to cash",
    path: ["totalCapital"],
  });

const listRecommendationsInput = z.object({
  limit: z.number().int().min(1).max(100).default(24),
  watchListId: z.string().uuid().optional(),
  portfolioSnapshotId: z.string().cuid().optional(),
  workflowRunId: z.string().cuid().optional(),
});

const listReviewRecordsInput = z.object({
  limit: z.number().int().min(1).max(100).default(24),
  stockCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  completedOnly: z.boolean().default(false),
});

const listTimingFeedbackSuggestionsInput = z.object({
  limit: z.number().int().min(1).max(100).default(24),
  presetId: z.string().cuid().optional(),
  status: z.enum(["PENDING", "APPLIED", "DISMISSED"]).optional(),
});

const timingPresetConfigInput = z.object({
  contextWeights: z
    .object({
      signalContext: z.number().positive().max(3).optional(),
      marketContext: z.number().positive().max(3).optional(),
      positionContext: z.number().positive().max(3).optional(),
      feedbackContext: z.number().positive().max(3).optional(),
    })
    .optional(),
  signalEngineWeights: z
    .object({
      multiTimeframeAlignment: z.number().positive().max(3).optional(),
      relativeStrength: z.number().positive().max(3).optional(),
      volatilityPercentile: z.number().positive().max(3).optional(),
      liquidityStructure: z.number().positive().max(3).optional(),
      breakoutFailure: z.number().positive().max(3).optional(),
      gapVolumeQuality: z.number().positive().max(3).optional(),
    })
    .optional(),
  positionWeights: z
    .object({
      invalidationRiskPenalty: z.number().min(0).max(40).optional(),
      matureGainTrimBoost: z.number().min(0).max(40).optional(),
      lossNearInvalidationPenalty: z.number().min(0).max(40).optional(),
      earlyEntryBonus: z.number().min(0).max(20).optional(),
    })
    .optional(),
  feedbackPolicy: z
    .object({
      lookbackDays: z.number().int().min(30).max(365).optional(),
      minimumSamples: z.number().int().min(4).max(100).optional(),
      weightStep: z.number().min(0.05).max(1).optional(),
      actionThresholdStep: z.number().int().min(1).max(10).optional(),
      successRateDeltaThreshold: z.number().min(1).max(50).optional(),
      averageReturnDeltaThreshold: z.number().min(0.5).max(20).optional(),
    })
    .optional(),
  confidenceThresholds: z
    .object({
      signalStrengthWeight: z.number().positive().max(1).optional(),
      alignmentWeight: z.number().positive().max(100).optional(),
      riskPenaltyPerFlag: z.number().min(0).max(20).optional(),
      neutralPenalty: z.number().min(0).max(20).optional(),
      minConfidence: z.number().min(0).max(100).optional(),
      maxConfidence: z.number().min(0).max(100).optional(),
    })
    .optional(),
  actionThresholds: z
    .object({
      addConfidence: z.number().min(0).max(100).optional(),
      addSignalStrength: z.number().min(0).max(100).optional(),
      probeConfidence: z.number().min(0).max(100).optional(),
      probeSignalStrength: z.number().min(0).max(100).optional(),
      holdConfidence: z.number().min(0).max(100).optional(),
      trimConfidence: z.number().min(0).max(100).optional(),
      exitConfidence: z.number().min(0).max(100).optional(),
    })
    .optional(),
  reviewSchedule: z
    .object({
      horizons: z
        .array(z.enum(["T5", "T10", "T20"]))
        .min(1)
        .max(3)
        .optional(),
    })
    .optional(),
});

const saveTimingPresetInput = z.object({
  id: z.string().cuid().optional(),
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(240).optional(),
  config: timingPresetConfigInput,
});

const updateTimingFeedbackSuggestionInput = z.object({
  id: z.string().cuid(),
});

const timingPresetConfigV2Input = z.custom<TimingPresetConfigV2>(
  (value) => {
    if (
      !value ||
      typeof value !== "object" ||
      (value as { schemaVersion?: unknown }).schemaVersion !== 2
    ) {
      return false;
    }
    try {
      return validateTimingPresetConfigV2(value as TimingPresetConfigV2).length === 0;
    } catch {
      return false;
    }
  },
  { message: "择时策略v2配置无效" },
);

const createTimingStrategyInput = z.object({
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(240).optional(),
  setup: z.enum([
    "TREND_CONTINUATION",
    "BREAKOUT",
    "PULLBACK",
    "OVERSOLD_REVERSAL",
  ]),
  timeframeTemplate: z
    .enum(["SHORT_SWING", "SWING", "MEDIUM_TERM"])
    .default("SWING"),
});

const updateTimingStrategyDraftInput = z.object({
  revisionId: z.string().cuid(),
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(240).optional(),
  config: timingPresetConfigV2Input,
});

const revisionIdInput = z.object({ revisionId: z.string().cuid() });

const createTimingExecutionRecordInput = z
  .object({
    revisionId: z.string().cuid(),
    analysisCardId: z.string().cuid().optional(),
    recommendationId: z.string().cuid().optional(),
    decision: z.enum(["ACCEPTED", "REJECTED", "SKIPPED"]),
    executedAt: z.date().optional(),
    price: z.number().positive().optional(),
    quantity: z.number().positive().optional(),
    fees: z.number().min(0).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.analysisCardId || value.recommendationId, {
    message: "执行记录必须关联择时卡片或组合建议",
  });

export const timingRouter = createTRPCRouter({
  listTimingStrategies: protectedProcedure.query(async ({ ctx }) => {
    return new PrismaTimingPresetRevisionRepository(ctx.db).listStrategies(
      ctx.session.user.id,
    );
  }),

  createTimingStrategy: protectedProcedure
    .input(createTimingStrategyInput)
    .mutation(async ({ ctx, input }) => {
      return new PrismaTimingPresetRevisionRepository(ctx.db).createStrategy({
        userId: ctx.session.user.id,
        name: input.name,
        description: input.description,
        config: createTimingPresetConfigV2(
          input.setup,
          input.timeframeTemplate,
        ),
      });
    }),

  updateTimingStrategyDraft: protectedProcedure
    .input(updateTimingStrategyDraftInput)
    .mutation(async ({ ctx, input }) => {
      const strategy = await new PrismaTimingPresetRevisionRepository(
        ctx.db,
      ).updateDraft({
        userId: ctx.session.user.id,
        revisionId: input.revisionId,
        name: input.name,
        description: input.description,
        config: input.config,
      });
      if (!strategy) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "仅草稿修订允许修改",
        });
      }
      return strategy;
    }),

  cloneTimingStrategyRevision: protectedProcedure
    .input(revisionIdInput)
    .mutation(async ({ ctx, input }) => {
      const revision = await new PrismaTimingPresetRevisionRepository(
        ctx.db,
      ).cloneAsDraft({
        userId: ctx.session.user.id,
        revisionId: input.revisionId,
      });
      if (!revision) {
        throw new TRPCError({ code: "NOT_FOUND", message: "策略修订不存在" });
      }
      return revision;
    }),

  listTimingBacktests: protectedProcedure
    .input(revisionIdInput)
    .query(async ({ ctx, input }) => {
      return new PrismaTimingBacktestRepository(ctx.db).listForRevision(
        ctx.session.user.id,
        input.revisionId,
      );
    }),

  publishTimingStrategyRevision: protectedProcedure
    .input(revisionIdInput)
    .mutation(async ({ ctx, input }) => {
      const revisionRepository = new PrismaTimingPresetRevisionRepository(
        ctx.db,
      );
      const revision = await revisionRepository.getRevision(
        ctx.session.user.id,
        input.revisionId,
      );
      if (!revision) {
        throw new TRPCError({ code: "NOT_FOUND", message: "策略修订不存在" });
      }
      const validation = await new PrismaTimingBacktestRepository(
        ctx.db,
      ).latestPassing({
        userId: ctx.session.user.id,
        presetRevisionId: revision.id,
        configHash: revision.configHash,
      });
      if (!validation) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "当前配置尚未通过同版本历史回放门禁",
        });
      }
      const strategy = await revisionRepository.publish({
        userId: ctx.session.user.id,
        revisionId: revision.id,
        validatedConfigHash: revision.configHash,
      });
      if (!strategy) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "策略修订当前不可发布",
        });
      }
      return strategy;
    }),

  createTimingExecutionRecord: protectedProcedure
    .input(createTimingExecutionRecordInput)
    .mutation(async ({ ctx, input }) => {
      const revision = await new PrismaTimingPresetRevisionRepository(
        ctx.db,
      ).getRevision(ctx.session.user.id, input.revisionId);
      if (!revision) {
        throw new TRPCError({ code: "NOT_FOUND", message: "策略修订不存在" });
      }
      if (input.analysisCardId) {
        const card = await ctx.db.timingAnalysisCard.findFirst({
          where: { id: input.analysisCardId, userId: ctx.session.user.id },
          select: { id: true },
        });
        if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "择时卡片不存在" });
      }
      if (input.recommendationId) {
        const recommendation = await ctx.db.timingRecommendation.findFirst({
          where: { id: input.recommendationId, userId: ctx.session.user.id },
          select: { id: true },
        });
        if (!recommendation) throw new TRPCError({ code: "NOT_FOUND", message: "组合建议不存在" });
      }
      return new PrismaTimingExecutionRecordRepository(ctx.db).create({
        userId: ctx.session.user.id,
        presetRevisionId: revision.id,
        analysisCardId: input.analysisCardId,
        recommendationId: input.recommendationId,
        decision: input.decision,
        executedAt: input.executedAt,
        price: input.price,
        quantity: input.quantity,
        fees: input.fees,
        notes: input.notes,
      });
    }),
  listTimingCards: protectedProcedure
    .input(listTimingCardsInput)
    .query(async ({ ctx, input }) => {
      const repository = new PrismaTimingAnalysisCardRepository(ctx.db);

      return repository.listForUser({
        userId: ctx.session.user.id,
        limit: input.limit,
        stockCode: input.stockCode,
        sourceType: input.sourceType,
        watchListId: input.watchListId,
      });
    }),

  getTimingCard: protectedProcedure
    .input(getTimingCardInput)
    .query(async ({ ctx, input }) => {
      const repository = new PrismaTimingAnalysisCardRepository(ctx.db);
      const card = await repository.getByIdForUser(
        ctx.session.user.id,
        input.id,
      );

      if (!card) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Timing card not found",
        });
      }

      return card;
    }),

  getTimingReport: protectedProcedure
    .input(getTimingReportInput)
    .query(async ({ ctx, input }) => {
      const service = new TimingReportService({
        analysisCardRepository: new PrismaTimingAnalysisCardRepository(ctx.db),
        signalSnapshotRepository: new PrismaTimingSignalSnapshotRepository(
          ctx.db,
        ),
        reviewRecordRepository: new PrismaTimingReviewRecordRepository(ctx.db),
        recommendationRepository: new PrismaTimingRecommendationRepository(
          ctx.db,
        ),
        marketContextSnapshotRepository:
          new PrismaTimingMarketContextSnapshotRepository(ctx.db),
        kronosForecastSnapshotRepository:
          new PrismaTimingKronosForecastSnapshotRepository(ctx.db),
        timingDataClient: new PythonTimingDataClient(),
        marketRegimeService: new MarketRegimeService(),
      });
      const report = await service.getTimingReport({
        userId: ctx.session.user.id,
        cardId: input.cardId,
      });

      if (!report) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Timing report not found",
        });
      }

      return report;
    }),

  getTimingSeries: protectedProcedure
    .input(getTimingSeriesInput)
    .query(async ({ ctx, input }) => {
      const service = new TimingReportService({
        analysisCardRepository: new PrismaTimingAnalysisCardRepository(ctx.db),
        signalSnapshotRepository: new PrismaTimingSignalSnapshotRepository(
          ctx.db,
        ),
        reviewRecordRepository: new PrismaTimingReviewRecordRepository(ctx.db),
        recommendationRepository: new PrismaTimingRecommendationRepository(
          ctx.db,
        ),
        marketContextSnapshotRepository:
          new PrismaTimingMarketContextSnapshotRepository(ctx.db),
        kronosForecastSnapshotRepository:
          new PrismaTimingKronosForecastSnapshotRepository(ctx.db),
        timingDataClient: new PythonTimingDataClient(),
        marketRegimeService: new MarketRegimeService(),
      });
      const series = await service.getTimingSeries({
        userId: ctx.session.user.id,
        cardId: input.cardId,
        timeframe: input.timeframe,
      });
      if (!series) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Timing series not found",
        });
      }
      return series;
    }),

  createPortfolioSnapshot: protectedProcedure
    .input(portfolioSnapshotInput)
    .mutation(async ({ ctx, input }) => {
      const repository = new PrismaPortfolioSnapshotRepository(ctx.db);
      return repository.create({
        userId: ctx.session.user.id,
        name: input.name,
        baseCurrency: input.baseCurrency,
        cash: input.cash,
        totalCapital: input.totalCapital,
        positions: input.positions,
        riskPreferences: input.riskPreferences,
      });
    }),

  updatePortfolioSnapshot: protectedProcedure
    .input(updatePortfolioSnapshotInput)
    .mutation(async ({ ctx, input }) => {
      const repository = new PrismaPortfolioSnapshotRepository(ctx.db);
      const snapshot = await repository.update(input.id, ctx.session.user.id, {
        name: input.name,
        baseCurrency: input.baseCurrency,
        cash: input.cash,
        totalCapital: input.totalCapital,
        positions: input.positions,
        riskPreferences: input.riskPreferences,
      });

      if (!snapshot) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Portfolio snapshot not found",
        });
      }

      return snapshot;
    }),

  listPortfolioSnapshots: protectedProcedure.query(async ({ ctx }) => {
    const repository = new PrismaPortfolioSnapshotRepository(ctx.db);
    return repository.listForUser(ctx.session.user.id);
  }),

  listRecommendations: protectedProcedure
    .input(listRecommendationsInput)
    .query(async ({ ctx, input }) => {
      const repository = new PrismaTimingRecommendationRepository(ctx.db);
      return repository.listForUser({
        userId: ctx.session.user.id,
        limit: input.limit,
        watchListId: input.watchListId,
        portfolioSnapshotId: input.portfolioSnapshotId,
        workflowRunId: input.workflowRunId,
      });
    }),

  listReviewRecords: protectedProcedure
    .input(listReviewRecordsInput)
    .query(async ({ ctx, input }) => {
      const repository = new PrismaTimingReviewRecordRepository(ctx.db);
      return repository.listForUser({
        userId: ctx.session.user.id,
        limit: input.limit,
        stockCode: input.stockCode,
        completedOnly: input.completedOnly,
      });
    }),

  listTimingPresets: protectedProcedure.query(async ({ ctx }) => {
    const repository = new PrismaTimingPresetRepository(ctx.db);
    return repository.listForUser(ctx.session.user.id);
  }),

  listTimingFeedbackSuggestions: protectedProcedure
    .input(listTimingFeedbackSuggestionsInput)
    .query(async ({ ctx, input }) => {
      const repository = new PrismaTimingPresetAdjustmentSuggestionRepository(
        ctx.db,
      );
      return repository.listForUser({
        userId: ctx.session.user.id,
        limit: input.limit,
        presetId: input.presetId,
        status: input.status,
      });
    }),

  saveTimingPreset: protectedProcedure
    .input(saveTimingPresetInput)
    .mutation(async ({ ctx, input }) => {
      const repository = new PrismaTimingPresetRepository(ctx.db);

      if (input.id) {
        const preset = await repository.update(input.id, ctx.session.user.id, {
          name: input.name,
          description: input.description,
          config: input.config,
        });

        if (!preset) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Timing preset not found",
          });
        }

        return preset;
      }

      return repository.create({
        userId: ctx.session.user.id,
        name: input.name,
        description: input.description,
        config: input.config,
      });
    }),

  applyTimingFeedbackSuggestion: protectedProcedure
    .input(updateTimingFeedbackSuggestionInput)
    .mutation(async ({ ctx, input }) => {
      const suggestionRepository =
        new PrismaTimingPresetAdjustmentSuggestionRepository(ctx.db);
      const presetRepository = new PrismaTimingPresetRepository(ctx.db);
      const suggestion = await suggestionRepository.getByIdForUser(
        ctx.session.user.id,
        input.id,
      );

      if (!suggestion) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Feedback suggestion not found",
        });
      }

      if (!suggestion.presetId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Feedback suggestion is not bound to a preset",
        });
      }

      const preset = await presetRepository.getByIdForUser(
        ctx.session.user.id,
        suggestion.presetId,
      );
      if (!preset) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Timing preset not found",
        });
      }

      const nextConfig = applyTimingPresetPatch(
        preset.config,
        suggestion.patch,
      );

      await presetRepository.update(suggestion.presetId, ctx.session.user.id, {
        name: preset.name,
        description: preset.description ?? undefined,
        config: nextConfig,
      });

      return suggestionRepository.markApplied(suggestion.id);
    }),

  dismissTimingFeedbackSuggestion: protectedProcedure
    .input(updateTimingFeedbackSuggestionInput)
    .mutation(async ({ ctx, input }) => {
      const repository = new PrismaTimingPresetAdjustmentSuggestionRepository(
        ctx.db,
      );
      const suggestion = await repository.getByIdForUser(
        ctx.session.user.id,
        input.id,
      );

      if (!suggestion) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Feedback suggestion not found",
        });
      }

      return repository.markDismissed(suggestion.id);
    }),
});

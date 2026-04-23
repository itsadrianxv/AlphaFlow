import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { MarketRegimeService } from "~/modules/timing/server/application/market-regime-service";
import { applyTimingPresetPatch } from "~/modules/timing/server/application/timing-feedback-service";
import { TimingReportService } from "~/modules/timing/server/application/timing-report-service";
import { PrismaPortfolioSnapshotRepository } from "~/modules/timing/server/infrastructure/prisma-portfolio-snapshot-repository";
import { PrismaTimingAnalysisCardRepository } from "~/modules/timing/server/infrastructure/prisma-timing-analysis-card-repository";
import { PrismaTimingMarketContextSnapshotRepository } from "~/modules/timing/server/infrastructure/prisma-timing-market-context-snapshot-repository";
import { PrismaTimingPresetAdjustmentSuggestionRepository } from "~/modules/timing/server/infrastructure/prisma-timing-preset-adjustment-suggestion-repository";
import { PrismaTimingPresetRepository } from "~/modules/timing/server/infrastructure/prisma-timing-preset-repository";
import { PrismaTimingRecommendationRepository } from "~/modules/timing/server/infrastructure/prisma-timing-recommendation-repository";
import { PrismaTimingReviewRecordRepository } from "~/modules/timing/server/infrastructure/prisma-timing-review-record-repository";
import { PrismaTimingSignalSnapshotRepository } from "~/modules/timing/server/infrastructure/prisma-timing-signal-snapshot-repository";
import { PythonTimingDataClient } from "~/modules/timing/server/infrastructure/python-timing-data-client";
import { createTRPCRouter, protectedProcedure } from "~/platform/trpc/server";

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

export const timingRouter = createTRPCRouter({
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
        marketContextSnapshotRepository:
          new PrismaTimingMarketContextSnapshotRepository(ctx.db),
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

import { readFile } from "node:fs/promises";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { timingDecisionInputSchema } from "~/contracts/timing-decision";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { MarketRegimeService } from "~/server/application/timing/market-regime-service";
import { TimingDecisionService } from "~/server/application/timing/timing-decision-service";
import { applyTimingPresetPatch } from "~/server/application/timing/timing-feedback-service";
import { TimingReportService } from "~/server/application/timing/timing-report-service";
import {
  evaluateTimingBacktestQuality,
  simulateTimingBacktestExecution,
  summarizeTimingBacktestPerformance,
} from "~/server/domain/timing/services/timing-backtest-policy";
import { evaluateTimingRules } from "~/server/domain/timing/services/timing-rule-engine";
import {
  createTimingPresetConfigV2,
  validateTimingPresetConfigV2,
} from "~/server/domain/timing/strategy-v2";
import type {
  TimingPresetConfigV2,
  TimingTimeframe,
} from "~/server/domain/timing/types";
import { TIMING_DECISION_PIPELINE_TEMPLATE_CODE } from "~/server/domain/workflow/types";
import { PrismaWatchListRepository } from "~/server/infrastructure/screening/prisma-watch-list-repository";
import { PrismaPortfolioSnapshotRepository } from "~/server/infrastructure/timing/prisma-portfolio-snapshot-repository";
import { PrismaTimingAnalysisCardRepository } from "~/server/infrastructure/timing/prisma-timing-analysis-card-repository";
import { PrismaTimingBacktestRepository } from "~/server/infrastructure/timing/prisma-timing-backtest-repository";
import { PrismaTimingExecutionRecordRepository } from "~/server/infrastructure/timing/prisma-timing-execution-record-repository";
import { PrismaTimingKronosForecastSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-kronos-forecast-snapshot-repository";
import { PrismaTimingMarketContextSnapshotRepository } from "~/server/infrastructure/timing/prisma-timing-market-context-snapshot-repository";
import { PrismaTimingPresetAdjustmentSuggestionRepository } from "~/server/infrastructure/timing/prisma-timing-preset-adjustment-suggestion-repository";
import { PrismaTimingPresetRepository } from "~/server/infrastructure/timing/prisma-timing-preset-repository";
import { PrismaTimingPresetRevisionRepository } from "~/server/infrastructure/timing/prisma-timing-preset-revision-repository";
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
  workflowRunId: z.string().cuid().optional(),
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
      return (
        validateTimingPresetConfigV2(value as TimingPresetConfigV2).length === 0
      );
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
  riskProfile: z.enum(["STEADY", "BALANCED", "AGGRESSIVE"]).default("BALANCED"),
});

const updateTimingStrategyDraftInput = z.object({
  revisionId: z.string().cuid(),
  name: z.string().trim().min(1).max(64),
  description: z.string().trim().max(240).optional(),
  config: timingPresetConfigV2Input,
});

const revisionIdInput = z.object({ revisionId: z.string().cuid() });

const timingRunPreflightInput = z.object({
  revisionId: z.string().cuid(),
  watchListId: z.string().uuid(),
  portfolioSnapshotId: z.string().cuid().optional(),
  analysisDateMode: z
    .enum(["LATEST_COMPLETE", "CURRENT_PARTIAL", "EXPLICIT"])
    .default("LATEST_COMPLETE"),
  asOfDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const runTimingBacktestInput = z
  .object({
    revisionId: z.string().cuid(),
    watchListId: z.string().uuid().optional(),
    stockCodes: z
      .array(z.string().regex(/^\d{6}$/))
      .min(1)
      .max(50)
      .optional(),
  })
  .refine((value) => value.watchListId || value.stockCodes?.length, {
    message: "请选择回放股票。",
  });

type ScreeningUniverse = {
  tradingDate?: string;
  records?: Array<{ stockCode: string; stockName: string; market: string }>;
};

async function buildBacktestUniverse(initialCodes: string[]) {
  const selected = new Set(initialCodes);
  let capturedAt = new Date().toISOString();
  try {
    const file = await readFile(
      path.join(process.cwd(), "..", "data", "screening_stock_universe.json"),
      "utf8",
    );
    const universe = JSON.parse(file) as ScreeningUniverse;
    capturedAt = universe.tradingDate ?? capturedAt;
    for (const stock of universe.records ?? []) {
      if (selected.size >= 20) break;
      if (stock.market === "BJ" || /ST|退/.test(stock.stockName)) continue;
      selected.add(stock.stockCode);
    }
  } catch {
    // 股票池不可用时仍允许原始目标进入回放，质量门禁会据实失败。
  }
  return { stockCodes: [...selected], capturedAt };
}

function collectTimingIndicatorIds(config: TimingPresetConfigV2) {
  return [
    ...new Set(
      config.ruleGroups.flatMap((group) =>
        group.rules
          .filter((rule) => rule.enabled)
          .map((rule) => rule.indicatorId),
      ),
    ),
  ];
}

function collectTimingTimeframes(config: TimingPresetConfigV2) {
  return [
    ...new Set(
      [
        ...config.timeframePlan.contextTimeframes,
        config.timeframePlan.decisionTimeframe,
        config.timeframePlan.executionTimeframe,
        config.timeframePlan.fallbackExecutionTimeframe,
        ...config.ruleGroups.flatMap((group) =>
          group.rules.map((rule) => rule.timeframe),
        ),
      ].filter((item): item is TimingTimeframe => Boolean(item)),
    ),
  ];
}

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
  getDecisionDefaults: protectedProcedure.query(async ({ ctx }) => {
    const [latestRun, latestPortfolio] = await Promise.all([
      ctx.db.workflowRun.findFirst({
        where: {
          userId: ctx.session.user.id,
          template: { is: { code: TIMING_DECISION_PIPELINE_TEMPLATE_CODE } },
        },
        orderBy: { createdAt: "desc" },
        select: { input: true, createdAt: true },
      }),
      new PrismaPortfolioSnapshotRepository(ctx.db).getLatestRunInput(
        ctx.session.user.id,
      ),
    ]);
    const rawInput = latestRun?.input;
    const previousInput =
      rawInput &&
      typeof rawInput === "object" &&
      !Array.isArray(rawInput) &&
      "decisionInput" in rawInput
        ? rawInput.decisionInput
        : null;
    return {
      horizon: "SWING" as const,
      riskProfile: "BALANCED" as const,
      previousInput,
      previousInputAt: latestRun?.createdAt ?? null,
      previousPortfolio: latestPortfolio,
    };
  }),

  previewDecision: protectedProcedure
    .input(timingDecisionInputSchema)
    .query(async ({ ctx, input }) => {
      try {
        return await new TimingDecisionService({
          portfolioRepository: new PrismaPortfolioSnapshotRepository(ctx.db),
          revisionRepository: new PrismaTimingPresetRevisionRepository(ctx.db),
          timingDataClient: new PythonTimingDataClient(),
        }).preview(ctx.session.user.id, input);
      } catch (error) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            error instanceof Error
              ? error.message
              : "暂时无法检查本次分析数据。",
        });
      }
    }),

  listTimingStrategies: protectedProcedure.query(async ({ ctx }) => {
    return new PrismaTimingPresetRevisionRepository(ctx.db).listStrategies(
      ctx.session.user.id,
    );
  }),

  getTimingRunPreflight: protectedProcedure
    .input(timingRunPreflightInput)
    .query(async ({ ctx, input }) => {
      const [revision, watchList, portfolio] = await Promise.all([
        new PrismaTimingPresetRevisionRepository(ctx.db).getRevision(
          ctx.session.user.id,
          input.revisionId,
        ),
        new PrismaWatchListRepository(ctx.db).findById(input.watchListId),
        input.portfolioSnapshotId
          ? new PrismaPortfolioSnapshotRepository(ctx.db).getByIdForUser(
              ctx.session.user.id,
              input.portfolioSnapshotId,
            )
          : Promise.resolve(null),
      ]);
      if (!revision || revision.status !== "PUBLISHED") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "数据预检必须引用已发布策略修订",
        });
      }
      if (!watchList || watchList.userId !== ctx.session.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "自选股列表不存在" });
      }
      if (input.portfolioSnapshotId && !portfolio) {
        throw new TRPCError({ code: "NOT_FOUND", message: "组合快照不存在" });
      }

      const targets = new Map(
        watchList.stocks.map((stock) => [
          stock.stockCode.value,
          { stockCode: stock.stockCode.value, stockName: stock.stockName },
        ]),
      );
      for (const position of portfolio?.positions ?? []) {
        targets.set(position.stockCode, {
          stockCode: position.stockCode,
          stockName: position.stockName,
        });
      }
      const response = targets.size
        ? await new PythonTimingDataClient().getEvidenceBatch({
            stockCodes: [...targets.keys()],
            asOfDate: input.asOfDate,
            timeframes: collectTimingTimeframes(revision.config),
            indicatorIds: collectTimingIndicatorIds(revision.config),
          })
        : { items: [], errors: [] };
      const primaryRules = revision.config.ruleGroups
        .filter((group) => group.role === "PRIMARY")
        .flatMap((group) => group.rules.filter((rule) => rule.enabled));
      const vetoRules = revision.config.ruleGroups
        .filter((group) => group.role === "VETO")
        .flatMap((group) => group.rules.filter((rule) => rule.enabled));
      const items = response.items.map((evidence) => {
        const find = (indicatorId: string, timeframe: TimingTimeframe) =>
          evidence.features.find(
            (feature) =>
              feature.indicatorId === indicatorId &&
              feature.timeframe === timeframe,
          );
        const missingPrimary = primaryRules
          .filter(
            (rule) =>
              find(rule.indicatorId, rule.timeframe)?.status !== "AVAILABLE",
          )
          .map((rule) => rule.name);
        const unresolvedVetos = vetoRules
          .filter(
            (rule) =>
              find(rule.indicatorId, rule.timeframe)?.status !== "AVAILABLE",
          )
          .map((rule) => rule.name);
        return {
          stockCode: evidence.stockCode,
          stockName: evidence.stockName,
          asOfDate: evidence.asOfDate,
          primaryComplete: missingPrimary.length === 0,
          vetoRiskResolved: unresolvedVetos.length === 0,
          missingPrimary,
          unresolvedVetos,
          warnings: evidence.warnings,
          dataManifest: evidence.dataManifest,
          inputHash: evidence.inputHash,
        };
      });
      const returnedCodes = new Set(items.map((item) => item.stockCode));
      const missingTargets = [...targets.values()]
        .filter((target) => !returnedCodes.has(target.stockCode))
        .map((target) => target.stockCode);
      const complete =
        missingTargets.length === 0 &&
        response.errors.length === 0 &&
        items.every((item) => item.primaryComplete && item.vetoRiskResolved);

      return {
        revisionId: revision.id,
        configHash: revision.configHash,
        analysisDateMode: input.analysisDateMode,
        analysisDate: items.map((item) => item.asOfDate).sort()[0] ?? null,
        complete,
        canRun: complete || input.analysisDateMode === "CURRENT_PARTIAL",
        items,
        missingTargets,
        errors: response.errors,
      };
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
          input.riskProfile,
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

  runTimingBacktest: protectedProcedure
    .input(runTimingBacktestInput)
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
      if (revision.status !== "DRAFT" && revision.status !== "VALIDATING") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "仅草稿或验证中的修订可发起发布前回放",
        });
      }

      const watchList = input.watchListId
        ? await new PrismaWatchListRepository(ctx.db).findById(
            input.watchListId,
          )
        : null;
      if (
        input.watchListId &&
        (!watchList || watchList.userId !== ctx.session.user.id)
      ) {
        throw new TRPCError({ code: "NOT_FOUND", message: "自选股列表不存在" });
      }
      const initialCodes = [
        ...new Set([
          ...(input.stockCodes ?? []),
          ...(watchList?.stocks.map((stock) => stock.stockCode.value) ?? []),
        ]),
      ];
      const universe = await buildBacktestUniverse(initialCodes);

      if (revision.status === "DRAFT") {
        await revisionRepository.markValidating(
          ctx.session.user.id,
          revision.id,
        );
      }
      const repository = new PrismaTimingBacktestRepository(ctx.db);
      const run = await repository.create({
        userId: ctx.session.user.id,
        presetRevisionId: revision.id,
        watchListId: input.watchListId,
        configHash: revision.configHash,
        stockCodes: universe.stockCodes,
        config: revision.config,
        universeCapturedAt: universe.capturedAt,
      });

      try {
        const end = new Date();
        const start = new Date(end);
        start.setUTCMonth(
          start.getUTCMonth() -
            Math.max(24, revision.config.backtestPolicy.minimumMonths),
        );
        const formatDate = (value: Date) => value.toISOString().slice(0, 10);
        const history = await new PythonTimingDataClient({
          timeoutMs: 10 * 60 * 1000,
        }).getEvidenceHistory({
          stockCodes: universe.stockCodes,
          startDate: formatDate(start),
          endDate: formatDate(end),
          timeframes: collectTimingTimeframes(revision.config),
          indicatorIds: collectTimingIndicatorIds(revision.config),
          lookbackDays: 900,
          sampleEveryTradingDays: 5,
        });
        const audits = history.items.flatMap((stock) =>
          stock.timeline.map((evidence) => ({
            stock,
            evidence,
            audit: evaluateTimingRules({
              config: revision.config,
              features: evidence.features,
              marketState: stock.marketStates[evidence.asOfDate] ?? "NEUTRAL",
              hasPosition: false,
              strategyRevisionId: revision.id,
              configHash: revision.configHash,
            }),
          })),
        );
        const dates = audits.map((item) => item.evidence.asOfDate).sort();
        const coveredMonths =
          dates.length > 1
            ? Math.floor(
                (new Date(dates.at(-1) ?? 0).getTime() -
                  new Date(dates[0] ?? 0).getTime()) /
                  (30.4375 * 24 * 60 * 60 * 1000),
              )
            : 0;
        const primaryEvaluations = audits.flatMap((item) =>
          item.audit.ruleEvaluations.filter((rule) => rule.role === "PRIMARY"),
        );
        const primaryCompletenessPct = primaryEvaluations.length
          ? (primaryEvaluations.filter(
              (rule) => rule.status === "PASSED" || rule.status === "FAILED",
            ).length /
              primaryEvaluations.length) *
            100
          : 0;
        const noLookaheadPassed = audits.every((item) => {
          const signalDate = item.evidence.asOfDate;
          return item.audit.ruleEvaluations.every(
            (rule) => !rule.asOfDate || rule.asOfDate <= signalDate,
          );
        });
        const triggered = audits.filter(
          (item) =>
            item.audit.status === "TRIGGERED" &&
            item.audit.finalAction &&
            ["PROBE", "ENTER", "ADD", "TRIM", "EXIT"].includes(
              item.audit.finalAction,
            ),
        );
        const maxReviewDays = Math.max(
          ...revision.config.reviewTradingDays,
          20,
        );
        const events = [];
        const results = [];
        for (const item of triggered) {
          const signalDate = item.evidence.asOfDate;
          const futureBars = item.stock.bars.filter(
            (bar) => bar.tradeDate > signalDate,
          );
          const next = futureBars[0];
          const exit =
            futureBars[Math.min(maxReviewDays - 1, futureBars.length - 1)];
          if (!next || !exit || !item.audit.finalAction) {
            events.push({
              stockCode: item.stock.stockCode,
              inputHash: item.evidence.inputHash,
              decisionAudit: item.audit,
              warning: "缺少次日或退出日行情，事件未模拟成交。",
            });
            continue;
          }
          const result = simulateTimingBacktestExecution(
            {
              action: item.audit.finalAction,
              signalDate,
              nextTradingDay: {
                tradeDate: next.tradeDate,
                open: next.open,
              },
              exitBar: {
                tradeDate: exit.tradeDate,
                close: exit.close,
                high: Math.max(
                  ...futureBars.slice(0, maxReviewDays).map((bar) => bar.high),
                ),
                low: Math.min(
                  ...futureBars.slice(0, maxReviewDays).map((bar) => bar.low),
                ),
              },
            },
            revision.config.backtestPolicy,
          );
          results.push(result);
          events.push({
            stockCode: item.stock.stockCode,
            inputHash: item.evidence.inputHash,
            dataManifest: item.evidence.dataManifest,
            decisionAudit: item.audit,
            signalDate,
            nextTradingDay: next,
            exitBar: exit,
            result,
          });
        }
        const quality = evaluateTimingBacktestQuality({
          config: revision.config,
          coveredMonths,
          stockCount: history.items.length,
          triggeredEvents: triggered.length,
          primaryCompletenessPct,
          noLookaheadPassed,
        });
        const warnings = [
          "目标不足5只时已从筛选股票池补足并冻结至最多20只。",
          "冻结事件缺少竞价VWAP时使用下一交易日开盘价成交。",
          "历史市场状态按决策日冻结；缺失日期按中性门控降级。",
          "基准收益缺失时，超额收益以0基准降级计算。",
          ...history.errors.map(
            (error) => `${error.stockCode}：${error.message}`,
          ),
        ];
        return repository.complete({
          id: run.id,
          quality,
          performance: summarizeTimingBacktestPerformance(results),
          events,
          warnings,
        });
      } catch (error) {
        await repository.fail(
          run.id,
          error instanceof Error ? error.message : "回放执行失败",
        );
        throw error;
      }
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
        if (!card)
          throw new TRPCError({ code: "NOT_FOUND", message: "择时卡片不存在" });
      }
      if (input.recommendationId) {
        const recommendation = await ctx.db.timingRecommendation.findFirst({
          where: { id: input.recommendationId, userId: ctx.session.user.id },
          select: { id: true },
        });
        if (!recommendation)
          throw new TRPCError({ code: "NOT_FOUND", message: "组合建议不存在" });
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
        workflowRunId: input.workflowRunId,
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

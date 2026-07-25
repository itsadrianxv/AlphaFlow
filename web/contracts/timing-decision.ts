import { z } from "zod";

export const timingDecisionTargetSchema = z.object({
  stockCode: z.string().regex(/^\d{6}$/),
  stockName: z.string().trim().min(1).max(80),
});

export const timingDecisionPositionSchema = timingDecisionTargetSchema.extend({
  currentWeightPct: z.number().min(0).max(100),
  quantity: z.number().min(0).optional(),
  costBasis: z.number().min(0).optional(),
  sector: z.string().trim().max(80).optional(),
  openedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  invalidationPrice: z.number().positive().optional(),
});

const riskPreferencesSchema = z.object({
  maxSingleNamePct: z.number().min(2).max(100),
  maxThemeExposurePct: z.number().min(5).max(100),
  defaultProbePct: z.number().min(0.5).max(100),
  maxPortfolioRiskBudgetPct: z.number().min(1).max(100),
});

export const timingDecisionInputSchema = z
  .object({
    mode: z.enum(["SINGLE", "PORTFOLIO"]),
    targets: z.array(timingDecisionTargetSchema).min(1).max(50),
    positionContext: z.discriminatedUnion("mode", [
      z.object({
        mode: z.literal("SINGLE"),
        held: z.boolean(),
        currentWeightPct: z.number().min(0).max(100).default(0),
        availableCashPct: z.number().min(0).max(100).default(100),
        costBasis: z.number().min(0).optional(),
      }),
      z.object({
        mode: z.literal("PORTFOLIO"),
        totalCapital: z.number().positive(),
        cash: z.number().min(0),
        positions: z.array(timingDecisionPositionSchema).max(100),
      }),
    ]),
    strategySelection: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("SYSTEM"),
        horizon: z.enum(["SHORT_SWING", "SWING", "MEDIUM_TERM"]),
        riskProfile: z.enum(["STEADY", "BALANCED", "AGGRESSIVE"]),
      }),
      z.object({
        kind: z.literal("REVISION"),
        revisionId: z.string().cuid(),
      }),
    ]),
    riskPreferences: riskPreferencesSchema.optional(),
    analysisDate: z.object({
      mode: z
        .enum(["LATEST_COMPLETE", "CURRENT_PARTIAL", "EXPLICIT"])
        .default("LATEST_COMPLETE"),
      asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
    sourceWatchListId: z.string().uuid().optional(),
    idempotencyKey: z.string().min(8).max(128).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode !== value.positionContext.mode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["positionContext", "mode"],
        message: "分析模式与仓位输入不一致。",
      });
    }
    if (
      value.positionContext.mode === "PORTFOLIO" &&
      value.positionContext.cash > value.positionContext.totalCapital
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["positionContext", "cash"],
        message: "可用现金不能超过总资产。",
      });
    }
    if (value.analysisDate.mode === "EXPLICIT" && !value.analysisDate.asOfDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["analysisDate", "asOfDate"],
        message: "请选择交易日。",
      });
    }
  });

export type TimingDecisionInput = z.infer<typeof timingDecisionInputSchema>;

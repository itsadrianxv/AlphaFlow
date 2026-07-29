import { z } from "zod";

export const timingResearchTargetSchema = z.object({
  stockCode: z.string().regex(/^\d{6}$/),
  stockName: z.string().trim().min(1).max(80),
}).strict();

export const portfolioCompositionPositionSchema = timingResearchTargetSchema.extend({
  weightPct: z.number().positive().max(100),
  sector: z.string().trim().max(80).optional(),
  themes: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
}).strict();

export const portfolioCompositionObjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  positions: z.array(portfolioCompositionPositionSchema).min(1).max(100),
}).strict();

export function validatePortfolioCompositionWeights(
  value: z.infer<typeof portfolioCompositionObjectSchema>,
  ctx: z.RefinementCtx,
) {
  const total = value.positions.reduce((sum, item) => sum + item.weightPct, 0);
  if (Math.abs(total - 100) > 0.1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["positions"],
      message: `组合权重合计必须为 100%，当前为 ${Math.round(total * 100) / 100}%。`,
    });
  }
  const codes = value.positions.map((item) => item.stockCode);
  if (new Set(codes).size !== codes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["positions"], message: "组合中不能包含重复股票。" });
  }
}

export const portfolioCompositionSchema = portfolioCompositionObjectSchema.superRefine(
  validatePortfolioCompositionWeights,
);

export const timingResearchRunInputSchema = z.object({
  mode: z.enum(["INDIVIDUAL", "PORTFOLIO"]),
  targets: z.array(timingResearchTargetSchema).min(1).max(50),
  portfolioComposition: portfolioCompositionSchema.optional(),
  strategySelection: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("SYSTEM"), horizon: z.enum(["SHORT_SWING", "SWING", "MEDIUM_TERM"]) }).strict(),
    z.object({ kind: z.literal("REVISION"), revisionId: z.string().cuid() }).strict(),
  ]),
  analysisDate: z.object({
    mode: z.enum(["LATEST_COMPLETE", "CURRENT_PARTIAL", "EXPLICIT"]).default("LATEST_COMPLETE"),
    asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).strict(),
  sourceWatchListId: z.string().uuid().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.mode === "PORTFOLIO" && !value.portfolioComposition) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["portfolioComposition"], message: "组合诊断模式必须提供相对权重组合。" });
  }
  if (value.mode === "INDIVIDUAL" && value.portfolioComposition) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["portfolioComposition"], message: "个股研究模式不接受组合信息。" });
  }
  if (value.analysisDate.mode === "EXPLICIT" && !value.analysisDate.asOfDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["analysisDate", "asOfDate"], message: "请选择研究日期。" });
  }
});

export type TimingResearchRunInput = z.infer<typeof timingResearchRunInputSchema>;

import { z } from "zod";

export const marketContextStatusSchema = z.enum([
  "complete",
  "partial",
  "unavailable",
]);

export const regimeToneSchema = z.enum([
  "risk_on",
  "neutral",
  "risk_off",
  "unknown",
]);

export const growthToneSchema = z.enum([
  "expansion",
  "neutral",
  "contraction",
  "unknown",
]);

export const liquidityToneSchema = z.enum([
  "supportive",
  "neutral",
  "tightening",
  "unknown",
]);

export const marketFlowDirectionSchema = z.enum([
  "inflow",
  "outflow",
  "flat",
  "unknown",
]);

export const marketContextAvailabilityEntrySchema = z.object({
  available: z.boolean(),
  warning: z.string().nullable().optional(),
});

export const marketRegimeSummarySchema = z.object({
  overallTone: regimeToneSchema,
  growthTone: growthToneSchema,
  liquidityTone: liquidityToneSchema,
  riskTone: regimeToneSchema,
  summary: z.string().min(1),
  drivers: z.array(z.string()).default([]),
});

export const marketFlowSummarySchema = z.object({
  northboundNetAmount: z.number().nullable().optional(),
  direction: marketFlowDirectionSchema,
  summary: z.string().min(1),
});

export const marketContextSectionHintSchema = z.object({
  summary: z.string().min(1),
  suggestedQuestion: z.string().nullable().optional(),
  suggestedDraftName: z.string().nullable().optional(),
});

export const hotThemeConceptMatchSchema = z.object({
  name: z.string().min(1),
  code: z.string().nullable().optional(),
  aliases: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
  source: z.string().min(1),
});

export const hotThemeCandidateStockSchema = z.object({
  stockCode: z.string().regex(/^\d{6}$/),
  stockName: z.string().min(1),
  concept: z.string().min(1),
  reason: z.string().min(1),
  heat: z.number().min(0).max(100),
  limitType: z.string().nullable().optional(),
  limitTag: z.string().nullable().optional(),
  limitStatus: z.string().nullable().optional(),
  limitReason: z.string().nullable().optional(),
  limitOrder: z.number().nullable().optional(),
  limitAmount: z.number().nullable().optional(),
  turnoverRate: z.number().nullable().optional(),
  boardRank: z.number().int().positive().nullable().optional(),
});

export const hotThemeMarketEvidenceSchema = z.object({
  boardCode: z.string().min(1),
  tradeDate: z.string().min(1),
  rankTime: z.string().nullable().optional(),
  rank: z.number().int().positive(),
  hot: z.number().nullable().optional(),
  pctChange: z.number().nullable().optional(),
  currentPrice: z.number().nullable().optional(),
  rankReason: z.string().nullable().optional(),
  constituentCount: z.number().int().nonnegative(),
  latestPctChange: z.number().nullable().optional(),
  fiveDayPctChange: z.number().nullable().optional(),
  latestTurnoverRate: z.number().nullable().optional(),
  limitUpCount: z.number().int().nonnegative(),
  continuationCount: z.number().int().nonnegative(),
  rushLimitCount: z.number().int().nonnegative(),
  brokenLimitCount: z.number().int().nonnegative(),
  limitDownCount: z.number().int().nonnegative(),
});

export const hotThemeNewsItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  source: z.string().min(1),
  publishedAt: z.string().min(1),
  sentiment: z.string().min(1),
  relevanceScore: z.number(),
  relatedStocks: z.array(z.string()).default([]),
  scopeTags: z.array(z.enum(["macro", "theme", "industry", "company"])).default([]),
  eventType: z.string().default("其他"),
  matchReason: z.string().default(""),
});

export const hotThemeContextSchema = z.object({
  theme: z.string().min(1),
  heatScore: z.number().min(0).max(100),
  whyHot: z.string().min(1),
  marketEvidence: hotThemeMarketEvidenceSchema,
  conceptMatches: z.array(hotThemeConceptMatchSchema).default([]),
  candidateStocks: z.array(hotThemeCandidateStockSchema).default([]),
  topNews: z.array(hotThemeNewsItemSchema).default([]),
});

export const marketContextSnapshotSchema = z.object({
  asOf: z.string().min(1),
  status: marketContextStatusSchema,
  regime: marketRegimeSummarySchema,
  flow: marketFlowSummarySchema,
  macroNews: z.array(hotThemeNewsItemSchema).default([]),
  hotThemes: z.array(hotThemeContextSchema).default([]),
  downstreamHints: z.object({
    workflows: marketContextSectionHintSchema,
    companyResearch: marketContextSectionHintSchema,
    screening: marketContextSectionHintSchema,
    timing: marketContextSectionHintSchema,
  }),
  availability: z.object({
    regime: marketContextAvailabilityEntrySchema,
    flow: marketContextAvailabilityEntrySchema,
    hotThemes: marketContextAvailabilityEntrySchema,
  }),
});

export type MarketContextSnapshot = z.infer<typeof marketContextSnapshotSchema>;

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
});

export const hotThemeContextSchema = z.object({
  theme: z.string().min(1),
  heatScore: z.number().min(0).max(100),
  whyHot: z.string().min(1),
  conceptMatches: z.array(hotThemeConceptMatchSchema).default([]),
  candidateStocks: z.array(hotThemeCandidateStockSchema).default([]),
  topNews: z.array(hotThemeNewsItemSchema).default([]),
});

export const marketContextSnapshotSchema = z.object({
  asOf: z.string().min(1),
  status: marketContextStatusSchema,
  regime: marketRegimeSummarySchema,
  flow: marketFlowSummarySchema,
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

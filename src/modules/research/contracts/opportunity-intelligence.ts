import { z } from "zod";
import {
  hotThemeCandidateStockSchema,
  hotThemeNewsItemSchema,
  marketContextStatusSchema,
} from "~/modules/market/contracts/market-context";

export const opportunityLeadStageSchema = z.enum([
  "warming",
  "catalyst",
  "expanding",
  "near_realization",
  "validating",
  "cooling",
]);

export const opportunityLeadSchema = z.object({
  slug: z.string().min(1),
  theme: z.string().min(1),
  title: z.string().min(1),
  stage: opportunityLeadStageSchema,
  heatScore: z.number().min(0).max(100),
  whyNow: z.string().min(1),
  catalystSummary: z.string().min(1),
  realizationPath: z.string().min(1),
  prioritySegments: z.array(z.string().min(1)).min(1).max(3),
  candidateStocks: z.array(hotThemeCandidateStockSchema).default([]),
  topNews: z.array(hotThemeNewsItemSchema).default([]),
  whyRanked: z.string().min(1),
  whyRecommendedForYou: z.string().nullable().optional(),
  recommendedQuestion: z.string().min(1),
});

export const avoidanceLeadSchema = z.object({
  slug: z.string().min(1),
  theme: z.string().min(1),
  title: z.string().min(1),
  reason: z.string().min(1),
  warningTone: z.enum(["info", "warning"]).default("warning"),
});

export const opportunityMarketSummarySchema = z.object({
  todayConclusion: z.string().min(1),
  regimeSummary: z.string().min(1),
  flowSummary: z.string().min(1),
});

export const opportunityPersonalizationSchema = z.object({
  recentResearchMatchCount: z.number().int().min(0),
  watchlistMatchCount: z.number().int().min(0),
  portfolioMatchCount: z.number().int().min(0),
});

export const opportunityIntelligenceFeedSchema = z.object({
  asOf: z.string().min(1),
  status: marketContextStatusSchema,
  marketSummary: opportunityMarketSummarySchema,
  personalization: opportunityPersonalizationSchema,
  todayTopLeads: z.array(opportunityLeadSchema).max(4),
  trackingLeads: z.array(opportunityLeadSchema).max(12),
  avoidanceItems: z.array(avoidanceLeadSchema).max(3),
});

export const opportunitySummaryLeadSchema = z.object({
  slug: z.string().min(1),
  title: z.string().min(1),
  theme: z.string().min(1),
  stage: opportunityLeadStageSchema,
  whyNow: z.string().min(1),
  whyRecommendedForYou: z.string().nullable().optional(),
  href: z.string().min(1),
});

export const opportunityIntelligenceSummarySchema = z.object({
  asOf: z.string().min(1),
  status: marketContextStatusSchema,
  leads: z.array(opportunitySummaryLeadSchema).min(1).max(3),
  personalizationHitCount: z.number().int().min(0),
});

export type OpportunityLead = z.infer<typeof opportunityLeadSchema>;
export type AvoidanceLead = z.infer<typeof avoidanceLeadSchema>;
export type OpportunityIntelligenceFeed = z.infer<
  typeof opportunityIntelligenceFeedSchema
>;
export type OpportunityIntelligenceSummary = z.infer<
  typeof opportunityIntelligenceSummarySchema
>;

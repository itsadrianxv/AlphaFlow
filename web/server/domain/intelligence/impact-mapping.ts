import { z } from "zod";
import type { EvidenceCitation } from "~/server/domain/evidence-context/types";
import type { ThemeNewsItem } from "~/server/domain/intelligence/types";

export const impactMappingModeSchema = z.enum([
  "radar",
  "overview",
  "deep_dive",
  "trace",
]);

export const impactMappingInputSchema = z
  .object({
    mode: impactMappingModeSchema.default("radar"),
    portfolioCompositionId: z.string().cuid().optional(),
    watchListIds: z.array(z.string().min(1)).max(5).default([]),
    eventId: z.string().min(1).optional(),
    baseRunId: z.string().cuid().optional(),
    baseSnapshotId: z.string().cuid().optional(),
    days: z.number().int().min(1).max(30).default(7),
    traceCursor: z.string().datetime().optional(),
    traceMaxDays: z.number().int().min(30).max(365).default(365),
    traceMaxEvents: z.number().int().min(1).max(30).default(30),
  })
  .superRefine((value, context) => {
    if (
      value.mode !== "radar" &&
      value.mode !== "overview" &&
      (!value.eventId ||
        (!value.baseRunId && !value.baseSnapshotId) ||
        Boolean(value.baseRunId && value.baseSnapshotId))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "deep_dive 和 trace 必须提供 eventId，并且只能选择 baseRunId 或 baseSnapshotId 之一",
      });
    }
  });

export type ImpactMappingInput = z.infer<typeof impactMappingInputSchema>;
export type ImpactMappingMode = ImpactMappingInput["mode"];

export type ImpactContext = {
  portfolio?: {
    id: string;
    name: string;
    positions: Array<{
      stockCode: string;
      stockName: string;
      currentWeightPct: number;
    }>;
  };
  watchLists: Array<{
    id: string;
    name: string;
    stocks: Array<{ stockCode: string; stockName: string }>;
  }>;
  companies: Array<{
    id?: string;
    stockCode: string;
    companyName: string;
    aliases: string[];
    priority?: number;
  }>;
  industries: Array<{
    id?: string;
    name: string;
    aliases: string[];
    priority?: number;
  }>;
  hypotheses: Array<{
    id: string;
    targetType: string;
    targetId: string;
    title?: string;
    content: string;
  }>;
};

export const impactEdgeSchema = z.object({
  id: z.string(),
  level: z.enum(["primary", "secondary", "tertiary", "macro", "portfolio"]),
  source: z.string(),
  target: z.string(),
  targetType: z.string(),
  stockCode: z.string().optional(),
  relation: z.string(),
  direction: z.enum(["positive", "negative", "mixed", "uncertain"]),
  strength: z.enum(["high", "medium", "low"]),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  evidenceItemIds: z.array(z.string()),
  basis: z.enum(["fact", "inference", "assumption"]),
  hypothesisStatus: z
    .enum(["supported", "challenged", "invalidated", "uncertain"])
    .optional(),
});

export const impactTimelineItemSchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  title: z.string(),
  summary: z.string(),
  eventId: z.string().optional(),
  url: z.string().url().optional(),
  source: z.string().optional(),
  evidenceItemIds: z.array(z.string()),
  kind: z.literal("observed"),
});

export const impactScenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  horizon: z.string(),
  triggers: z.array(z.string()).min(1),
  confirmationSignals: z.array(z.string()).min(1),
  invalidationConditions: z.array(z.string()).min(1),
  affectedTargets: z.array(z.string()).min(1),
  rationale: z.string(),
  evidenceItemIds: z.array(z.string()).default([]),
  basis: z.enum(["inference", "assumption"]),
});

export type ImpactEdge = z.infer<typeof impactEdgeSchema>;
export type ImpactTimelineItem = z.infer<typeof impactTimelineItemSchema>;
export type ImpactScenario = z.infer<typeof impactScenarioSchema>;

export type ImpactRadarEvent = {
  event: ThemeNewsItem;
  impactEdges: ImpactEdge[];
  portfolioHits: string[];
  importanceScore: number;
  analysis?: {
    timeline: ImpactTimelineItem[];
    scenarios: ImpactScenario[];
    historyReady?: boolean;
    historyVersion?: string;
    traceState?: ImpactMappingResult["traceState"];
    warnings: string[];
  };
};

export type ImpactMappingResult = {
  mode: ImpactMappingMode;
  analysisStatus: "complete" | "partial";
  asOf: string;
  context: ImpactContext;
  events: ImpactRadarEvent[];
  selectedEvent?: ThemeNewsItem;
  impactEdges: ImpactEdge[];
  timeline: ImpactTimelineItem[];
  scenarios: ImpactScenario[];
  evidenceCitations: EvidenceCitation[];
  warnings: string[];
  traceState?: {
    oldestOccurredAt?: string;
    tracedDays: number;
    eventCount: number;
    canContinue: boolean;
  };
  featuredEventIds?: string[];
};

import { z } from "zod";

export const evidenceStatusSchema = z.enum([
  "available",
  "missing",
  "not_supported",
  "fallback",
  "stale",
  "estimated",
  "partial",
  "fetch_failed",
]);

export const evidenceCitationSchema = z.object({
  evidenceItemId: z.string().min(1),
  relation: z.enum(["support", "risk", "context", "contradiction"]).optional(),
  label: z.string().trim().max(120).optional(),
});

export const evidenceContextItemSchema = z.object({
  id: z.string().min(1),
  blockKey: z.string(),
  itemKey: z.string(),
  status: evidenceStatusSchema,
  effectiveStatus: evidenceStatusSchema.optional(),
  extractedFact: z.string().optional(),
  snippet: z.string().optional(),
  valueJson: z.unknown().optional(),
  rawValueJson: z.unknown().optional(),
  sourceType: z.string(),
  sourceId: z.string().optional(),
  sourceName: z.string().optional(),
  url: z.string().url().optional(),
  publishedAt: z.string().datetime().optional(),
  observedAt: z.string().datetime().optional(),
  fetchedAt: z.string().datetime().optional(),
  fallbackFrom: z.string().optional(),
  missingReason: z.string().optional(),
  warnings: z.array(z.string()),
  limitations: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  recordKind: z.enum([
    "observation",
    "manual_input",
    "derived",
    "model_derived",
    "correction",
  ]),
  lineageId: z.string().min(1),
  derivedFromItemIds: z.array(z.string()),
  algorithmVersion: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  correctionOfItemId: z.string().optional(),
  supersedesItemId: z.string().optional(),
  contentHash: z.string().min(1),
});

export const evidenceContextDetailSchema = z.object({
  id: z.string().min(1),
  contextId: z.string().min(1),
  subjectType: z.string(),
  subjectId: z.string(),
  subjectLabel: z.string().optional(),
  phase: z.string().optional(),
  blockKey: z.string(),
  item: evidenceContextItemSchema,
  createdAt: z.string().datetime(),
});

export type EvidenceCitationInput = z.infer<typeof evidenceCitationSchema>;

import { z } from "zod";

const scoreSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.null(),
]);

const preferenceMatchSchema = z
  .object({
    targetType: z.string().min(1),
    targetKey: z.string().min(1),
    level: z.string().min(1),
    relation: z.enum(["DIRECT", "WEAK"]),
    path: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const researchRadarItemSchema = z
  .object({
    eventRevisionId: z.string().min(1),
    eventId: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    subjectType: z.string().min(1),
    subjectKey: z.string().min(1),
    revisionKind: z.string().min(1),
    occurredAt: z.string().datetime(),
    relevance: scoreSchema,
    relevanceReason: z.string().min(1),
    matchedPreferences: z.array(preferenceMatchSchema),
    directFocusMatch: z.boolean(),
    globalScores: z
      .object({
        importance: scoreSchema,
        confidence: scoreSchema,
        informationNovelty: scoreSchema,
      })
      .strict(),
    evidenceCount: z.number().int().nonnegative(),
    baselineRank: z.number().int().positive(),
  })
  .strict();

export const researchRadarResultSchema = z
  .object({
    userId: z.string().min(1),
    preferenceSnapshotId: z.string().min(1).nullable(),
    preferenceContentHash: z.string().min(1).nullable(),
    capacity: z.number().int().positive(),
    candidateCount: z.number().int().nonnegative(),
    items: z.array(researchRadarItemSchema),
    generatedAt: z.string().datetime(),
  })
  .strict();

export type ResearchRadarItem = z.infer<typeof researchRadarItemSchema>;
export type ResearchRadarResult = z.infer<typeof researchRadarResultSchema>;

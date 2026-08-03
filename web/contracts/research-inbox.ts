import { z } from "zod";

export const researchInboxStateSchema = z.enum([
  "UNREAD",
  "READ",
  "LATER",
  "ARCHIVED",
]);
export const researchInboxFilterSchema = z.enum([
  "PENDING",
  "UNREAD",
  "LATER",
  "ARCHIVED",
]);
export const researchInboxFeedbackSchema = z.enum(["USEFUL", "NOISE"]);
export const researchInboxChannelSchema = z.enum([
  "IN_APP",
  "BRIEFING",
  "URGENT_ALERT",
]);
export const researchInboxEntryKindSchema = z.enum([
  "EVENT",
  "CANDIDATE_PENDING_VERIFICATION",
  "CORRECTION",
  "RETRACTION",
  "BRIEFING",
]);

const assessmentSchema = z
  .object({ level: z.string().min(1), reason: z.string().min(1) })
  .strict();

const evidenceHrefSchema = z.string().refine((value) => {
  if (value.startsWith("#")) return value.length > 1;
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}, "证据链接必须是 HTTP(S) 地址或页内锚点");

export const researchInboxBodySchema = z
  .object({
    subject: z
      .object({
        type: z.string().min(1),
        key: z.string().min(1),
        label: z.string().min(1),
      })
      .strict(),
    eventStatus: z.string().min(1),
    occurredAt: z.string().datetime(),
    facts: z.array(z.string().min(1)).min(1).max(20),
    impact: z.string().min(1),
    reasons: z.array(z.string().min(1)).min(1).max(20),
    nextChecks: z.array(z.string().min(1)).max(20),
    risks: z.array(z.string().min(1)).max(20),
    assessments: z
      .object({
        importance: assessmentSchema,
        confidence: assessmentSchema,
        relevance: assessmentSchema,
        informationNovelty: assessmentSchema,
      })
      .strict(),
    evidence: z
      .array(
        z
          .object({
            id: z.string().min(1),
            source: z.string().min(1),
            excerpt: z.string().min(1),
            qualification: z.string().min(1),
            href: evidenceHrefSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    revisions: z
      .array(
        z
          .object({
            id: z.string().min(1),
            kind: z.string().min(1),
            label: z.string().min(1),
            summary: z.string().min(1),
            createdAt: z.string().datetime(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    aiDisclosure: z.string().min(1),
    externalCopyStatus: z.string().min(1),
  })
  .strict();

const referencesSchema = z
  .object({
    eventRevisionId: z.string().nullable(),
    candidateId: z.string().nullable(),
    briefingTaskId: z.string().nullable(),
    globalAssessmentId: z.string().nullable(),
    relevanceAssessmentId: z.string().nullable(),
    preferenceSnapshotId: z.string().nullable(),
  })
  .strict();

const historySchema = z
  .object({
    id: z.string(),
    sequence: z.number().int().positive(),
    fromState: researchInboxStateSchema.nullable(),
    toState: researchInboxStateSchema,
    action: z.string().min(1),
    commandId: z.string().min(1),
    occurredAt: z.string().datetime(),
  })
  .strict();

export const researchInboxEntrySchema = z
  .object({
    id: z.string(),
    distributionKey: z.string(),
    userId: z.string(),
    highestChannel: researchInboxChannelSchema,
    entryKind: researchInboxEntryKindSchema,
    title: z.string(),
    summary: z.string(),
    body: researchInboxBodySchema,
    references: referencesSchema,
    state: researchInboxStateSchema,
    feedback: researchInboxFeedbackSchema.nullable(),
    openedAt: z.string().datetime().nullable(),
    archivedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    history: z.array(historySchema),
  })
  .strict();

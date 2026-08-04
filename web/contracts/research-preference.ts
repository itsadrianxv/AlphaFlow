import { z } from "zod";

export const researchPreferenceTargetTypeSchema = z.enum([
  "COMPANY",
  "INDUSTRY",
  "THEME",
  "RESEARCH_EVENT",
  "RESEARCH_HYPOTHESIS",
]);

export const researchPreferenceLevelSchema = z.enum(["REGULAR", "FOCUS"]);

export const researchPreferenceTargetSchema = z.object({
  targetType: researchPreferenceTargetTypeSchema,
  targetKey: z.string().trim().min(1).max(255),
});

export const researchPreferenceItemSchema =
  researchPreferenceTargetSchema.extend({
    level: researchPreferenceLevelSchema,
  });

export const researchPreferenceChannelsSchema = z.object({
  urgentAlertsEnabled: z.boolean(),
  briefingsEnabled: z.boolean(),
  externalCopiesEnabled: z.boolean(),
});

export const researchPreferenceStateSchema = z.object({
  userId: z.string().min(1),
  enabled: z.boolean(),
  urgentAlertsEnabled: z.boolean(),
  briefingsEnabled: z.boolean(),
  externalCopiesEnabled: z.boolean(),
  items: z.array(researchPreferenceItemSchema),
  lastCommandId: z.string().nullable(),
});

export const researchPreferenceSnapshotSchema = z.object({
  id: z.string().min(1),
  userId: z.string().min(1),
  contractVersion: z.string().min(1),
  enabled: z.boolean(),
  urgentAlertsEnabled: z.boolean(),
  briefingsEnabled: z.boolean(),
  externalCopiesEnabled: z.boolean(),
  items: z.array(researchPreferenceItemSchema),
  contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  frozenAt: z.coerce.date(),
  personalDataDeletedAt: z.coerce.date().nullable(),
});

export const researchPreferenceMatchInputSchema =
  researchPreferenceTargetSchema.extend({
    relation: z.enum(["DIRECT", "WEAK"]),
    path: z.array(z.string().min(1)).max(20).optional(),
  });

export const researchPreferenceMatchSchema =
  researchPreferenceItemSchema.extend({
    relation: z.enum(["DIRECT", "WEAK"]),
    path: z.array(z.string().min(1)).max(20).optional(),
  });

export const researchPreferenceExplanationSchema = z.object({
  snapshotId: z.string().min(1),
  matches: z.array(researchPreferenceMatchSchema),
  hasDirectFocusMatch: z.boolean(),
});

export const researchPreferenceImportSourceSchema = z.enum([
  "SAVED_COMPANY",
  "SAVED_INDUSTRY",
  "WATCHLIST",
]);

export const researchPreferenceImportCandidateSourceSchema = z.object({
  source: researchPreferenceImportSourceSchema,
  name: z.string().trim().min(1).optional(),
});

export const researchPreferenceImportCandidateSchema =
  researchPreferenceTargetSchema.extend({
    // 兼容旧调用方的主来源；完整来源以 sources 为准。
    source: researchPreferenceImportSourceSchema,
    sources: z.array(researchPreferenceImportCandidateSourceSchema).min(1),
    label: z.string().trim().min(1),
  });

export type ResearchPreferenceTargetType = z.infer<
  typeof researchPreferenceTargetTypeSchema
>;
export type ResearchPreferenceLevel = z.infer<
  typeof researchPreferenceLevelSchema
>;
export type ResearchPreferenceTarget = z.infer<
  typeof researchPreferenceTargetSchema
>;
export type ResearchPreferenceItem = z.infer<
  typeof researchPreferenceItemSchema
>;
export type ResearchPreferenceChannels = z.infer<
  typeof researchPreferenceChannelsSchema
>;
export type ResearchPreferenceState = z.infer<
  typeof researchPreferenceStateSchema
>;
export type ResearchPreferenceSnapshot = z.infer<
  typeof researchPreferenceSnapshotSchema
>;
export type ResearchPreferenceMatchInput = z.infer<
  typeof researchPreferenceMatchInputSchema
>;
export type ResearchPreferenceMatch = z.infer<
  typeof researchPreferenceMatchSchema
>;
export type ResearchPreferenceExplanation = z.infer<
  typeof researchPreferenceExplanationSchema
>;
export type ResearchPreferenceImportSource = z.infer<
  typeof researchPreferenceImportSourceSchema
>;
export type ResearchPreferenceImportCandidateSource = z.infer<
  typeof researchPreferenceImportCandidateSourceSchema
>;
export type ResearchPreferenceImportCandidate = z.infer<
  typeof researchPreferenceImportCandidateSchema
>;

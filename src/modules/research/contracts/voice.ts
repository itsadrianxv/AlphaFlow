import { z } from "zod";

export const researchVoiceAcceptedMimeTypes = [
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/wav",
  "audio/x-wav",
  "audio/mpeg",
  "audio/mp4",
] as const;

export const researchVoicePageKindSchema = z.enum([
  "quick_research",
  "company_research",
]);

const stringListSchema = z.array(z.string().trim().min(1)).max(8);

export const researchVoiceContextFieldsSchema = z.object({
  query: z.string().trim().min(1).optional(),
  keyQuestion: z.string().trim().min(1).optional(),
  companyName: z.string().trim().min(1).optional(),
  stockCode: z.string().trim().min(1).optional(),
  focusConcepts: stringListSchema.optional(),
  researchGoal: z.string().trim().min(1).optional(),
  mustAnswerQuestions: stringListSchema.optional(),
  preferredSources: stringListSchema.optional(),
  freshnessWindowDays: z.number().int().min(1).max(3650).optional(),
});

export const researchVoiceContextSchema = z.object({
  pageKind: researchVoicePageKindSchema,
  currentFields: researchVoiceContextFieldsSchema,
  starterExamples: z.array(z.string().trim().min(1)).max(8),
});

export const voiceTranscriptionSegmentSchema = z.object({
  startMs: z.number().int().min(0),
  endMs: z.number().int().min(0),
  text: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
});

export const voiceTranscriptionResponseSchema = z.object({
  transcript: z.string(),
  durationMs: z.number().int().min(0),
  overallConfidence: z.number().min(0).max(1),
  segments: z.array(voiceTranscriptionSegmentSchema),
});

export const researchVoiceFieldPatchSchema = z.object({
  query: z.string().trim().min(1).optional(),
  keyQuestion: z.string().trim().min(1).optional(),
  companyName: z.string().trim().min(1).optional(),
  stockCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  focusConcepts: stringListSchema.optional(),
  researchGoal: z.string().trim().min(1).optional(),
  mustAnswerQuestions: stringListSchema.optional(),
  preferredSources: stringListSchema.optional(),
  freshnessWindowDays: z.number().int().min(1).max(3650).optional(),
});

export const researchVoiceConfidenceLevelSchema = z.enum([
  "high",
  "medium",
  "low",
]);

export const researchVoiceIntakeResponseSchema = z.object({
  normalizedPrimaryText: z.string().trim().min(1),
  appliedPatch: researchVoiceFieldPatchSchema,
  appliedFieldKeys: z.array(researchVoiceFieldPatchSchema.keyof()),
  confidenceLevel: researchVoiceConfidenceLevelSchema,
  degradedToPrimaryOnly: z.boolean(),
  source: z.object({
    durationMs: z.number().int().min(0),
    overallConfidence: z.number().min(0).max(1),
  }),
});

export type ResearchVoicePageKind = z.infer<typeof researchVoicePageKindSchema>;
export type ResearchVoiceContext = z.infer<typeof researchVoiceContextSchema>;
export type VoiceTranscriptionResponse = z.infer<
  typeof voiceTranscriptionResponseSchema
>;
export type ResearchVoiceFieldPatch = z.infer<
  typeof researchVoiceFieldPatchSchema
>;
export type ResearchVoiceConfidenceLevel = z.infer<
  typeof researchVoiceConfidenceLevelSchema
>;
export type ResearchVoiceIntakeResponse = z.infer<
  typeof researchVoiceIntakeResponseSchema
>;

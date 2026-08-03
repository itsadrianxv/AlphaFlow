import { z } from "zod";
import { researchPreferenceItemSchema } from "./research-preference";

export const researchAssessmentScoreSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.null(),
]);

export const researchAssessmentCitationSchema = z
  .object({
    refId: z.string().trim().min(1),
    refType: z.enum([
      "EVENT_REVISION",
      "FACT_CLAIM",
      "EVIDENCE",
      "COGNITIVE_BASELINE",
      "RESEARCH_PREFERENCE",
      "IMPACT_OBJECT",
    ]),
  })
  .strict();

export const researchAssessmentReasonSchema = z
  .object({
    text: z.string().trim().min(1).max(500),
    citations: z.array(researchAssessmentCitationSchema).min(1).max(8),
  })
  .strict();

export const researchAssessmentDimensionSchema = z
  .object({
    score: researchAssessmentScoreSchema,
    reasons: z.array(researchAssessmentReasonSchema).min(1).max(3),
    uncertainty: z.string().trim().min(1).max(500),
  })
  .strict();

export const researchGlobalAssessmentOutputSchema = z
  .object({
    importance: researchAssessmentDimensionSchema,
    confidence: researchAssessmentDimensionSchema,
    informationNovelty: researchAssessmentDimensionSchema,
  })
  .strict();

export const researchRelevanceAssessmentOutputSchema = z
  .object({
    relevance: researchAssessmentDimensionSchema,
    matchedPreferences: z.array(
      researchPreferenceItemSchema.extend({
        relation: z.enum(["DIRECT", "WEAK"]),
        path: z.array(z.string().min(1)).max(20).optional(),
      }),
    ),
  })
  .strict();

export type ResearchAssessmentScore = z.infer<
  typeof researchAssessmentScoreSchema
>;
export type ResearchAssessmentCitation = z.infer<
  typeof researchAssessmentCitationSchema
>;
export type ResearchAssessmentReason = z.infer<
  typeof researchAssessmentReasonSchema
>;
export type ResearchAssessmentDimension = z.infer<
  typeof researchAssessmentDimensionSchema
>;
export type ResearchGlobalAssessmentOutput = z.infer<
  typeof researchGlobalAssessmentOutputSchema
>;
export type ResearchRelevanceAssessmentOutput = z.infer<
  typeof researchRelevanceAssessmentOutputSchema
>;

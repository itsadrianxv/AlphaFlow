import { z } from "zod";

const stringList = (max: number) => z.array(z.string().trim().min(1)).max(max);

export const researchTaskContractSchema = z.object({
  requiredSources: stringList(8),
  requiredSections: stringList(12),
  citationRequired: z.boolean(),
  analysisDepth: z.enum(["standard", "deep"]),
  deadlineMinutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60),
});

export const researchClarificationRequestSchema = z.object({
  needClarification: z.boolean(),
  question: z.string(),
  verification: z.string(),
  missingScopeFields: stringList(8),
  suggestedInputPatch: z.record(z.string(), z.unknown()),
});

export const researchBriefSchema = z.object({
  query: z.string().trim().min(1),
  companyName: z.string().trim().min(1).optional(),
  stockCode: z.string().trim().min(1).optional(),
  officialWebsite: z.string().trim().min(1).optional(),
  researchGoal: z.string().trim().min(1),
  focusConcepts: stringList(8),
  keyQuestions: stringList(8),
  mustAnswerQuestions: stringList(8),
  forbiddenEvidenceTypes: stringList(8),
  preferredSources: stringList(8),
  freshnessWindowDays: z.number().int().min(1).max(3650),
  scopeAssumptions: stringList(8),
  clarificationSummary: z.string().trim().min(1).optional(),
});

export const researchUnitPlanSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  keyQuestions: stringList(4),
  priority: z.enum(["high", "medium", "low"]),
  capability: z.enum([
    "theme_overview",
    "market_heat",
    "candidate_screening",
    "credibility_lookup",
    "competition_synthesis",
    "official_search",
    "news_search",
    "industry_search",
    "page_scrape",
    "financial_pack",
  ]),
  dependsOn: stringList(8),
  role: z.string().trim().min(1),
  expectedArtifact: z.string().trim().min(1),
  fallbackCapabilities: z
    .array(
      z.enum([
        "theme_overview",
        "market_heat",
        "candidate_screening",
        "credibility_lookup",
        "competition_synthesis",
        "official_search",
        "news_search",
        "industry_search",
        "page_scrape",
        "financial_pack",
      ]),
    )
    .max(4),
  acceptanceCriteria: stringList(8),
});

export const researchUnitPlanListSchema = z.array(researchUnitPlanSchema);

export const compressedFindingsSchema = z.object({
  summary: z.string().trim().min(1),
  highlights: stringList(8),
  openQuestions: stringList(8),
  noteIds: stringList(16),
});

export const researchGapAnalysisSchema = z.object({
  requiresFollowup: z.boolean(),
  summary: z.string().trim().min(1),
  missingAreas: stringList(8),
  followupUnits: researchUnitPlanListSchema,
  iteration: z.number().int().min(0).max(12),
});

export const researchReflectionResultSchema = z.object({
  status: z.enum(["pass", "warn", "fail"]),
  summary: z.string().trim().min(1),
  contractScore: z.number().min(0).max(100),
  citationCoverage: z.number().min(0).max(1),
  firstPartyRatio: z.number().min(0).max(1),
  answeredQuestionCoverage: z.number().min(0).max(1),
  missingRequirements: stringList(16),
  unansweredQuestions: stringList(16),
  qualityFlags: stringList(16),
  suggestedFixes: stringList(16),
});

import { z } from "zod";
import { workspaceResultSchema } from "~/contracts/screening";

export const researchTargetTypeSchema = z.enum([
  "company",
  "industry",
  "watchlist",
  "space",
  "workflow_run",
]);

export const researchTargetRefSchema = z.object({
  type: researchTargetTypeSchema,
  id: z.string().min(1),
});

export const savedCompanySchema = z.object({
  id: z.string().min(1),
  stockCode: z.string().regex(/^\d{6}$/),
  companyName: z.string().min(1),
  reason: z.string().nullable(),
  tags: z.array(z.string()),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const savedIndustrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  source: z.string().min(1),
  reason: z.string().nullable(),
  tags: z.array(z.string()),
  relatedCompanies: z.array(
    z.object({
      stockCode: z.string().regex(/^\d{6}$/),
      companyName: z.string().min(1),
    }),
  ),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const researchTargetSummarySchema = z.object({
  ref: researchTargetRefSchema,
  label: z.string().min(1),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  updatedAt: z.string().nullable(),
});

export const researchTargetNoteSchema = z.object({
  id: z.string().min(1),
  targetRef: researchTargetRefSchema,
  title: z.string().nullable(),
  kind: z.string().nullable(),
  contentMarkdown: z.string(),
  rawContent: z.string().nullable(),
  source: z.unknown().nullable(),
  tags: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const financialSnapshotSchema = z.object({
  id: z.string().min(1),
  targetRef: researchTargetRefSchema,
  companyRefs: z.array(
    z.object({
      stockCode: z.string().regex(/^\d{6}$/),
      stockName: z.string().min(1),
    }),
  ),
  metricSet: z.unknown(),
  periodRange: z.unknown(),
  rawSnapshot: z.unknown(),
  source: z.unknown(),
  createdAt: z.string(),
});

export const researchArtifactSchema = z.object({
  id: z.string().min(1),
  targetRef: researchTargetRefSchema,
  financialSnapshotId: z.string().nullable(),
  artifactType: z.string().min(1),
  title: z.string().min(1),
  contentType: z.string().min(1),
  payload: z.unknown(),
  source: z.unknown().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createSavedCompanyInputSchema = z.object({
  stockCode: z.string().regex(/^\d{6}$/),
  companyName: z.string().trim().min(1),
  reason: z.string().trim().nullable().optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export const updateSavedCompanyInputSchema = createSavedCompanyInputSchema
  .partial()
  .extend({
    id: z.string().min(1),
  });

export const createSavedIndustryInputSchema = z.object({
  name: z.string().trim().min(1),
  source: z.string().trim().min(1).default("自定义主题"),
  reason: z.string().trim().nullable().optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  relatedCompanies: z
    .array(
      z.object({
        stockCode: z.string().regex(/^\d{6}$/),
        companyName: z.string().trim().min(1),
      }),
    )
    .default([]),
  metadata: z.record(z.unknown()).default({}),
});

export const updateSavedIndustryInputSchema = createSavedIndustryInputSchema
  .partial()
  .extend({
    id: z.string().min(1),
  });

export const listResearchTargetsInputSchema = z
  .object({
    types: z.array(researchTargetTypeSchema).max(5).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    query: z.string().trim().optional(),
  })
  .optional();

export const listTargetContentInputSchema = z.object({
  targetRef: researchTargetRefSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export const createResearchNoteInputSchema = z.object({
  targetRef: researchTargetRefSchema,
  title: z.string().trim().nullable().optional(),
  kind: z.string().trim().nullable().optional(),
  contentMarkdown: z.string().trim().min(1),
  rawContent: z.string().trim().nullable().optional(),
  source: z.unknown().nullable().optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
});

export const updateResearchNoteInputSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().nullable().optional(),
  kind: z.string().trim().nullable().optional(),
  contentMarkdown: z.string().trim().min(1).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
});

export const formatResearchNoteInputSchema = z.object({
  id: z.string().min(1),
  mode: z
    .enum(["bullets", "hypothesis", "risk", "question", "indicator"])
    .default("bullets"),
});

export const formatResearchArtifactInputSchema = z.object({
  id: z.string().min(1),
});

export const createFinancialSnapshotInputSchema = z.object({
  targetRef: researchTargetRefSchema,
  companyRefs: z
    .array(
      z.object({
        stockCode: z.string().regex(/^\d{6}$/),
        stockName: z.string().min(1),
      }),
    )
    .min(1)
    .max(50),
  metricSet: z.unknown(),
  periodRange: z.unknown(),
  rawSnapshot: workspaceResultSchema,
  source: z.unknown(),
});

export const generateComparisonArtifactInputSchema = z.object({
  financialSnapshotId: z.string().min(1),
  title: z.string().trim().min(1).optional(),
});

export const updateResearchArtifactInputSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).optional(),
  markdown: z.string().trim().min(1),
});

export type ResearchTargetType = z.infer<typeof researchTargetTypeSchema>;
export type ResearchTargetRef = z.infer<typeof researchTargetRefSchema>;
export type SavedCompanyDto = z.infer<typeof savedCompanySchema>;
export type SavedIndustryDto = z.infer<typeof savedIndustrySchema>;
export type ResearchTargetSummary = z.infer<typeof researchTargetSummarySchema>;
export type ResearchTargetNote = z.infer<typeof researchTargetNoteSchema>;
export type FinancialSnapshotDto = z.infer<typeof financialSnapshotSchema>;
export type ResearchArtifactDto = z.infer<typeof researchArtifactSchema>;

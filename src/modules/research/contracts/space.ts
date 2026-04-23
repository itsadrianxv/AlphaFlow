import { z } from "zod";

export const researchSpaceBriefSchema = z.object({
  researchGoal: z.string().default(""),
  coreThesis: z.string().default(""),
  keyQuestions: z.array(z.string().trim().min(1)).default([]),
  focusDimensions: z.array(z.string().trim().min(1)).default([]),
  notes: z.string().default(""),
});

export const researchSpaceRunSummarySchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  status: z.string().min(1),
  progressPercent: z.number().int().min(0).max(100),
  currentNodeKey: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  templateCode: z.string().min(1),
  templateVersion: z.number().int().positive(),
});

export const researchSpaceRunLinkSchema = z.object({
  id: z.string().min(1),
  note: z.string().nullable(),
  createdAt: z.string(),
  run: researchSpaceRunSummarySchema,
});

export const researchSpaceLinkedWatchlistSchema = z.object({
  id: z.string().min(1),
  watchListId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  createdAt: z.string(),
});

export const researchSpaceLinkedStockSchema = z.object({
  id: z.string().min(1),
  stockCode: z.string().regex(/^\d{6}$/),
  stockName: z.string().min(1),
  createdAt: z.string(),
});

export const researchSpaceSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  brief: researchSpaceBriefSchema,
  runCount: z.number().int().nonnegative(),
  watchListCount: z.number().int().nonnegative(),
  stockCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const researchSpaceDetailSchema = researchSpaceSummarySchema.extend({
  watchLists: z.array(researchSpaceLinkedWatchlistSchema),
  stocks: z.array(researchSpaceLinkedStockSchema),
  runLinks: z.array(researchSpaceRunLinkSchema),
  recentSuccessfulRunLinks: z.array(researchSpaceRunLinkSchema),
});

export const createResearchSpaceInputSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().nullable().optional(),
  brief: researchSpaceBriefSchema,
});

export const listResearchSpacesInputSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export const getResearchSpaceInputSchema = z.object({
  spaceId: z.string().min(1),
});

export const updateResearchSpaceMetaInputSchema = z
  .object({
    spaceId: z.string().min(1),
    name: z.string().trim().min(1).optional(),
    description: z.string().trim().nullable().optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
    "至少提供一个待更新字段",
  );

export const updateResearchSpaceBriefInputSchema = z.object({
  spaceId: z.string().min(1),
  brief: researchSpaceBriefSchema,
});

export const linkResearchSpaceWatchlistInputSchema = z.object({
  spaceId: z.string().min(1),
  watchListId: z.string().min(1),
});

export const linkResearchSpaceStocksInputSchema = z.object({
  spaceId: z.string().min(1),
  stocks: z
    .array(
      z.object({
        stockCode: z.string().regex(/^\d{6}$/),
        stockName: z.string().trim().min(1),
      }),
    )
    .min(1)
    .max(50),
});

export const unlinkResearchSpaceStockInputSchema = z.object({
  spaceId: z.string().min(1),
  stockCode: z.string().regex(/^\d{6}$/),
});

export const addResearchSpaceRunInputSchema = z.object({
  spaceId: z.string().min(1),
  runId: z.string().min(1),
  note: z.string().trim().nullable().optional(),
});

export const removeResearchSpaceRunInputSchema = z.object({
  spaceId: z.string().min(1),
  runId: z.string().min(1),
});

export const listResearchSpaceRunLinksInputSchema = z.object({
  spaceId: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
  search: z.string().trim().min(1).optional(),
  status: z.string().trim().min(1).optional(),
  templateCode: z.string().trim().min(1).optional(),
});

export const researchSpaceRunLinkListSchema = z.object({
  items: z.array(researchSpaceRunLinkSchema),
  totalCount: z.number().int().nonnegative(),
});

export type ResearchSpaceBrief = z.infer<typeof researchSpaceBriefSchema>;
export type ResearchSpaceRunSummary = z.infer<
  typeof researchSpaceRunSummarySchema
>;
export type ResearchSpaceRunLink = z.infer<typeof researchSpaceRunLinkSchema>;
export type ResearchSpaceLinkedWatchlist = z.infer<
  typeof researchSpaceLinkedWatchlistSchema
>;
export type ResearchSpaceLinkedStock = z.infer<
  typeof researchSpaceLinkedStockSchema
>;
export type ResearchSpaceSummary = z.infer<typeof researchSpaceSummarySchema>;
export type ResearchSpaceDetail = z.infer<typeof researchSpaceDetailSchema>;

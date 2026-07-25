import { z } from "zod";

export const collectionTypeSchema = z.enum([
  "COMPANY",
  "INDUSTRY",
  "WATCHLIST",
]);

export const collectionPayloadSchema = z.record(z.unknown());

export const collectionSchema = z.object({
  id: z.string().min(1),
  collectionType: collectionTypeSchema,
  title: z.string().min(1),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  payload: collectionPayloadSchema,
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const collectionSummarySchema = collectionSchema.extend({
  mindMapCount: z.number().int().nonnegative(),
});

export const createCollectionInputSchema = z.object({
  collectionType: collectionTypeSchema,
  title: z.string().trim().min(1),
  description: z.string().trim().nullable().optional(),
  tags: z.array(z.string().trim().min(1)).default([]),
  payload: collectionPayloadSchema.default({}),
});

export const updateCollectionInputSchema = createCollectionInputSchema
  .partial()
  .extend({
    id: z.string().min(1),
    archivedAt: z.string().datetime().nullable().optional(),
  });

export type CollectionType = z.infer<typeof collectionTypeSchema>;
export type CollectionDto = z.infer<typeof collectionSchema>;
export type CollectionSummary = z.infer<typeof collectionSummarySchema>;

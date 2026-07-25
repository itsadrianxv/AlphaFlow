import { z } from "zod";

export const jsonObjectSchema = z.record(z.unknown());

export const mindMapSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  data: jsonObjectSchema,
  config: jsonObjectSchema.nullable(),
  collectionIds: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const mindMapSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable(),
  collectionCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createMindMapInputSchema = z.object({
  title: z.string().trim().min(1).default("未命名思维导图"),
  description: z.string().trim().nullable().optional(),
  data: jsonObjectSchema,
  config: jsonObjectSchema.optional(),
  collectionIds: z.array(z.string()).max(50).default([]),
});

export const updateMindMapInputSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).optional(),
  description: z.string().trim().nullable().optional(),
  data: jsonObjectSchema.optional(),
  config: jsonObjectSchema.nullable().optional(),
  collectionIds: z.array(z.string()).max(50).optional(),
});

export type MindMapDto = z.infer<typeof mindMapSchema>;
export type MindMapSummary = z.infer<typeof mindMapSummarySchema>;

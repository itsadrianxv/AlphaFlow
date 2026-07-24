import { z } from "zod";

export const marketHeatmapStockSchema = z.object({
  stockCode: z.string().regex(/^\d{6}$/),
  stockName: z.string().min(1),
  marketCap: z.number().nonnegative(),
  changePercent: z.number().nullable(),
});

export const marketHeatmapConceptSchema = z.object({
  conceptCode: z.string().min(1),
  conceptName: z.string().min(1),
  hotRank: z.number().int().positive(),
  hotScore: z.number().nullable(),
  marketCap: z.number().nonnegative(),
  changePercent: z.number().nullable(),
  stocks: z.array(marketHeatmapStockSchema),
});

export const marketHeatmapSnapshotSchema = z.object({
  tradeDate: z.string().min(1),
  marketCapAsOf: z.string().min(1),
  priceSource: z.enum(["daily", "rt_min"]),
  concepts: z.array(marketHeatmapConceptSchema),
});

export type MarketHeatmapSnapshot = z.infer<typeof marketHeatmapSnapshotSchema>;

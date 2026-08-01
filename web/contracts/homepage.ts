import { z } from "zod";
import { marketHeatmapSnapshotSchema } from "~/contracts/market-heatmap";

export const homePagePayloadSchema = z.object({
  heatmap: marketHeatmapSnapshotSchema,
  overviewInsights: z.unknown(),
  moneyFlow: z.unknown(),
  impactMapping: z.unknown().nullable(),
});

export const homePageSnapshotEnvelopeSchema = z.object({
  snapshotId: z.string(),
  source: z.enum(["DEFAULT", "PERSONALIZED"]),
  generatedAt: z.string().datetime(),
  dataAsOf: z.string(),
  isStale: z.boolean(),
  isRefreshing: z.boolean(),
  personalizationPending: z.boolean(),
  payload: homePagePayloadSchema,
});

export type HomePagePayload = z.infer<typeof homePagePayloadSchema>;
export type HomePageSnapshotEnvelope = z.infer<
  typeof homePageSnapshotEnvelopeSchema
>;

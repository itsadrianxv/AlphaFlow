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
  source: z.enum(["BASELINE", "PERSONALIZED"]),
  manifestId: z.string(),
  generatedAt: z.string().datetime(),
  dataCoverage: z.unknown(),
  baselineOutdated: z.boolean(),
  refreshInProgress: z.boolean(),
  personalizationPending: z.boolean(),
  payload: homePagePayloadSchema,
});

export type HomePagePayload = z.infer<typeof homePagePayloadSchema>;
export type HomePageSnapshotEnvelope = z.infer<
  typeof homePageSnapshotEnvelopeSchema
>;

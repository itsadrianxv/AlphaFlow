import { z } from "zod";

export const homepageMarketPhaseIds = [
  "PRE_MARKET",
  "INTRADAY",
  "POST_MARKET",
  "FORWARD",
] as const;

export const homepageMarketDomainIds = [
  "market",
  "flow",
  "company",
  "news",
  "expectation",
  "calendar",
] as const;

export const homepageMarketPhaseSchema = z.enum(homepageMarketPhaseIds);
export const homepageMarketDomainSchema = z.enum(homepageMarketDomainIds);

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(jsonValueSchema),
  ]),
);

const dataCutoffSchema = z
  .object({
    key: z.string(),
    value: z.string(),
  })
  .catchall(jsonValueSchema);

const sourceSchema = z.object({
  assertionId: z.string(),
  role: z.string(),
  sourceKey: z.string(),
  datasetKey: z.string(),
  sourceRecordKey: z.string(),
  providerVersion: z.string(),
  url: z.string().url().nullable(),
  sourcePublishedAt: z.string().datetime().nullable(),
  upstreamAsOf: z.string().datetime().nullable(),
  fetchedAt: z.string().datetime(),
  selectionReason: z.string(),
  fallbackReason: z.string().nullable(),
});

const observationSchema = z.object({
  observationId: z.string(),
  revisionId: z.string(),
  revisionNo: z.number().int().positive(),
  subjectType: z.string(),
  subjectKey: z.string(),
  metricCatalogId: z.string(),
  title: z.string(),
  summary: z.string(),
  value: jsonValueSchema,
  displayValue: z.string(),
  unit: z.string().nullable(),
  qualityStatus: z.string(),
  qualityFlags: z.array(z.string()),
  upstreamAsOf: z.string().datetime().nullable(),
  sourcePublishedAt: z.string().datetime().nullable(),
  normalizedAt: z.string().datetime(),
  sources: z.array(sourceSchema),
});

const domainSchema = z.object({
  id: homepageMarketDomainSchema,
  label: z.string(),
  datasetKey: z.string(),
  required: z.boolean(),
  coverage: z.object({
    targetDataCutoff: dataCutoffSchema,
    actualDataCutoff: dataCutoffSchema,
    settlementStatus: z.string(),
    providerResultStatus: z.string(),
    qualityStatus: z.string(),
    qualityFlags: z.array(z.string()),
    limitations: z.array(z.string()),
    requestedScope: jsonValueSchema,
    coveredScope: jsonValueSchema,
    missingScope: jsonValueSchema,
  }),
  observations: z.array(observationSchema),
});

const chartPointSchema = z.object({
  label: z.string(),
  value: z.number(),
  displayValue: z.string(),
  revisionId: z.string(),
});

const phaseSchema = z.object({
  id: homepageMarketPhaseSchema,
  label: z.string(),
  snapshotId: z.string(),
  manifestId: z.string(),
  activationSequence: z.string(),
  generatedAt: z.string().datetime(),
  targetTradeDate: z.string(),
  state: z.enum(["READY", "READY_WITH_LIMITATION"]),
  domains: z.array(domainSchema).length(6),
  charts: z.object({
    breadth: z.array(chartPointSchema),
    flows: z.array(chartPointSchema),
    events: z.array(
      z.object({
        label: z.string(),
        time: z.string(),
        revisionId: z.string(),
      }),
    ),
  }),
});

export const homepageMarketBaselineSchema = z.object({
  contractVersion: z.literal("professional-market-baseline.v1"),
  defaultPhase: homepageMarketPhaseSchema,
  phases: z.array(phaseSchema).length(4),
});

export type HomepageMarketPhaseId = z.infer<typeof homepageMarketPhaseSchema>;
export type HomepageMarketDomainId = z.infer<typeof homepageMarketDomainSchema>;
export type HomepageMarketBaseline = z.infer<
  typeof homepageMarketBaselineSchema
>;

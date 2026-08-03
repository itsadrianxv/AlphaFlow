import { z } from "zod";
import { homepageMarketBaselineSchema } from "~/contracts/homepage-market-baseline";
import { marketHeatmapSnapshotSchema } from "~/contracts/market-heatmap";

export const HOMEPAGE_PAYLOAD_SCHEMA_VERSION = "homepage-payload.v2";
export const HOMEPAGE_COVERAGE_SCHEMA_VERSION = "homepage-coverage.v1";

export const HOMEPAGE_STAGE_KEYS = [
  "PRE_MARKET",
  "INTRADAY",
  "POST_MARKET",
  "FORWARD_LOOKING",
] as const;

export const HOMEPAGE_INFORMATION_DOMAIN_KEYS = [
  "MARKET_STRUCTURE",
  "FUND_FLOW_TRADING",
  "COMPANY_INFORMATION",
  "NEWS_POLICY",
  "EXPECTATION_CHANGE",
  "EVENT_CALENDAR",
] as const;

export type HomepageStageKey = (typeof HOMEPAGE_STAGE_KEYS)[number];
export type HomepageInformationDomainKey =
  (typeof HOMEPAGE_INFORMATION_DOMAIN_KEYS)[number];

export type HomePageJsonValue =
  | null
  | boolean
  | number
  | string
  | HomePageJsonValue[]
  | { [key: string]: HomePageJsonValue };

const homePageJsonValueSchema: z.ZodType<HomePageJsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(homePageJsonValueSchema),
    z.record(z.string(), homePageJsonValueSchema),
  ]),
);

const homePageSettlementStatusSchema = z.enum([
  "READY",
  "DEGRADED",
  "EMPTY",
  "FAILED",
]);

const homePageProviderResultStatusSchema = z.enum([
  "success",
  "degraded",
  "empty",
  "error",
]);

const homePageQualityStatusSchema = z.enum(["NORMAL", "DEGRADED", "ISOLATED"]);

const homePageCoverageItemSchema = z.object({
  itemKey: z.string().min(1),
  datasetKey: z.string().min(1),
  stageKey: z.enum(HOMEPAGE_STAGE_KEYS),
  domainKey: z.enum(HOMEPAGE_INFORMATION_DOMAIN_KEYS),
  required: z.boolean(),
  targetDataCutoffKey: z.string().min(1),
  actualDataCutoffKey: z.string().min(1),
  requestedScope: homePageJsonValueSchema,
  coveredScope: homePageJsonValueSchema,
  missingScope: homePageJsonValueSchema,
  settlementStatus: homePageSettlementStatusSchema,
  providerResultStatus: homePageProviderResultStatusSchema,
  qualityStatus: homePageQualityStatusSchema,
  qualityFlags: z.array(z.string()),
  limitations: z.array(z.string()),
});

const homePageDomainCoverageSchema = z.object({
  itemKeys: z.array(z.string().min(1)),
  datasetKeys: z.array(z.string().min(1)),
  targetDataCutoffKey: z.string().min(1),
  actualDataCutoffKey: z.string().min(1),
  cutoffStatus: z.enum(["KNOWN", "UNKNOWN", "INCONSISTENT"]),
  items: z.array(homePageCoverageItemSchema),
  limitations: z.array(z.string()),
});

const homePageRevisionReferenceSchema = z.object({
  itemKey: z.string().min(1),
  datasetKey: z.string().min(1),
  revisionId: z.string().min(1),
  value: homePageJsonValueSchema,
  valueHash: z.string().min(1),
});

const homePageDomainPayloadSchema = z.object({
  domainKey: z.enum(HOMEPAGE_INFORMATION_DOMAIN_KEYS),
  status: z.enum(["AVAILABLE", "DEGRADED", "EMPTY", "UNAVAILABLE"]),
  coverage: homePageDomainCoverageSchema,
  revisions: z.array(homePageRevisionReferenceSchema),
});

const homePageStagePayloadSchema = z.object({
  stageKey: z.enum(HOMEPAGE_STAGE_KEYS),
  domains: z.object({
    MARKET_STRUCTURE: homePageDomainPayloadSchema.extend({
      domainKey: z.literal("MARKET_STRUCTURE"),
    }),
    FUND_FLOW_TRADING: homePageDomainPayloadSchema.extend({
      domainKey: z.literal("FUND_FLOW_TRADING"),
    }),
    COMPANY_INFORMATION: homePageDomainPayloadSchema.extend({
      domainKey: z.literal("COMPANY_INFORMATION"),
    }),
    NEWS_POLICY: homePageDomainPayloadSchema.extend({
      domainKey: z.literal("NEWS_POLICY"),
    }),
    EXPECTATION_CHANGE: homePageDomainPayloadSchema.extend({
      domainKey: z.literal("EXPECTATION_CHANGE"),
    }),
    EVENT_CALENDAR: homePageDomainPayloadSchema.extend({
      domainKey: z.literal("EVENT_CALENDAR"),
    }),
  }),
});

export const versionedHomePagePayloadSchema = z.object({
  schemaVersion: z.literal(HOMEPAGE_PAYLOAD_SCHEMA_VERSION),
  manifestId: z.string().min(1),
  inputHash: z.string().min(1),
  heatmap: marketHeatmapSnapshotSchema,
  stages: z.object({
    PRE_MARKET: homePageStagePayloadSchema.extend({
      stageKey: z.literal("PRE_MARKET"),
    }),
    INTRADAY: homePageStagePayloadSchema.extend({
      stageKey: z.literal("INTRADAY"),
    }),
    POST_MARKET: homePageStagePayloadSchema.extend({
      stageKey: z.literal("POST_MARKET"),
    }),
    FORWARD_LOOKING: homePageStagePayloadSchema.extend({
      stageKey: z.literal("FORWARD_LOOKING"),
    }),
  }),
  // 只为未迁移的读取调用保留类型可见性；v2 生成结果禁止携带旧区域。
  overviewInsights: z.never().optional(),
  moneyFlow: z.never().optional(),
  impactMapping: z.never().optional(),
});

export const homePageDataCoverageSchema = z.object({
  schemaVersion: z.literal(HOMEPAGE_COVERAGE_SCHEMA_VERSION),
  manifestId: z.string().min(1),
  inputHash: z.string().min(1),
  items: z.array(homePageCoverageItemSchema),
});

const legacyHomePagePayloadSchema = z.object({
  heatmap: marketHeatmapSnapshotSchema,
  overviewInsights: z.unknown(),
  moneyFlow: z.unknown(),
  impactMapping: z.unknown().nullable(),
});

// 旧快照只保留读取兼容；新生成只能使用 versionedHomePagePayloadSchema。
export const homePagePayloadSchema = z.union([
  versionedHomePagePayloadSchema,
  legacyHomePagePayloadSchema,
]);

const legacyHomePageSnapshotEnvelopeSchema = z.object({
  snapshotId: z.string(),
  source: z.enum(["BASELINE", "PERSONALIZED"]),
  manifestId: z.string(),
  generatedAt: z.string().datetime(),
  dataCoverage: z.unknown(),
  baselineOutdated: z.boolean(),
  refreshInProgress: z.boolean(),
  personalizationPending: z.boolean(),
  payload: homePagePayloadSchema,
  marketBaseline: homepageMarketBaselineSchema,
});

const versionedHomePageSnapshotEnvelopeSchema = z.object({
  snapshotId: z.string().min(1),
  source: z.enum(["BASELINE", "PERSONALIZED"]),
  manifestId: z.string().min(1),
  generatedAt: z.string().datetime(),
  dataCoverage: homePageDataCoverageSchema,
  baselineOutdated: z.boolean(),
  refreshInProgress: z.boolean(),
  personalizationPending: z.boolean(),
  payload: versionedHomePagePayloadSchema,
  marketBaseline: homepageMarketBaselineSchema,
  // 读取层迁移完成前只保留属性类型，不允许 v2 信封继续写入旧语义。
  dataAsOf: z.never().optional(),
  isStale: z.never().optional(),
  isRefreshing: z.never().optional(),
});

export const homePageSnapshotEnvelopeSchema = z.union([
  versionedHomePageSnapshotEnvelopeSchema,
  legacyHomePageSnapshotEnvelopeSchema,
]);

export type HomePageCoverageItem = z.infer<typeof homePageCoverageItemSchema>;
export type HomePageDataCoverage = z.infer<typeof homePageDataCoverageSchema>;
export type HomePagePayload = z.infer<typeof homePagePayloadSchema>;
export type VersionedHomePagePayload = z.infer<
  typeof versionedHomePagePayloadSchema
>;
export type HomePageSnapshotEnvelope = z.infer<
  typeof homePageSnapshotEnvelopeSchema
>;

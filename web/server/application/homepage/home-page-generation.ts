import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  HOMEPAGE_PAYLOAD_SCHEMA_VERSION as CONTRACT_PAYLOAD_SCHEMA_VERSION,
  HOMEPAGE_COVERAGE_SCHEMA_VERSION,
  HOMEPAGE_INFORMATION_DOMAIN_KEYS,
  HOMEPAGE_STAGE_KEYS,
  type HomePageCoverageItem,
  type HomePageDataCoverage,
  type HomePageJsonValue,
  type HomepageInformationDomainKey,
  type HomepageStageKey,
  homePageDataCoverageSchema,
  type VersionedHomePagePayload,
  versionedHomePagePayloadSchema,
} from "~/contracts/homepage";

export const HOMEPAGE_GENERATION_INPUT_CONTRACT_VERSION =
  "homepage-generation-input.v1";
export const HOMEPAGE_GENERATOR_DEFINITION_VERSION = "homepage-generator.v1";
export const HOMEPAGE_PAYLOAD_SCHEMA_VERSION = CONTRACT_PAYLOAD_SCHEMA_VERSION;

type HomePageDb = PrismaClient;
type JsonValue = HomePageJsonValue;

export type HomepageGenerationInput = {
  contractVersion: string;
  task: {
    id: string;
    manifestId: string;
    activationSequence: string;
    promotionMode: "PROMOTABLE" | "HISTORICAL_ONLY";
    generationInputContractVersion: string;
    generatorDefinitionVersion: string;
    payloadSchemaVersion: string;
  };
  manifest: {
    id: string;
    manifestKey: string;
    canonicalizationVersion: string;
    scope: "BASELINE" | "PERSONALIZED";
    definitionVersion: string;
    targetContextKey: string;
    targetContextJson: JsonValue;
    activationSequence: string;
    userId: string | null;
    baseManifestId: string | null;
    frozenPreferenceContractVersion: string | null;
    frozenPreferenceJson: JsonValue | null;
    gateStatus: "READY" | "READY_WITH_LIMITATION";
  };
  baseManifest: {
    id: string;
    manifestKey: string;
    activationSequence: string;
    gateStatus: string;
  } | null;
  items: HomepageGenerationInputItem[];
  inputHash: string;
};

export type HomepageGenerationInputItem = {
  id: string;
  itemKey: string;
  sourceManifestId: string;
  canonicalizationVersion: string;
  datasetKey: string;
  factScopeKey: string;
  factScopeJson: JsonValue;
  requirementVersion: string;
  required: boolean;
  emptyPolicy: string;
  targetDataCutoffKey: string;
  targetDataCutoffJson: JsonValue;
  settlement: {
    id: string;
    settlementStatus: string;
    providerResultStatus: string;
    requestedScopeJson: JsonValue;
    coveredScopeJson: JsonValue;
    missingScopeJson: JsonValue;
    targetDataCutoffKey: string;
    targetDataCutoffJson: JsonValue;
    actualDataCutoffKey: string;
    actualDataCutoffJson: JsonValue;
    qualityStatus: string;
    qualityFlags: string[];
    limitations: string[];
    errorClass: string | null;
    retryability: string | null;
    revisions: HomepageGenerationInputRevision[];
  };
};

export type HomepageGenerationInputRevision = {
  ordinal: number;
  id: string;
  observationId: string;
  revisionNo: number;
  revisionDedupKey: string;
  canonicalizationVersion: string;
  valueType: string;
  valueText: string | null;
  valueJson: JsonValue | null;
  unit: string | null;
  precision: number | null;
  missingReason: string | null;
  qualityStatus: string;
  qualityFlags: string[];
  valueHash: string;
  normalizationRulesVersion: string;
  upstreamAsOf: string | null;
  sourcePublishedAt: string | null;
  normalizedAt: string;
};

export type HomepageGeneratedResult = {
  kind: "generated";
  taskId: string;
  manifestId: string;
  activationSequence: string;
  promotionMode: "PROMOTABLE" | "HISTORICAL_ONLY";
  generationInputContractVersion: string;
  generatorDefinitionVersion: string;
  payloadSchemaVersion: string;
  inputHash: string;
  payloadHash: string;
  payload: VersionedHomePagePayload;
  dataCoverage: HomePageDataCoverage;
};

export type HomepageGenerationServiceResult =
  | HomepageGeneratedResult
  | { kind: "obsolete" }
  | {
      kind: "retryable_failure" | "terminal_failure";
      errorCode:
        | "INPUT_NOT_READY"
        | "DEPENDENCY_UNAVAILABLE"
        | "CONTRACT_INCOMPATIBLE"
        | "INPUT_INVARIANT_VIOLATION";
      details: JsonValue;
    };

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("规范化 JSON 不允许 NaN 或 Infinity");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(record[key])}`)
      .join(",")}}`;
  }
  throw new Error(`规范化 JSON 不支持类型 ${typeof value}`);
}

export function sha256Canonical(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalize(value), "utf8").digest("hex")}`;
}

function json(value: unknown): JsonValue {
  return (value ?? null) as JsonValue;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function versionMajor(version: string) {
  return (
    version.match(/(?:^|[._-])v?(\d+)(?:\.\d+)?$/)?.[1] ??
    version.match(/^(\d+)/)?.[1] ??
    null
  );
}

function assertSupportedMajor(version: string, expectedMajor: string) {
  if (versionMajor(version) !== expectedMajor) {
    throw new Error(`不支持的首页版本 ${version}`);
  }
}

function normalizeItems(items: HomepageGenerationInputItem[]) {
  return [...items]
    .sort((a, b) => a.itemKey.localeCompare(b.itemKey))
    .map((item) => ({
      ...item,
      settlement: {
        ...item.settlement,
        qualityFlags: [...item.settlement.qualityFlags].sort(),
        limitations: [...item.settlement.limitations].sort(),
        revisions: [...item.settlement.revisions].sort(
          (a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id),
        ),
      },
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isStageKey(value: string | null): value is HomepageStageKey {
  return Boolean(
    value && HOMEPAGE_STAGE_KEYS.includes(value as HomepageStageKey),
  );
}

function isDomainKey(
  value: string | null,
): value is HomepageInformationDomainKey {
  return Boolean(
    value &&
      HOMEPAGE_INFORMATION_DOMAIN_KEYS.includes(
        value as HomepageInformationDomainKey,
      ),
  );
}

function resolveStageKey(item: HomepageGenerationInputItem): HomepageStageKey {
  const scope = isRecord(item.factScopeJson) ? item.factScopeJson : {};
  const candidate = readString(
    scope.stageKey ?? scope.stage ?? scope.tradeStage,
  );
  return isStageKey(candidate) ? candidate : "PRE_MARKET";
}

function resolveDomainKey(
  item: HomepageGenerationInputItem,
): HomepageInformationDomainKey {
  const scope = isRecord(item.factScopeJson) ? item.factScopeJson : {};
  const explicit = readString(scope.domainKey ?? scope.domain);
  if (isDomainKey(explicit)) return explicit;

  const datasetKey = item.datasetKey.toLowerCase();
  if (
    datasetKey === "market_heatmap" ||
    /market|index|industry|theme|concept|intraday|quote/.test(datasetKey)
  ) {
    return "MARKET_STRUCTURE";
  }
  if (/flow|margin|longhu|limit|turnover|trading|heat/.test(datasetKey)) {
    return "FUND_FLOW_TRADING";
  }
  if (
    /forecast|rating|expectation|consensus|sell_side|research_report/.test(
      datasetKey,
    )
  ) {
    return "EXPECTATION_CHANGE";
  }
  if (/calendar|event|ipo|dividend|unlock|macro_schedule/.test(datasetKey)) {
    return "EVENT_CALENDAR";
  }
  if (/news|policy|regulation/.test(datasetKey)) {
    return "NEWS_POLICY";
  }
  if (
    /company|financial|income|balance|cash|buyback|action|qa|profile/.test(
      datasetKey,
    )
  ) {
    return "COMPANY_INFORMATION";
  }
  return "MARKET_STRUCTURE";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function actualCutoffKeys(items: HomepageGenerationInputItem[]) {
  return uniqueStrings(
    items
      .map((item) => item.settlement.actualDataCutoffKey)
      .filter((value) => value.length > 0 && value !== "unknown"),
  );
}

function cutoffSummary(items: HomepageGenerationInputItem[]) {
  const targetKeys = uniqueStrings(
    items.map((item) => item.settlement.targetDataCutoffKey),
  );
  const actualKeys = actualCutoffKeys(items);
  const limitations: string[] = [];
  if (items.length === 0) {
    limitations.push("该阶段该信息域没有已结算清单项");
  }
  if (targetKeys.length > 1) {
    limitations.push("同一阶段信息域的 target cutoff 不一致");
  }
  if (actualKeys.length > 1) {
    limitations.push("同一阶段信息域的 actual cutoff 不一致");
  }
  const cutoffStatus =
    items.length === 0 || actualKeys.length === 0
      ? "UNKNOWN"
      : targetKeys.length > 1 || actualKeys.length > 1
        ? "INCONSISTENT"
        : "KNOWN";
  return {
    targetDataCutoffKey: targetKeys.length === 1 ? targetKeys[0] : "unknown",
    actualDataCutoffKey: actualKeys.length === 1 ? actualKeys[0] : "unknown",
    cutoffStatus,
    limitations,
  } as const;
}

function revisionsFor(items: HomepageGenerationInputItem[]) {
  return items
    .flatMap((item) =>
      item.settlement.revisions.map((revision) => ({ item, revision })),
    )
    .sort(
      (a, b) =>
        a.item.itemKey.localeCompare(b.item.itemKey) ||
        a.revision.ordinal - b.revision.ordinal ||
        a.revision.id.localeCompare(b.revision.id),
    );
}

function normalizeSettlementStatus(value: string) {
  if (
    value === "READY" ||
    value === "DEGRADED" ||
    value === "EMPTY" ||
    value === "FAILED"
  ) {
    return value;
  }
  throw new Error(`清单项存在不支持的结算状态: ${value}`);
}

function normalizeProviderResultStatus(value: string) {
  if (
    value === "success" ||
    value === "degraded" ||
    value === "empty" ||
    value === "error"
  ) {
    return value;
  }
  throw new Error(`清单项存在不支持的 Provider 结果状态: ${value}`);
}

function normalizeQualityStatus(value: string) {
  if (value === "NORMAL" || value === "DEGRADED" || value === "ISOLATED") {
    return value;
  }
  throw new Error(`清单项存在不支持的数据质量状态: ${value}`);
}

function coverageItem(item: HomepageGenerationInputItem): HomePageCoverageItem {
  return {
    itemKey: item.itemKey,
    datasetKey: item.datasetKey,
    stageKey: resolveStageKey(item),
    domainKey: resolveDomainKey(item),
    required: item.required,
    targetDataCutoffKey: item.settlement.targetDataCutoffKey,
    actualDataCutoffKey: item.settlement.actualDataCutoffKey || "unknown",
    requestedScope: item.settlement.requestedScopeJson,
    coveredScope: item.settlement.coveredScopeJson,
    missingScope: item.settlement.missingScopeJson,
    settlementStatus: normalizeSettlementStatus(
      item.settlement.settlementStatus,
    ),
    providerResultStatus: normalizeProviderResultStatus(
      item.settlement.providerResultStatus,
    ),
    qualityStatus: normalizeQualityStatus(item.settlement.qualityStatus),
    qualityFlags: uniqueStrings(item.settlement.qualityFlags),
    limitations: uniqueStrings(item.settlement.limitations),
  };
}

function domainStatus(items: HomepageGenerationInputItem[]) {
  if (items.length === 0) return "UNAVAILABLE" as const;
  const statuses = items.map((item) =>
    normalizeSettlementStatus(item.settlement.settlementStatus),
  );
  if (statuses.every((status) => status === "EMPTY")) return "EMPTY" as const;
  if (statuses.some((status) => status !== "READY")) {
    return "DEGRADED" as const;
  }
  return "AVAILABLE" as const;
}

function buildDomainPayload(
  stageKey: HomepageStageKey,
  domainKey: HomepageInformationDomainKey,
  inputItems: HomepageGenerationInputItem[],
) {
  const items = normalizeItems(inputItems);
  const itemCoverage = items.map(coverageItem);
  const summary = cutoffSummary(items);
  const limitations = uniqueStrings([
    ...summary.limitations,
    ...items.flatMap((item) => item.settlement.limitations),
  ]);
  return {
    domainKey,
    status: domainStatus(items),
    coverage: {
      itemKeys: items.map((item) => item.itemKey),
      datasetKeys: uniqueStrings(items.map((item) => item.datasetKey)),
      targetDataCutoffKey: summary.targetDataCutoffKey,
      actualDataCutoffKey: summary.actualDataCutoffKey,
      cutoffStatus: summary.cutoffStatus,
      items: itemCoverage,
      limitations,
    },
    revisions: revisionsFor(items).map(({ item, revision }) => ({
      itemKey: item.itemKey,
      datasetKey: item.datasetKey,
      revisionId: revision.id,
      value: json(revision.valueJson ?? revision.valueText),
      valueHash: revision.valueHash,
    })),
    stageKey,
  };
}

function buildStagePayload(
  stageKey: HomepageStageKey,
  input: HomepageGenerationInput,
) {
  const stageItems = input.items.filter(
    (item) => resolveStageKey(item) === stageKey,
  );
  return {
    stageKey,
    domains: {
      MARKET_STRUCTURE: buildDomainPayload(
        stageKey,
        "MARKET_STRUCTURE",
        stageItems.filter(
          (item) => resolveDomainKey(item) === "MARKET_STRUCTURE",
        ),
      ),
      FUND_FLOW_TRADING: buildDomainPayload(
        stageKey,
        "FUND_FLOW_TRADING",
        stageItems.filter(
          (item) => resolveDomainKey(item) === "FUND_FLOW_TRADING",
        ),
      ),
      COMPANY_INFORMATION: buildDomainPayload(
        stageKey,
        "COMPANY_INFORMATION",
        stageItems.filter(
          (item) => resolveDomainKey(item) === "COMPANY_INFORMATION",
        ),
      ),
      NEWS_POLICY: buildDomainPayload(
        stageKey,
        "NEWS_POLICY",
        stageItems.filter((item) => resolveDomainKey(item) === "NEWS_POLICY"),
      ),
      EXPECTATION_CHANGE: buildDomainPayload(
        stageKey,
        "EXPECTATION_CHANGE",
        stageItems.filter(
          (item) => resolveDomainKey(item) === "EXPECTATION_CHANGE",
        ),
      ),
      EVENT_CALENDAR: buildDomainPayload(
        stageKey,
        "EVENT_CALENDAR",
        stageItems.filter(
          (item) => resolveDomainKey(item) === "EVENT_CALENDAR",
        ),
      ),
    },
  };
}

function finiteNumber(value: unknown, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeNumber(value: unknown) {
  return Math.max(0, finiteNumber(value, 0));
}

function positiveInteger(value: unknown, fallback: number) {
  const number = Math.trunc(finiteNumber(value, fallback));
  return number > 0 ? number : fallback;
}

function nullableNumber(value: unknown) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeHeatmapStocks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((stock) => {
    if (!isRecord(stock)) return [];
    const stockCode = readString(stock.stockCode);
    const stockName = readString(stock.stockName) ?? stockCode;
    if (!stockCode || !stockName || !/^\d{6}$/.test(stockCode)) return [];
    return [
      {
        stockCode,
        stockName,
        marketCap: nonNegativeNumber(stock.marketCap),
        changePercent: nullableNumber(stock.changePercent),
      },
    ];
  });
}

function buildHeatmap(input: HomepageGenerationInput) {
  const heatmapItems = input.items.filter(
    (item) => item.datasetKey === "market_heatmap",
  );
  const concepts = revisionsFor(heatmapItems).map(({ revision }, index) => {
    const value = isRecord(revision.valueJson) ? revision.valueJson : {};
    const conceptCode =
      readString(value.conceptCode) ?? readString(value.id) ?? revision.id;
    const conceptName =
      readString(value.conceptName) ??
      readString(value.name) ??
      `概念 ${index + 1}`;
    return {
      conceptCode,
      conceptName,
      hotRank: positiveInteger(value.hotRank, index + 1),
      hotScore: nullableNumber(value.hotScore ?? value.score),
      marketCap: nonNegativeNumber(value.marketCap),
      changePercent: nullableNumber(value.changePercent ?? value.changePct),
      stocks: normalizeHeatmapStocks(value.stocks),
    };
  });
  const cutoff = cutoffSummary(heatmapItems);
  return {
    tradeDate: cutoff.actualDataCutoffKey,
    marketCapAsOf: cutoff.actualDataCutoffKey,
    priceSource: "daily" as const,
    concepts,
  };
}

function normalizeInput(input: HomepageGenerationInput) {
  return {
    ...input,
    items: normalizeItems(input.items),
  };
}

export function generateHomepageDraft(
  input: HomepageGenerationInput,
): HomepageGeneratedResult {
  const normalizedInput = normalizeInput(input);
  const { inputHash, ...inputWithoutHash } = normalizedInput;
  if (sha256Canonical(inputWithoutHash) !== inputHash) {
    throw new Error("固定输入哈希不一致");
  }

  const payload = versionedHomePagePayloadSchema.parse({
    schemaVersion: HOMEPAGE_PAYLOAD_SCHEMA_VERSION,
    manifestId: normalizedInput.manifest.id,
    inputHash,
    heatmap: buildHeatmap(normalizedInput),
    stages: {
      PRE_MARKET: buildStagePayload("PRE_MARKET", normalizedInput),
      INTRADAY: buildStagePayload("INTRADAY", normalizedInput),
      POST_MARKET: buildStagePayload("POST_MARKET", normalizedInput),
      FORWARD_LOOKING: buildStagePayload("FORWARD_LOOKING", normalizedInput),
    },
  });
  const dataCoverage = homePageDataCoverageSchema.parse({
    schemaVersion: HOMEPAGE_COVERAGE_SCHEMA_VERSION,
    manifestId: normalizedInput.manifest.id,
    inputHash,
    items: normalizedInput.items.map(coverageItem),
  });

  return {
    kind: "generated",
    taskId: normalizedInput.task.id,
    manifestId: normalizedInput.manifest.id,
    activationSequence: normalizedInput.task.activationSequence,
    promotionMode: normalizedInput.task.promotionMode,
    generationInputContractVersion:
      normalizedInput.task.generationInputContractVersion,
    generatorDefinitionVersion: normalizedInput.task.generatorDefinitionVersion,
    payloadSchemaVersion: normalizedInput.task.payloadSchemaVersion,
    inputHash,
    payloadHash: sha256Canonical(payload),
    payload,
    dataCoverage,
  };
}

export async function loadHomepageGenerationInput(
  db: HomePageDb,
  request: {
    taskId: string;
    workerId: string;
    fencingToken: string;
  },
): Promise<HomepageGenerationInput | null> {
  return db.$transaction(
    async (tx) => {
      const task = await tx.homepageGenerationTask.findUnique({
        where: { id: request.taskId },
        include: {
          manifest: {
            include: {
              baseManifest: {
                select: {
                  id: true,
                  manifestKey: true,
                  activationSequence: true,
                  gateStatus: true,
                },
              },
              items: {
                include: {
                  settlement: {
                    include: {
                      revisions: {
                        orderBy: { ordinal: "asc" },
                        include: { observationRevision: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (
        !task ||
        task.status !== "RUNNING" ||
        task.workerId !== request.workerId ||
        task.fencingToken.toString() !== request.fencingToken
      ) {
        return null;
      }
      assertSupportedMajor(
        task.generationInputContractVersion,
        versionMajor(HOMEPAGE_GENERATION_INPUT_CONTRACT_VERSION) ?? "1",
      );
      assertSupportedMajor(
        task.generatorDefinitionVersion,
        versionMajor(HOMEPAGE_GENERATOR_DEFINITION_VERSION) ?? "1",
      );
      assertSupportedMajor(
        task.payloadSchemaVersion,
        versionMajor(HOMEPAGE_PAYLOAD_SCHEMA_VERSION) ?? "2",
      );
      const manifest = task.manifest;
      if (
        manifest.gateStatus !== "READY" &&
        manifest.gateStatus !== "READY_WITH_LIMITATION"
      ) {
        throw new Error("清单未达到可生成门控");
      }

      const parentItems = manifest.baseManifestId
        ? await tx.homepageDataManifestItem.findMany({
            where: { manifestId: manifest.baseManifestId },
            include: {
              settlement: {
                include: {
                  revisions: {
                    orderBy: { ordinal: "asc" },
                    include: { observationRevision: true },
                  },
                },
              },
            },
          })
        : [];
      const effectiveItems = [...parentItems, ...manifest.items].sort((a, b) =>
        a.itemKey.localeCompare(b.itemKey),
      );
      const seen = new Set<string>();
      const items = effectiveItems.map((item) => {
        if (seen.has(item.itemKey)) {
          throw new Error(`清单项键冲突: ${item.itemKey}`);
        }
        seen.add(item.itemKey);
        if (!item.settlement) {
          throw new Error(`清单项缺少终态结算: ${item.itemKey}`);
        }
        return {
          id: item.id,
          itemKey: item.itemKey,
          sourceManifestId: item.manifestId,
          canonicalizationVersion: item.canonicalizationVersion,
          datasetKey: item.datasetKey,
          factScopeKey: item.factScopeKey,
          factScopeJson: json(item.factScopeJson),
          requirementVersion: item.requirementVersion,
          required: item.required,
          emptyPolicy: item.emptyPolicy,
          targetDataCutoffKey: item.targetDataCutoffKey,
          targetDataCutoffJson: json(item.targetDataCutoffJson),
          settlement: {
            id: item.settlement.id,
            settlementStatus: item.settlement.settlementStatus,
            providerResultStatus: item.settlement.providerResultStatus,
            requestedScopeJson: json(item.settlement.requestedScopeJson),
            coveredScopeJson: json(item.settlement.coveredScopeJson),
            missingScopeJson: json(item.settlement.missingScopeJson),
            targetDataCutoffKey: item.settlement.targetDataCutoffKey,
            targetDataCutoffJson: json(item.settlement.targetDataCutoffJson),
            actualDataCutoffKey: item.settlement.actualDataCutoffKey,
            actualDataCutoffJson: json(item.settlement.actualDataCutoffJson),
            qualityStatus: item.settlement.qualityStatus,
            qualityFlags: [...item.settlement.qualityFlags].sort(),
            limitations: [...item.settlement.limitations].sort(),
            errorClass: item.settlement.errorClass,
            retryability: item.settlement.retryability,
            revisions: [...item.settlement.revisions]
              .sort(
                (a, b) =>
                  a.ordinal - b.ordinal ||
                  a.observationRevision.id.localeCompare(
                    b.observationRevision.id,
                  ),
              )
              .map(({ ordinal, observationRevision }) => ({
                ordinal,
                id: observationRevision.id,
                observationId: observationRevision.observationId,
                revisionNo: observationRevision.revisionNo,
                revisionDedupKey: observationRevision.revisionDedupKey,
                canonicalizationVersion:
                  observationRevision.canonicalizationVersion,
                valueType: observationRevision.valueType,
                valueText: observationRevision.valueText,
                valueJson: json(observationRevision.valueJson),
                unit: observationRevision.unit,
                precision: observationRevision.precision,
                missingReason: observationRevision.missingReason,
                qualityStatus: observationRevision.qualityStatus,
                qualityFlags: [...observationRevision.qualityFlags].sort(),
                valueHash: observationRevision.valueHash,
                normalizationRulesVersion:
                  observationRevision.normalizationRulesVersion,
                upstreamAsOf: iso(observationRevision.upstreamAsOf),
                sourcePublishedAt: iso(observationRevision.sourcePublishedAt),
                normalizedAt: observationRevision.normalizedAt.toISOString(),
              })),
          },
        };
      });

      const inputWithoutHash = {
        contractVersion: HOMEPAGE_GENERATION_INPUT_CONTRACT_VERSION,
        task: {
          id: task.id,
          manifestId: task.manifestId,
          activationSequence: task.activationSequence.toString(),
          promotionMode: task.promotionMode as "PROMOTABLE" | "HISTORICAL_ONLY",
          generationInputContractVersion: task.generationInputContractVersion,
          generatorDefinitionVersion: task.generatorDefinitionVersion,
          payloadSchemaVersion: task.payloadSchemaVersion,
        },
        manifest: {
          id: manifest.id,
          manifestKey: manifest.manifestKey,
          canonicalizationVersion: manifest.canonicalizationVersion,
          scope: manifest.scope as "BASELINE" | "PERSONALIZED",
          definitionVersion: manifest.definitionVersion,
          targetContextKey: manifest.targetContextKey,
          targetContextJson: json(manifest.targetContextJson),
          activationSequence: manifest.activationSequence.toString(),
          userId: manifest.userId,
          baseManifestId: manifest.baseManifestId,
          frozenPreferenceContractVersion:
            manifest.frozenPreferenceContractVersion,
          frozenPreferenceJson: json(manifest.frozenPreferenceJson),
          gateStatus: manifest.gateStatus as "READY" | "READY_WITH_LIMITATION",
        },
        baseManifest: manifest.baseManifest
          ? {
              id: manifest.baseManifest.id,
              manifestKey: manifest.baseManifest.manifestKey,
              activationSequence:
                manifest.baseManifest.activationSequence.toString(),
              gateStatus: manifest.baseManifest.gateStatus,
            }
          : null,
        items: normalizeItems(items),
      };
      const input = {
        ...inputWithoutHash,
        inputHash: sha256Canonical(inputWithoutHash),
      };
      await tx.homepageGenerationTask.update({
        where: { id: task.id },
        data: { inputHash: input.inputHash },
      });
      return input;
    },
    { isolationLevel: "RepeatableRead" },
  );
}

export async function runHomepageGeneration(
  db: HomePageDb,
  request: {
    taskId: string;
    workerId: string;
    fencingToken: string;
  },
): Promise<HomepageGenerationServiceResult> {
  try {
    const input = await loadHomepageGenerationInput(db, request);
    if (!input) return { kind: "obsolete" };
    return generateHomepageDraft(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("不支持的首页版本")) {
      return {
        kind: "terminal_failure",
        errorCode: "CONTRACT_INCOMPATIBLE",
        details: { message },
      };
    }
    if (
      message.includes("清单项键冲突") ||
      message.includes("清单项缺少终态结算") ||
      message.includes("固定输入哈希不一致") ||
      message.includes("不支持的结算状态") ||
      message.includes("不支持的 Provider 结果状态") ||
      message.includes("不支持的数据质量状态")
    ) {
      return {
        kind: "terminal_failure",
        errorCode: "INPUT_INVARIANT_VIOLATION",
        details: { message },
      };
    }
    return {
      kind: "retryable_failure",
      errorCode: "INPUT_NOT_READY",
      details: { message },
    };
  }
}

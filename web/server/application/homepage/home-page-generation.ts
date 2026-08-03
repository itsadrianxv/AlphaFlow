import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { HomePagePayload } from "~/contracts/homepage";

export const HOMEPAGE_GENERATION_INPUT_CONTRACT_VERSION = "1.0";
export const HOMEPAGE_GENERATOR_DEFINITION_VERSION = "1.0";
export const HOMEPAGE_PAYLOAD_SCHEMA_VERSION = "1.0";

type HomePageDb = PrismaClient;

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

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
  payload: HomePagePayload;
  dataCoverage: JsonValue;
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

function assertSupportedMajor(version: string, expectedMajor = "1") {
  if (version.split(".")[0] !== expectedMajor) {
    throw new Error(`不支持的首页版本 ${version}`);
  }
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
      assertSupportedMajor(task.generationInputContractVersion);
      assertSupportedMajor(task.generatorDefinitionVersion);
      assertSupportedMajor(task.payloadSchemaVersion);
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
        if (seen.has(item.itemKey))
          throw new Error(`清单项键冲突: ${item.itemKey}`);
        seen.add(item.itemKey);
        if (!item.settlement)
          throw new Error(`清单项缺少终态结算: ${item.itemKey}`);
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
            revisions: item.settlement.revisions
              .sort((a, b) => a.ordinal - b.ordinal)
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
        items,
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

function latestCutoff(items: HomepageGenerationInputItem[]) {
  return (
    items
      .map((item) => item.settlement.actualDataCutoffKey)
      .filter(Boolean)
      .sort()
      .at(-1) ?? "unknown"
  );
}

function revisionsFor(input: HomepageGenerationInput, datasetKey: string) {
  return input.items
    .filter((item) => item.datasetKey === datasetKey)
    .flatMap((item) => item.settlement.revisions)
    .sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id));
}

function buildHeatmap(input: HomepageGenerationInput) {
  const concepts = revisionsFor(input, "market_heatmap").map(
    (revision, index) => {
      const value =
        revision.valueJson && typeof revision.valueJson === "object"
          ? revision.valueJson
          : {};
      const record = value as Record<string, unknown>;
      return {
        conceptCode: String(record.conceptCode ?? record.id ?? revision.id),
        conceptName: String(
          record.conceptName ?? record.name ?? `概念 ${index + 1}`,
        ),
        hotRank: Number(record.hotRank ?? index + 1),
        hotScore:
          record.hotScore == null
            ? Number(record.score ?? 0)
            : Number(record.hotScore),
        marketCap: Number(record.marketCap ?? 0),
        changePercent:
          record.changePercent == null
            ? Number(record.changePct ?? 0)
            : Number(record.changePercent),
        stocks: Array.isArray(record.stocks) ? record.stocks : [],
      };
    },
  );
  return {
    tradeDate: latestCutoff(input.items),
    marketCapAsOf: latestCutoff(input.items),
    priceSource: "daily" as const,
    concepts,
  };
}

export function generateHomepageDraft(
  input: HomepageGenerationInput,
): HomepageGeneratedResult {
  const dataCoverage = input.items.map((item) => ({
    itemKey: item.itemKey,
    datasetKey: item.datasetKey,
    required: item.required,
    targetDataCutoffKey: item.targetDataCutoffKey,
    actualDataCutoffKey: item.settlement.actualDataCutoffKey,
    settlementStatus: item.settlement.settlementStatus,
    providerResultStatus: item.settlement.providerResultStatus,
    qualityStatus: item.settlement.qualityStatus,
    limitations: item.settlement.limitations,
    missingScope: item.settlement.missingScopeJson,
  }));
  const payload: HomePagePayload = {
    heatmap: buildHeatmap(input),
    overviewInsights: {
      manifestId: input.manifest.id,
      inputHash: input.inputHash,
      items: input.items
        .filter((item) => item.datasetKey !== "market_heatmap")
        .map((item) => ({
          itemKey: item.itemKey,
          datasetKey: item.datasetKey,
          revisions: item.settlement.revisions.map((revision) => ({
            id: revision.id,
            value: revision.valueJson ?? revision.valueText,
            valueHash: revision.valueHash,
          })),
        })),
    },
    moneyFlow: {
      coverage: dataCoverage.filter((item) => item.datasetKey.includes("flow")),
    },
    impactMapping: null,
  };
  return {
    kind: "generated",
    taskId: input.task.id,
    manifestId: input.manifest.id,
    activationSequence: input.task.activationSequence,
    promotionMode: input.task.promotionMode,
    generationInputContractVersion: input.task.generationInputContractVersion,
    generatorDefinitionVersion: input.task.generatorDefinitionVersion,
    payloadSchemaVersion: input.task.payloadSchemaVersion,
    inputHash: input.inputHash,
    payloadHash: sha256Canonical(payload),
    payload,
    dataCoverage,
  };
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
    const terminal =
      message.includes("不支持的首页版本") ||
      message.includes("清单项键冲突") ||
      message.includes("缺少终态结算");
    return {
      kind: terminal ? "terminal_failure" : "retryable_failure",
      errorCode: terminal ? "INPUT_INVARIANT_VIOLATION" : "INPUT_NOT_READY",
      details: { message },
    };
  }
}

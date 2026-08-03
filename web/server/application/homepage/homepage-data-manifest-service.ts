import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

type HomepageManifestScope = "BASELINE" | "PERSONALIZED";
type HomepageGateStatus =
  | "PENDING"
  | "BLOCKED"
  | "READY"
  | "READY_WITH_LIMITATION";
type ProviderResultStatus = "success" | "degraded" | "empty" | "error";
type QualityStatus = "NORMAL" | "DEGRADED" | "ISOLATED";
type EmptyPolicy = "ALLOW_EMPTY" | "REQUIRE_NON_EMPTY";

type HomepageManifestItemInput = {
  itemKey: string;
  datasetKey: string;
  factScopeKey: string;
  factScopeJson: Prisma.InputJsonValue;
  requirementVersion: string;
  required: boolean;
  emptyPolicy: EmptyPolicy;
  targetDataCutoffKey: string;
  targetDataCutoffJson: Prisma.InputJsonValue;
  providerKey: string;
  providerContractVersion: string;
  normalizationRulesVersion: string;
  requestFingerprint: string;
};

type CreateManifestInput = {
  scope: HomepageManifestScope;
  definitionVersion: string;
  targetContextKey: string;
  targetContextJson: Prisma.InputJsonValue;
  requestNonce?: string;
  userId?: string;
  baseManifestId?: string;
  frozenPreferenceContractVersion?: string;
  frozenPreferenceJson?: Prisma.InputJsonValue;
  items: HomepageManifestItemInput[];
};

type SettlementInput = {
  attemptId: string;
  fencingToken: bigint | number;
  providerResultStatus: ProviderResultStatus;
  requestedScopeJson: Prisma.InputJsonValue;
  coveredScopeJson: Prisma.InputJsonValue;
  missingScopeJson: Prisma.InputJsonValue;
  actualDataCutoffKey: string;
  actualDataCutoffJson: Prisma.InputJsonValue;
  qualityStatus: QualityStatus;
  qualityFlags?: string[];
  limitations?: string[];
  errorClass?: string;
  retryability?: string;
};

type PrismaTransaction = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
    .join(",")}}`;
}

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

function manifestKey(input: CreateManifestInput) {
  return sha256({
    scope: input.scope,
    definitionVersion: input.definitionVersion,
    targetContextKey: input.targetContextKey,
    targetContextJson: input.targetContextJson,
    requestNonce: input.requestNonce ?? null,
    userId: input.userId ?? null,
    baseManifestId: input.baseManifestId ?? null,
  });
}

function attemptKey(manifestId: string, item: HomepageManifestItemInput) {
  return sha256({
    manifestId,
    itemKey: item.itemKey,
    providerKey: item.providerKey,
    providerContractVersion: item.providerContractVersion,
    normalizationRulesVersion: item.normalizationRulesVersion,
    requestFingerprint: item.requestFingerprint,
  });
}

function resultHash(input: SettlementInput) {
  return sha256({
    providerResultStatus: input.providerResultStatus,
    requestedScopeJson: input.requestedScopeJson,
    coveredScopeJson: input.coveredScopeJson,
    missingScopeJson: input.missingScopeJson,
    actualDataCutoffKey: input.actualDataCutoffKey,
    actualDataCutoffJson: input.actualDataCutoffJson,
    qualityStatus: input.qualityStatus,
    qualityFlags: input.qualityFlags ?? [],
    limitations: input.limitations ?? [],
    errorClass: input.errorClass ?? null,
    retryability: input.retryability ?? null,
  });
}

function cutoffReached(actual: string, target: string) {
  return actual >= target;
}

function settlementStatus(
  item: { targetDataCutoffKey: string },
  input: SettlementInput,
) {
  if (input.providerResultStatus === "error") return "FAILED";
  if (input.providerResultStatus === "empty") return "EMPTY";
  if (
    input.providerResultStatus === "success" &&
    input.qualityStatus === "NORMAL" &&
    cutoffReached(input.actualDataCutoffKey, item.targetDataCutoffKey)
  ) {
    return "READY";
  }
  return "DEGRADED";
}

export type HomepageGateProjectionItem = {
  required: boolean;
  emptyPolicy: string;
  targetDataCutoffKey: string;
  settlement: null | {
    settlementStatus: string;
    qualityStatus: string;
    actualDataCutoffKey: string;
  };
};

function itemPassesGate(item: {
  emptyPolicy: string;
  targetDataCutoffKey: string;
  settlement: null | {
    settlementStatus: string;
    qualityStatus: string;
    actualDataCutoffKey: string;
  };
}) {
  const settlement = item.settlement;
  if (!settlement) return false;
  if (settlement.settlementStatus === "READY") {
    return cutoffReached(
      settlement.actualDataCutoffKey,
      item.targetDataCutoffKey,
    );
  }
  return (
    settlement.settlementStatus === "EMPTY" &&
    item.emptyPolicy === "ALLOW_EMPTY" &&
    settlement.qualityStatus === "NORMAL" &&
    cutoffReached(settlement.actualDataCutoffKey, item.targetDataCutoffKey)
  );
}

export function resolveHomepageGateStatus(
  items: HomepageGateProjectionItem[],
): HomepageGateStatus {
  const required = items.filter((item) => item.required);

  if (required.some((item) => !item.settlement)) {
    return "PENDING";
  }
  if (required.some((item) => !itemPassesGate(item))) {
    return "BLOCKED";
  }
  return items.every(itemPassesGate) ? "READY" : "READY_WITH_LIMITATION";
}

async function computeGateStatus(
  tx: PrismaTransaction,
  manifestId: string,
): Promise<HomepageGateStatus> {
  const manifest = await tx.homepageDataManifest.findUniqueOrThrow({
    where: { id: manifestId },
    select: { baseManifestId: true },
  });
  const ownItems = await tx.homepageDataManifestItem.findMany({
    where: { manifestId },
    include: { settlement: true },
  });
  const baseItems = manifest.baseManifestId
    ? await tx.homepageDataManifestItem.findMany({
        where: { manifestId: manifest.baseManifestId },
        include: { settlement: true },
      })
    : [];
  const items = [...baseItems, ...ownItems];
  return resolveHomepageGateStatus(items);
}

export class HomepageDataManifestService {
  constructor(private readonly db: PrismaClient) {}

  async createManifest(input: CreateManifestInput) {
    if (input.scope === "BASELINE" && (input.userId || input.baseManifestId)) {
      throw new Error("专业市场基线清单不能绑定用户或个性化快照基线");
    }
    if (
      input.scope === "PERSONALIZED" &&
      (!input.userId || !input.baseManifestId)
    ) {
      throw new Error("个性化首页清单必须绑定用户和个性化快照基线");
    }

    return this.db.$transaction(async (tx) => {
      const key = manifestKey(input);
      const existing = await tx.homepageDataManifest.findUnique({
        where: { manifestKey: key },
        include: { items: { include: { attempts: true } } },
      });
      if (existing) return existing;

      if (input.scope === "PERSONALIZED") {
        const base = await tx.homepageDataManifest.findUnique({
          where: { id: input.baseManifestId },
          include: { items: true },
        });
        if (!base || base.scope !== "BASELINE") {
          throw new Error("个性化首页清单只能固定专业市场基线清单");
        }
        if (
          base.gateStatus !== "READY" &&
          base.gateStatus !== "READY_WITH_LIMITATION"
        ) {
          throw new Error("个性化快照基线必须已经达到必需项门控");
        }
        const baseItemKeys = new Set(base.items.map((item) => item.itemKey));
        const conflict = input.items.find((item) =>
          baseItemKeys.has(item.itemKey),
        );
        if (conflict) {
          throw new Error(
            `个性化首页清单项不能覆盖基线清单项: ${conflict.itemKey}`,
          );
        }
      }

      const manifest = await tx.homepageDataManifest.create({
        data: {
          manifestKey: key,
          canonicalizationVersion: "homepage-manifest-key.v1",
          scope: input.scope,
          definitionVersion: input.definitionVersion,
          targetContextKey: input.targetContextKey,
          targetContextJson: input.targetContextJson,
          requestNonce: input.requestNonce,
          userId: input.userId,
          baseManifestId: input.baseManifestId,
          frozenPreferenceContractVersion:
            input.frozenPreferenceContractVersion,
          frozenPreferenceJson: input.frozenPreferenceJson,
          items: {
            create: input.items.map((item) => ({
              itemKey: item.itemKey,
              canonicalizationVersion: "homepage-manifest-item-key.v1",
              datasetKey: item.datasetKey,
              factScopeKey: item.factScopeKey,
              factScopeJson: item.factScopeJson,
              requirementVersion: item.requirementVersion,
              required: item.required,
              emptyPolicy: item.emptyPolicy,
              targetDataCutoffKey: item.targetDataCutoffKey,
              targetDataCutoffJson: item.targetDataCutoffJson,
            })),
          },
        },
        include: { items: true },
      });

      for (const item of manifest.items) {
        const definition = input.items.find(
          (candidate) => candidate.itemKey === item.itemKey,
        );
        if (!definition) continue;
        await tx.homepageDataManifestItemAttempt.create({
          data: {
            manifestItemId: item.id,
            attemptNo: 1,
            idempotencyKey: attemptKey(manifest.id, definition),
            providerKey: definition.providerKey,
            providerContractVersion: definition.providerContractVersion,
            normalizationRulesVersion: definition.normalizationRulesVersion,
            requestFingerprint: definition.requestFingerprint,
          },
        });
      }

      return tx.homepageDataManifest.findUniqueOrThrow({
        where: { id: manifest.id },
        include: { items: { include: { attempts: true } } },
      });
    });
  }

  async settleAttempt(input: SettlementInput) {
    return this.db.$transaction(async (tx) => {
      const attempt =
        await tx.homepageDataManifestItemAttempt.findUniqueOrThrow({
          where: { id: input.attemptId },
          include: { manifestItem: true },
        });
      if (BigInt(input.fencingToken) !== attempt.fencingToken) {
        throw new Error("STALE_FENCING");
      }

      const existing = await tx.homepageDataManifestItemSettlement.findUnique({
        where: { manifestItemId: attempt.manifestItemId },
      });
      if (existing) return existing;

      const settlement = await tx.homepageDataManifestItemSettlement.create({
        data: {
          manifestItemId: attempt.manifestItemId,
          settledAttemptId: attempt.id,
          settledFencingToken: BigInt(input.fencingToken),
          settlementStatus: settlementStatus(attempt.manifestItem, input),
          providerResultStatus: input.providerResultStatus,
          requestedScopeJson: input.requestedScopeJson,
          coveredScopeJson: input.coveredScopeJson,
          missingScopeJson: input.missingScopeJson,
          targetDataCutoffKey: attempt.manifestItem.targetDataCutoffKey,
          targetDataCutoffJson: attempt.manifestItem
            .targetDataCutoffJson as Prisma.InputJsonValue,
          actualDataCutoffKey: input.actualDataCutoffKey,
          actualDataCutoffJson: input.actualDataCutoffJson,
          qualityStatus: input.qualityStatus,
          qualityFlags: input.qualityFlags ?? [],
          limitations: input.limitations ?? [],
          errorClass: input.errorClass,
          retryability: input.retryability,
          settledAt: new Date(),
        },
      });
      await tx.homepageDataManifestItemAttempt.update({
        where: { id: attempt.id },
        data: {
          status:
            input.providerResultStatus === "error" ? "FAILED" : "SUCCEEDED",
          resultStatus: input.providerResultStatus,
          resultEnvelopeJson: input as unknown as Prisma.InputJsonValue,
          resultHash: resultHash(input),
          errorClass: input.errorClass,
          retryability: input.retryability,
          completedAt: new Date(),
        },
      });

      const gateStatus = await computeGateStatus(
        tx,
        attempt.manifestItem.manifestId,
      );
      const manifest = await tx.homepageDataManifest.update({
        where: { id: attempt.manifestItem.manifestId },
        data: { gateStatus },
      });
      if (gateStatus === "READY" || gateStatus === "READY_WITH_LIMITATION") {
        await tx.homepageGenerationTask.upsert({
          where: { manifestId: manifest.id },
          create: {
            generationKey: `homepage-manifest:${manifest.id}`,
            manifestId: manifest.id,
            activationSequence: manifest.activationSequence,
            generationInputContractVersion: "homepage-generation-input.v1",
            generatorDefinitionVersion: manifest.definitionVersion,
            payloadSchemaVersion: "homepage-payload.v1",
            promotionMode:
              manifest.scope === "BASELINE" ? "BASELINE" : "PERSONALIZED",
            schedulingTier: "BACKGROUND",
            resourcePoolKey: "homepage-generator",
            fairnessKey: manifest.userId ?? "baseline",
            inputHash: sha256({ manifestId: manifest.id, gateStatus }),
          },
          update: {},
        });
      }

      return settlement;
    });
  }
}

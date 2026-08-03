import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { HomepageDataManifestService } from "~/server/application/homepage/homepage-data-manifest-service";

const contractDatabaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = contractDatabaseUrl ? describe : describe.skip;

function key(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

function item(overrides: Partial<Parameters<HomepageDataManifestService["createManifest"]>[0]["items"][number]> = {}) {
  const itemKey = overrides.itemKey ?? key("item");
  return {
    itemKey,
    datasetKey: overrides.datasetKey ?? "daily_price",
    factScopeKey: overrides.factScopeKey ?? itemKey,
    factScopeJson: overrides.factScopeJson ?? { scope: itemKey },
    requirementVersion: overrides.requirementVersion ?? "requirements-v1",
    required: overrides.required ?? true,
    emptyPolicy: overrides.emptyPolicy ?? "REQUIRE_NON_EMPTY",
    targetDataCutoffKey: overrides.targetDataCutoffKey ?? "2026-08-03",
    targetDataCutoffJson: overrides.targetDataCutoffJson ?? { tradeDate: "2026-08-03" },
    providerKey: overrides.providerKey ?? "minishare",
    providerContractVersion: overrides.providerContractVersion ?? "1.0",
    normalizationRulesVersion: overrides.normalizationRulesVersion ?? "rules-v1",
    requestFingerprint: overrides.requestFingerprint ?? `sha256:${key("request")}`,
  };
}

describePostgres("首页数据清单 PostgreSQL 契约", () => {
  const db = new PrismaClient({
    datasources: {
      db: {
        url: contractDatabaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused",
      },
    },
  });
  const service = new HomepageDataManifestService(db);

  afterAll(async () => {
    await db.$disconnect();
  });

  async function claimAttempt(attemptId: string, fencingToken = 1) {
    await db.homepageDataManifestItemAttempt.update({
      where: { id: attemptId },
      data: {
        status: "RUNNING",
        workerId: key("worker"),
        fencingToken,
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    });
  }

  async function settle(attemptId: string, fencingToken = 1, overrides: Partial<Parameters<HomepageDataManifestService["settleAttempt"]>[0]> = {}) {
    const providerResultStatus = overrides.providerResultStatus ?? "success";
    let selectedRevisionId = overrides.selectedRevisionId;
    if (
      !selectedRevisionId &&
      providerResultStatus !== "error" &&
      providerResultStatus !== "empty"
    ) {
      const observation = await db.dataObservation.create({
        data: {
          identityKey: key("observation-identity"),
          canonicalizationVersion: "observation.v1",
          subjectType: "MARKET",
          subjectKey: "CN-A",
          metricCatalogId: "daily_price",
          observationKind: "INSTANT",
          observationDate: new Date("2026-08-03T00:00:00.000Z"),
        },
      });
      const revision = await db.dataObservationRevision.create({
        data: {
          observationId: observation.id,
          revisionNo: 1,
          revisionDedupKey: key("revision-dedup"),
          canonicalizationVersion: "observation.v1",
          valueType: "TEXT",
          valueText: "首页清单契约观测",
          qualityStatus: "NORMAL",
          valueHash: `sha256:${"1".repeat(64)}`,
          normalizationRulesVersion: "rules-v1",
          normalizedAt: new Date("2026-08-03T00:01:00.000Z"),
        },
      });
      selectedRevisionId = revision.id;
      await db.dataObservation.update({
        where: { id: observation.id },
        data: { currentRevisionId: revision.id },
      });
    }
    return service.settleAttempt({
      attemptId,
      fencingToken,
      selectedRevisionId,
      observationRevisionIds: selectedRevisionId
        ? [selectedRevisionId]
        : undefined,
      providerResultStatus,
      requestedScopeJson: overrides.requestedScopeJson ?? {},
      coveredScopeJson: overrides.coveredScopeJson ?? {},
      missingScopeJson: overrides.missingScopeJson ?? [],
      actualDataCutoffKey: overrides.actualDataCutoffKey ?? "2026-08-03",
      actualDataCutoffJson: overrides.actualDataCutoffJson ?? { tradeDate: "2026-08-03" },
      qualityStatus: overrides.qualityStatus ?? "NORMAL",
      qualityFlags: overrides.qualityFlags,
      limitations: overrides.limitations,
      errorClass: overrides.errorClass,
      retryability: overrides.retryability,
    });
  }

  it("按清单逻辑键幂等创建清单项和获取尝试", async () => {
    const manifestInput = {
      scope: "BASELINE" as const,
      definitionVersion: "definition-v1",
      targetContextKey: key("target"),
      targetContextJson: { tradeDate: "2026-08-03" },
      items: [item(), item({ required: false, emptyPolicy: "ALLOW_EMPTY" })],
    };

    const first = await service.createManifest(manifestInput);
    const second = await service.createManifest(manifestInput);

    expect(second.id).toBe(first.id);
    expect(first.items).toHaveLength(2);
    expect(first.items.flatMap((manifestItem) => manifestItem.attempts)).toHaveLength(2);
  });

  it("必需项达标且可选项失败时创建 READY_WITH_LIMITATION 清单和生成任务", async () => {
    const created = await service.createManifest({
      scope: "BASELINE",
      definitionVersion: "definition-v1",
      targetContextKey: key("target"),
      targetContextJson: { tradeDate: "2026-08-03" },
      items: [
        item({ itemKey: key("required"), required: true }),
        item({ itemKey: key("optional"), required: false }),
      ],
    });
    const requiredItem = created.items.find((item) => item.required);
    const optionalItem = created.items.find((item) => !item.required);
    const requiredAttempt = requiredItem?.attempts[0];
    const optionalAttempt = optionalItem?.attempts[0];
    expect(requiredAttempt).toBeDefined();
    expect(optionalAttempt).toBeDefined();

    await claimAttempt(requiredAttempt?.id ?? "");
    await settle(requiredAttempt?.id ?? "");
    expect(
      await db.homepageDataManifest.findUnique({ where: { id: created.id } }),
    ).toMatchObject({ gateStatus: "PENDING" });

    await claimAttempt(optionalAttempt?.id ?? "");
    await settle(optionalAttempt?.id ?? "", 1, {
      providerResultStatus: "error",
      qualityStatus: "ISOLATED",
      errorClass: "upstream_unavailable",
      retryability: "NON_RETRYABLE",
    });
    const manifest = await db.homepageDataManifest.findUniqueOrThrow({
      where: { id: created.id },
      include: { generationTask: true },
    });
    expect(manifest.gateStatus).toBe("READY_WITH_LIMITATION");
    expect(manifest.generationTask).toMatchObject({
      manifestId: created.id,
      status: "PENDING",
    });
  });

  it("拒绝未达标基线和个性化追加项覆盖基线项", async () => {
    const blocked = await service.createManifest({
      scope: "BASELINE",
      definitionVersion: "definition-v1",
      targetContextKey: key("target"),
      targetContextJson: {},
      items: [item({ itemKey: key("blocked") })],
    });
    const userId = key("user");
    await db.user.create({ data: { id: userId } });

    await expect(
      service.createManifest({
        scope: "PERSONALIZED",
        definitionVersion: "definition-v1",
        targetContextKey: key("target"),
        targetContextJson: {},
        userId,
        baseManifestId: blocked.id,
        frozenPreferenceContractVersion: "preference-v1",
        frozenPreferenceJson: { focuses: [] },
        items: [item({ itemKey: key("personalized") })],
      }),
    ).rejects.toThrow("必须已经达到必需项门控");

    const baseItem = item({ itemKey: key("base-item") });
    const ready = await service.createManifest({
      scope: "BASELINE",
      definitionVersion: "definition-v1",
      targetContextKey: key("target"),
      targetContextJson: {},
      items: [baseItem],
    });
    const readyAttempt = ready.items[0]?.attempts[0];
    await claimAttempt(readyAttempt?.id ?? "");
    await settle(readyAttempt?.id ?? "");

    await expect(
      service.createManifest({
        scope: "PERSONALIZED",
        definitionVersion: "definition-v1",
        targetContextKey: key("target"),
        targetContextJson: {},
        userId,
        baseManifestId: ready.id,
        frozenPreferenceContractVersion: "preference-v1",
        frozenPreferenceJson: { focuses: [] },
        items: [item({ itemKey: baseItem.itemKey })],
      }),
    ).rejects.toThrow("不能覆盖基线清单项");
  });

  it("旧 fencing 不能结算，重复结算不改写既有 settlement", async () => {
    const created = await service.createManifest({
      scope: "BASELINE",
      definitionVersion: "definition-v1",
      targetContextKey: key("target"),
      targetContextJson: {},
      items: [item({ itemKey: key("fencing") })],
    });
    const attempt = created.items[0]?.attempts[0];
    expect(attempt).toBeDefined();
    await claimAttempt(attempt?.id ?? "", 2);

    await expect(settle(attempt?.id ?? "", 1)).rejects.toThrow("STALE_FENCING");
    const first = await settle(attempt?.id ?? "", 2);
    const second = await settle(attempt?.id ?? "", 2, {
      providerResultStatus: "error",
      qualityStatus: "ISOLATED",
      errorClass: "tampered",
    });
    expect(second.id).toBe(first.id);
    expect(second.settlementStatus).toBe("READY");
  });
});

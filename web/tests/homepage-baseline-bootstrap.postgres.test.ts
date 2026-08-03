import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  HOMEPAGE_BASELINE_DATASETS,
  HomepageBaselineBootstrap,
} from "~/server/application/homepage/homepage-baseline-bootstrap";
import { enqueueHomePageTask } from "~/server/application/homepage/home-page-snapshot-service";

const contractDatabaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = contractDatabaseUrl ? describe : describe.skip;

function key(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describePostgres("首页专业市场基线自举 PostgreSQL 契约", () => {
  const db = new PrismaClient({
    datasources: {
      db: {
        url:
          contractDatabaseUrl ??
          "postgresql://unused:unused@127.0.0.1:1/unused",
      },
    },
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("用六个真实 Provider 数据集幂等创建阶段基线并发布全部获取尝试", async () => {
    const xadd = vi.fn(async () => key("event"));
    const bootstrap = new HomepageBaselineBootstrap(db, { xadd });
    const targetTradeDate = `2099-01-${String(Math.floor(Math.random() * 20) + 1).padStart(2, "0")}`;
    const requestNonce = key("idempotent-bootstrap");

    const first = await bootstrap.ensureBaseline({
      phase: "POST_MARKET",
      targetTradeDate,
      requestNonce,
    });
    const second = await bootstrap.ensureBaseline({
      phase: "POST_MARKET",
      targetTradeDate,
      requestNonce,
    });

    expect(second.manifestId).toBe(first.manifestId);
    expect(first.attemptCount).toBe(6);
    expect(first.publishedAttemptCount).toBe(6);
    expect(second.publishedAttemptCount).toBe(0);
    expect(xadd).toHaveBeenCalledTimes(6);

    const manifest = await db.homepageDataManifest.findUniqueOrThrow({
      where: { id: first.manifestId },
      include: { items: { include: { attempts: true } } },
    });
    expect(manifest.definitionVersion).toBe("homepage-baseline-manifest.v1");
    expect(manifest.targetContextJson).toEqual({
      phase: "POST_MARKET",
      targetTradeDate,
    });
    expect(manifest.items.map((item) => item.datasetKey).sort()).toEqual(
      HOMEPAGE_BASELINE_DATASETS.map((item) => item.datasetKey).sort(),
    );
    expect(
      new Set(
        manifest.items.map(
          (item) =>
            (item.factScopeJson as { baselineDomain: string }).baselineDomain,
        ),
      ),
    ).toEqual(
      new Set(["market", "flow", "company", "news", "expectation", "calendar"]),
    );
    expect(
      manifest.items.every(
        (item) => item.attempts[0]?.eventPublishedAt instanceof Date,
      ),
    ).toBe(true);
  });

  it("Redis 首次失败时保留 PostgreSQL 任务并由恢复扫描至少一次补发", async () => {
    const failedPublisher = {
      xadd: vi.fn(async () => {
        throw new Error("redis unavailable");
      }),
    };
    const targetTradeDate = `2098-02-${String(Math.floor(Math.random() * 20) + 1).padStart(2, "0")}`;
    const first = await new HomepageBaselineBootstrap(
      db,
      failedPublisher,
    ).ensureBaseline({
      phase: "PRE_MARKET",
      targetTradeDate,
      requestNonce: key("publish-failure"),
    });

    expect(first.attemptCount).toBe(6);
    expect(first.publishedAttemptCount).toBe(0);
    expect(first.publishFailures).toHaveLength(6);
    expect(
      await db.homepageDataManifestItemAttempt.count({
        where: {
          manifestItem: { manifestId: first.manifestId },
          eventPublishedAt: null,
          status: "PENDING",
        },
      }),
    ).toBe(6);

    const xadd = vi.fn(async () => key("event"));
    const recovered = await new HomepageBaselineBootstrap(db, {
      xadd,
    }).recoverUnpublishedAttempts();

    expect(recovered.publishedAttemptCount).toBeGreaterThanOrEqual(6);
    expect(xadd).toHaveBeenCalled();
    expect(
      await db.homepageDataManifestItemAttempt.count({
        where: {
          manifestItem: { manifestId: first.manifestId },
          eventPublishedAt: null,
        },
      }),
    ).toBe(0);
  });

  it("空库按同一交易日自举四阶段六域，并从已结算清单恢复首页生成任务", async () => {
    const xadd = vi.fn(async () => key("event"));
    const bootstrap = new HomepageBaselineBootstrap(db, { xadd });
    const targetTradeDate = `2096-03-${String(Math.floor(Math.random() * 20) + 1).padStart(2, "0")}`;

    const created = await bootstrap.ensureTradingDay({
      targetTradeDate,
      requestNonce: key("trading-day"),
    });

    expect(created.manifests).toHaveLength(4);
    expect(created.attemptCount).toBe(24);
    expect(created.publishedAttemptCount).toBe(24);
    const manifests = await db.homepageDataManifest.findMany({
      where: { id: { in: created.manifests.map((item) => item.manifestId) } },
      orderBy: { activationSequence: "asc" },
    });
    expect(
      manifests.map(
        (manifest) =>
          (manifest.targetContextJson as { phase: string }).phase,
      ),
    ).toEqual(["PRE_MARKET", "INTRADAY", "POST_MARKET", "FORWARD"]);

    await db.homepageDataManifest.updateMany({
      where: { id: { in: manifests.map((manifest) => manifest.id) } },
      data: { gateStatus: "READY" },
    });
    const recovered = await bootstrap.recoverReadyManifests();
    expect(recovered.createdTaskCount).toBeGreaterThanOrEqual(4);

    const tasks = await db.homepageGenerationTask.findMany({
      where: { manifestId: { in: manifests.map((manifest) => manifest.id) } },
    });
    expect(tasks).toHaveLength(4);
    expect(
      tasks.every(
        (task) =>
          task.generationInputContractVersion === "1.0" &&
          task.generatorDefinitionVersion === "1.0" &&
          task.payloadSchemaVersion === "1.0" &&
          task.promotionMode === "PROMOTABLE" &&
          task.eventPublishedAt === null,
      ),
    ).toBe(true);
  });

  it("同一清单已由结算路径创建任务时重放复用既有任务", async () => {
    const targetTradeDate = `2095-04-${String(Math.floor(Math.random() * 20) + 1).padStart(2, "0")}`;
    const created = await new HomepageBaselineBootstrap(db, {
      xadd: vi.fn(async () => key("event")),
    }).ensureBaseline({
      phase: "FORWARD",
      targetTradeDate,
      requestNonce: key("settlement-created-task"),
      publishImmediately: false,
    });
    const manifest = await db.homepageDataManifest.update({
      where: { id: created.manifestId },
      data: { gateStatus: "READY" },
    });
    const existing = await db.homepageGenerationTask.create({
      data: {
        generationKey: `homepage-manifest:${manifest.id}`,
        manifestId: manifest.id,
        activationSequence: manifest.activationSequence,
        generationInputContractVersion: "1.0",
        generatorDefinitionVersion: "1.0",
        payloadSchemaVersion: "1.0",
        promotionMode: "PROMOTABLE",
        schedulingTier: "TIME_CRITICAL",
        resourcePoolKey: "homepage-generation",
        fairnessKey: "baseline",
      },
    });

    const replayed = await enqueueHomePageTask(db, {
      scope: "BASELINE",
      manifestId: manifest.id,
      triggerReason: "MANIFEST_READY",
      publishImmediately: false,
    });

    expect(replayed?.id).toBe(existing.id);
    expect(
      await db.homepageGenerationTask.count({
        where: { manifestId: manifest.id },
      }),
    ).toBe(1);
  });

  it("同一清单的既有任务契约不兼容时明确拒绝重放", async () => {
    const targetTradeDate = `2094-05-${String(Math.floor(Math.random() * 20) + 1).padStart(2, "0")}`;
    const created = await new HomepageBaselineBootstrap(db, {
      xadd: vi.fn(async () => key("event")),
    }).ensureBaseline({
      phase: "PRE_MARKET",
      targetTradeDate,
      requestNonce: key("incompatible-task"),
      publishImmediately: false,
    });
    const manifest = await db.homepageDataManifest.update({
      where: { id: created.manifestId },
      data: { gateStatus: "READY" },
    });
    await db.homepageGenerationTask.create({
      data: {
        generationKey: `obsolete-homepage:${manifest.id}`,
        manifestId: manifest.id,
        activationSequence: manifest.activationSequence,
        generationInputContractVersion: "0.9",
        generatorDefinitionVersion: "1.0",
        payloadSchemaVersion: "1.0",
        promotionMode: "PROMOTABLE",
        schedulingTier: "TIME_CRITICAL",
        resourcePoolKey: "homepage-generation",
        fairnessKey: "baseline",
      },
    });

    await expect(
      enqueueHomePageTask(db, {
        scope: "BASELINE",
        manifestId: manifest.id,
        triggerReason: "MANIFEST_READY",
        publishImmediately: false,
      }),
    ).rejects.toThrow("首页生成任务与当前生产契约不兼容");
  });
});

import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { z } from "zod";
import { marketHeatmapSnapshotSchema } from "~/contracts/market-heatmap";
import { HomepageDataManifestService } from "~/server/application/homepage/homepage-data-manifest-service";
import { enqueueHomePageTask } from "~/server/application/homepage/home-page-snapshot-service";
import { publishHomePageGenerationTask } from "~/server/application/homepage/home-page-task-stream";
import { HOMEPAGE_GENERATOR_DEFINITION_VERSION } from "~/server/application/homepage/home-page-generation";

const db = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", {
  maxRetriesPerRequest: 3,
});

const gatewayPayloadSchema = z.object({
  data: marketHeatmapSnapshotSchema.optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  detail: z.array(z.object({ msg: z.string().optional() })).optional(),
});

type HeatmapConcept = z.infer<
  typeof marketHeatmapSnapshotSchema
>["concepts"][number];

function parseArg(name: string) {
  const prefix = `--${name}=`;
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function normalizeTradeDate(value: string) {
  const compact = value.replaceAll("-", "");
  if (!/^\d{8}$/.test(compact)) {
    throw new Error(`交易日格式必须是 YYYYMMDD 或 YYYY-MM-DD: ${value}`);
  }
  return compact;
}

function dateFromTradeDate(value: string) {
  return new Date(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00.000Z`,
  );
}

function canonicalize(value: unknown): string {
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

function sha256(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalize(value), "utf8").digest("hex")}`;
}

async function fetchRealHeatmap() {
  const baseUrl =
    process.env.PYTHON_SERVICE_URL?.replace(/\/$/, "") ??
    "http://127.0.0.1:8000";
  const response = await fetch(
    `${baseUrl}/api/v1/market/heatmap?conceptLimit=15`,
    { headers: { "content-type": "application/json" } },
  );
  const payload = gatewayPayloadSchema.parse(
    await response.json().catch(() => ({})),
  );
  if (!response.ok || !payload.data) {
    throw new Error(
      `真实热力图数据获取失败(${response.status}): ${
        payload.error?.message ?? payload.detail?.[0]?.msg ?? "未知错误"
      }`,
    );
  }
  if (payload.data.concepts.length === 0) {
    throw new Error("真实热力图数据为空，拒绝创建空首页基线");
  }
  return payload.data;
}

async function upsertHeatmapRevision(params: {
  concept: HeatmapConcept;
  tradeDate: string;
  manifestItemId: string;
  ordinal: number;
}) {
  const valueHash = sha256(params.concept);
  const identityKey = sha256({
    datasetKey: "market_heatmap",
    subjectType: "CONCEPT",
    subjectKey: params.concept.conceptCode,
    metricCatalogId: "homepage.market_heatmap.concept",
    dimensions: { market: "CN_A" },
    tradeDate: params.tradeDate,
  });
  const sourceRecordKey = [
    "market_heatmap",
    params.tradeDate,
    params.concept.conceptCode,
  ].join(":");
  const assertionKey = sha256({
    sourceKey: "tushare",
    datasetKey: "market_heatmap",
    sourceRecordKey,
    contentHash: valueHash,
  });
  const revisionDedupKey = sha256({
    identityKey,
    valueHash,
    normalizationRulesVersion: "homepage-market-heatmap.v1",
  });
  const observationDate = dateFromTradeDate(params.tradeDate);
  const sourceAssertion = await db.sourceAssertion.upsert({
    where: { assertionKey },
    create: {
      assertionKey,
      canonicalizationVersion: "homepage-source-assertion.v1",
      sourceKey: "tushare",
      datasetKey: "market_heatmap",
      sourceRecordKey,
      observationIdentityKey: identityKey,
      rawRecordJson: params.concept as unknown as Prisma.InputJsonValue,
      contentHash: valueHash,
      requestParamsHash: sha256({
        endpoint: "/api/v1/market/heatmap",
        conceptLimit: 15,
      }),
      providerVersion: "python-market-gateway.v1",
      upstreamAsOf: observationDate,
      sourcePublishedAt: observationDate,
      fetchedAt: new Date(),
    },
    update: {},
  });
  const observation =
    (await db.dataObservation.findUnique({ where: { identityKey } })) ??
    (await db.dataObservation.create({
      data: {
        identityKey,
        canonicalizationVersion: "homepage-observation.v1",
        subjectType: "CONCEPT",
        subjectKey: params.concept.conceptCode,
        metricCatalogId: "homepage.market_heatmap.concept",
        dimensionsJson: { market: "CN_A" },
        observationKind: "POINT",
        observationDate,
      },
    }));
  const existingRevision = await db.dataObservationRevision.findUnique({
    where: { revisionDedupKey },
  });
  const revision =
    existingRevision ??
    (await db.dataObservationRevision.create({
      data: {
        observationId: observation.id,
        revisionNo:
          (await db.dataObservationRevision.count({
            where: { observationId: observation.id },
          })) + 1,
        revisionDedupKey,
        canonicalizationVersion: "homepage-observation-revision.v1",
        valueType: "json",
        valueJson: params.concept as unknown as Prisma.InputJsonValue,
        qualityStatus: "NORMAL",
        valueHash,
        normalizationRulesVersion: "homepage-market-heatmap.v1",
        upstreamAsOf: observationDate,
        sourcePublishedAt: observationDate,
        normalizedAt: new Date(),
      },
    }));
  await db.dataObservation.update({
    where: { id: observation.id },
    data: { currentRevisionId: revision.id },
  });
  await db.dataObservationRevisionSource.upsert({
    where: {
      revisionId_sourceAssertionId: {
        revisionId: revision.id,
        sourceAssertionId: sourceAssertion.id,
      },
    },
    create: {
      revisionId: revision.id,
      sourceAssertionId: sourceAssertion.id,
      role: "SELECTED",
      authorityStrategyVersion: "homepage-market-heatmap-authority.v1",
      selectionReason: "首页真实基线使用 TuShare 市场热力图来源",
    },
    update: {},
  });
  return { revisionId: revision.id, ordinal: params.ordinal };
}

async function main() {
  const requestedTradeDate = parseArg("target-trade-date");
  const heatmap = await fetchRealHeatmap();
  const targetTradeDate = normalizeTradeDate(
    requestedTradeDate ?? heatmap.tradeDate,
  );
  const actualTradeDate = normalizeTradeDate(heatmap.tradeDate);
  const targetContextJson = {
    market: "CN_A",
    tradeDate: targetTradeDate,
    actualTradeDate,
    provider: "tushare",
    bootstrap: false,
  };
  const heatmapHash = sha256(heatmap);
  const itemKey = `market-heatmap:${actualTradeDate}:${heatmapHash.slice(7, 19)}`;
  const service = new HomepageDataManifestService(db);
  const manifest = await service.createManifest({
    scope: "BASELINE",
    definitionVersion: HOMEPAGE_GENERATOR_DEFINITION_VERSION,
    targetContextKey: `cn-a:${targetTradeDate}:tushare-homepage-baseline`,
    targetContextJson,
    requestNonce: heatmapHash,
    items: [
      {
        itemKey,
        datasetKey: "market_heatmap",
        factScopeKey: `cn-a:${actualTradeDate}:market-heatmap`,
        factScopeJson: {
          market: "CN_A",
          stageKey: "POST_MARKET",
          domainKey: "MARKET_STRUCTURE",
          tradeDate: actualTradeDate,
        },
        requirementVersion: "homepage-market-heatmap.v1",
        required: true,
        emptyPolicy: "REQUIRE_NON_EMPTY",
        targetDataCutoffKey: targetTradeDate,
        targetDataCutoffJson: { tradeDate: targetTradeDate },
        providerKey: "tushare",
        providerContractVersion: "python-market-gateway.v1",
        normalizationRulesVersion: "homepage-market-heatmap.v1",
        requestFingerprint: sha256({
          datasetKey: "market_heatmap",
          targetTradeDate,
          actualTradeDate,
          heatmapHash,
        }),
      },
    ],
  });
  const manifestItem = manifest.items[0];
  const attempt = manifestItem?.attempts[0];
  if (!manifestItem || !attempt) {
    throw new Error(`基线清单没有创建热力图清单项或获取尝试: ${manifest.id}`);
  }
  const revisions = [];
  for (const [index, concept] of heatmap.concepts.entries()) {
    revisions.push(
      await upsertHeatmapRevision({
        concept,
        tradeDate: actualTradeDate,
        manifestItemId: manifestItem.id,
        ordinal: index,
      }),
    );
  }

  await db.homepageDataManifestItemAttempt.update({
    where: { id: attempt.id },
    data: {
      status: "RUNNING",
      workerId: "homepage-tushare-baseline-bootstrap",
      fencingToken: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      startedAt: new Date(),
    },
  });
  const settlement = await service.settleAttempt({
    attemptId: attempt.id,
    fencingToken: 1,
    providerResultStatus: "success",
    requestedScopeJson: targetContextJson,
    coveredScopeJson: {
      market: "CN_A",
      tradeDate: actualTradeDate,
      conceptCount: heatmap.concepts.length,
    },
    missingScopeJson: {},
    actualDataCutoffKey: actualTradeDate,
    actualDataCutoffJson: { tradeDate: actualTradeDate },
    qualityStatus: "NORMAL",
  });
  await db.homepageDataManifestItemSettlementRevision.createMany({
    data: revisions.map((revision) => ({
      settlementId: settlement.id,
      observationRevisionId: revision.revisionId,
      ordinal: revision.ordinal,
    })),
    skipDuplicates: true,
  });

  const task = await enqueueHomePageTask(db, {
    scope: "BASELINE",
    manifestId: manifest.id,
    triggerReason: "BOOTSTRAP",
    publishImmediately: false,
  });
  if (!task) {
    throw new Error(`基线清单已创建但未能创建首页生成任务: ${manifest.id}`);
  }
  const published =
    task.status === "PENDING" || task.status === "RETRY_WAIT"
      ? await publishHomePageGenerationTask(task.id, redis)
      : null;
  if (published) {
    await db.homepageGenerationTask.update({
      where: { id: task.id },
      data: { eventPublishedAt: new Date(published.createdAt) },
    });
  }

  console.info(
    JSON.stringify(
      {
        manifestId: manifest.id,
        gateStatus: (
          await db.homepageDataManifest.findUniqueOrThrow({
            where: { id: manifest.id },
            select: { gateStatus: true },
          })
        ).gateStatus,
        generationTaskId: task.id,
        taskStatus: task.status,
        eventPublishedAt:
          published?.createdAt ?? task.eventPublishedAt?.toISOString() ?? null,
        targetTradeDate,
        actualTradeDate,
        heatmapConcepts: heatmap.concepts.length,
        observationRevisions: revisions.length,
      },
      null,
      2,
    ),
  );
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    redis.disconnect();
    await db.$disconnect();
  });

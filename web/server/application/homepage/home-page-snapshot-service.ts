import type { PrismaClient } from "@prisma/client";
import { homePagePayloadSchema } from "~/contracts/homepage";
import {
  HOMEPAGE_GENERATION_INPUT_CONTRACT_VERSION,
  HOMEPAGE_GENERATOR_DEFINITION_VERSION,
  HOMEPAGE_PAYLOAD_SCHEMA_VERSION,
} from "~/server/application/homepage/home-page-generation";
import { publishHomePageGenerationTask } from "~/server/application/homepage/home-page-task-stream";
import { readHomepageMarketBaseline } from "~/server/application/homepage/homepage-market-baseline-read-model";

type HomePageDb = PrismaClient;

type HomepageScope = "BASELINE" | "PERSONALIZED";

function normalizeScope(scope: HomepageScope | "DEFAULT"): HomepageScope {
  return scope === "DEFAULT" ? "BASELINE" : scope;
}

export async function enqueueHomePageTask(
  db: HomePageDb,
  input: {
    scope: HomepageScope | "DEFAULT";
    userId?: string;
    manifestId?: string;
    triggerReason: string;
    publishImmediately?: boolean;
  },
) {
  const scope = normalizeScope(input.scope);
  const manifest = input.manifestId
    ? await db.homepageDataManifest.findUnique({
        where: { id: input.manifestId },
      })
    : await db.homepageDataManifest.findFirst({
        where: {
          scope,
          userId: scope === "PERSONALIZED" ? input.userId : null,
          gateStatus: { in: ["READY", "READY_WITH_LIMITATION"] },
        },
        orderBy: { activationSequence: "desc" },
      });
  if (!manifest) return null;
  const generationKey = [
    "homepage",
    manifest.id,
    HOMEPAGE_GENERATION_INPUT_CONTRACT_VERSION,
    HOMEPAGE_GENERATOR_DEFINITION_VERSION,
    HOMEPAGE_PAYLOAD_SCHEMA_VERSION,
    "PROMOTABLE",
  ].join(":");
  const task = await db.homepageGenerationTask.upsert({
    where: { manifestId: manifest.id },
    create: {
      generationKey,
      manifestId: manifest.id,
      activationSequence: manifest.activationSequence,
      generationInputContractVersion:
        HOMEPAGE_GENERATION_INPUT_CONTRACT_VERSION,
      generatorDefinitionVersion: HOMEPAGE_GENERATOR_DEFINITION_VERSION,
      payloadSchemaVersion: HOMEPAGE_PAYLOAD_SCHEMA_VERSION,
      promotionMode: "PROMOTABLE",
      schedulingTier:
        input.triggerReason === "HOMEPAGE_MISS"
          ? "INTERACTIVE"
          : "TIME_CRITICAL",
      resourcePoolKey: "homepage-generation",
      fairnessKey:
        scope === "PERSONALIZED" ? `user:${input.userId}` : "baseline",
    },
    update: {},
  });
  const incompatibleFields = [
    task.manifestId !== manifest.id ? "manifestId" : null,
    task.activationSequence !== manifest.activationSequence
      ? "activationSequence"
      : null,
    task.generationInputContractVersion !==
    HOMEPAGE_GENERATION_INPUT_CONTRACT_VERSION
      ? "generationInputContractVersion"
      : null,
    task.generatorDefinitionVersion !== HOMEPAGE_GENERATOR_DEFINITION_VERSION
      ? "generatorDefinitionVersion"
      : null,
    task.payloadSchemaVersion !== HOMEPAGE_PAYLOAD_SCHEMA_VERSION
      ? "payloadSchemaVersion"
      : null,
    task.promotionMode !== "PROMOTABLE" ? "promotionMode" : null,
    task.resourcePoolKey !== "homepage-generation" ? "resourcePoolKey" : null,
  ].filter((field): field is string => field !== null);
  if (incompatibleFields.length > 0) {
    throw new Error(
      `首页生成任务与当前生产契约不兼容：${incompatibleFields.join(", ")}`,
    );
  }
  if (
    input.publishImmediately !== false &&
    (task.status === "PENDING" || task.status === "RETRY_WAIT") &&
    !task.eventPublishedAt
  ) {
    try {
      const published = await publishHomePageGenerationTask(task.id);
      await db.homepageGenerationTask.updateMany({
        where: { id: task.id, eventPublishedAt: null },
        data: { eventPublishedAt: new Date(published.createdAt) },
      });
    } catch {
      // scheduler 会扫描数据库并恢复未发布事件。
    }
  }
  return task;
}

export async function enqueuePersonalizedHomePage(
  db: HomePageDb,
  userId: string,
  triggerReason: string,
  publishImmediately = true,
) {
  const manifest = await db.homepageDataManifest.findFirst({
    where: {
      scope: "PERSONALIZED",
      userId,
      gateStatus: { in: ["READY", "READY_WITH_LIMITATION"] },
    },
    orderBy: { activationSequence: "desc" },
  });
  if (!manifest) return null;
  return enqueueHomePageTask(db, {
    scope: "PERSONALIZED",
    userId,
    manifestId: manifest.id,
    triggerReason,
    publishImmediately,
  });
}

async function findProjection(
  db: HomePageDb,
  where: { scope: HomepageScope; userId?: string | null },
) {
  return db.homepageCurrentSnapshotProjection.findFirst({
    where,
    orderBy: { activationSequence: "desc" },
    include: {
      snapshot: {
        include: {
          manifest: { select: { baseManifestId: true } },
        },
      },
    },
  });
}

export async function getHomePageSnapshot(db: HomePageDb, userId: string) {
  const [
    personalizedProjection,
    baselineProjection,
    activeTask,
    marketBaseline,
  ] = await Promise.all([
    findProjection(db, { scope: "PERSONALIZED", userId }),
    findProjection(db, { scope: "BASELINE", userId: null }),
    db.homepageGenerationTask.findFirst({
      where: {
        status: { in: ["PENDING", "RUNNING", "RETRY_WAIT"] },
        manifest: {
          OR: [{ scope: "PERSONALIZED", userId }, { scope: "BASELINE" }],
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    readHomepageMarketBaseline(db),
  ]);
  if (!baselineProjection) throw new Error("专业市场基线快照尚未就绪");

  const selected =
    personalizedProjection?.snapshot ?? baselineProjection.snapshot;
  const baselineOutdated =
    selected.scope === "PERSONALIZED" &&
    selected.manifest.baseManifestId !== baselineProjection.snapshot.manifestId;
  const payload = homePagePayloadSchema.parse(selected.payloadJson);
  return {
    snapshotId: selected.id,
    source: selected.scope as HomepageScope,
    manifestId: selected.manifestId,
    generatedAt: selected.generatedAt.toISOString(),
    dataCoverage: selected.dataCoverageJson,
    baselineOutdated,
    refreshInProgress: Boolean(activeTask),
    personalizationPending: !personalizedProjection && Boolean(activeTask),
    payload,
    marketBaseline,
  };
}

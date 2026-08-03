import type { PrismaClient } from "@prisma/client";
import {
  HOMEPAGE_COVERAGE_SCHEMA_VERSION,
  homePageDataCoverageSchema,
  versionedHomePagePayloadSchema,
  type HomePageDataCoverage,
  type VersionedHomePagePayload,
} from "~/contracts/homepage";
import {
  HOMEPAGE_GENERATION_INPUT_CONTRACT_VERSION,
  HOMEPAGE_GENERATOR_DEFINITION_VERSION,
  HOMEPAGE_PAYLOAD_SCHEMA_VERSION,
} from "~/server/application/homepage/home-page-generation";
import { publishHomePageGenerationTask } from "~/server/application/homepage/home-page-task-stream";

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
    targetTradeDate?: string;
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
    where: { generationKey },
    create: {
      generationKey,
      manifestId: manifest.id,
      activationSequence: manifest.activationSequence,
      generationInputContractVersion: HOMEPAGE_GENERATION_INPUT_CONTRACT_VERSION,
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

async function findActiveTask(
  db: HomePageDb,
  scope: HomepageScope,
  userId?: string,
) {
  return db.homepageGenerationTask.findFirst({
    where: {
      status: { in: ["PENDING", "RUNNING", "RETRY_WAIT"] },
      manifest: {
        scope,
        ...(scope === "PERSONALIZED" ? { userId } : {}),
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

function dataCoverageFromPayload(
  snapshot: { manifestId: string; inputHash: string; dataCoverageJson: unknown },
  payload: VersionedHomePagePayload,
): HomePageDataCoverage {
  const parsed = homePageDataCoverageSchema.safeParse(
    snapshot.dataCoverageJson,
  );
  if (parsed.success) return parsed.data;
  return homePageDataCoverageSchema.parse({
    schemaVersion: HOMEPAGE_COVERAGE_SCHEMA_VERSION,
    manifestId: snapshot.manifestId,
    inputHash: snapshot.inputHash,
    items: Object.values(payload.stages).flatMap((stage) =>
      Object.values(stage.domains).flatMap((domain) => domain.coverage.items),
    ),
  });
}

export async function getHomePageSnapshot(db: HomePageDb, userId: string) {
  const [
    personalizedProjection,
    baselineProjection,
    personalizedTask,
    baselineTask,
  ] = await Promise.all([
    findProjection(db, { scope: "PERSONALIZED", userId }),
    findProjection(db, { scope: "BASELINE", userId: null }),
    findActiveTask(db, "PERSONALIZED", userId),
    findActiveTask(db, "BASELINE"),
  ]);
  if (!baselineProjection) throw new Error("专业市场基线快照尚未就绪");

  const selected =
    personalizedProjection?.snapshot ?? baselineProjection.snapshot;
  const baselineOutdated =
    selected.scope === "PERSONALIZED" &&
    selected.manifest.baseManifestId !== baselineProjection.snapshot.manifestId;
  const payload = versionedHomePagePayloadSchema.parse(selected.payloadJson);
  const dataCoverage = dataCoverageFromPayload(selected, payload);

  return {
    snapshotId: selected.id,
    source: selected.scope as HomepageScope,
    manifestId: selected.manifestId,
    generatedAt: selected.generatedAt.toISOString(),
    dataCoverage,
    baselineOutdated,
    refreshInProgress: Boolean(personalizedTask || baselineTask),
    personalizationPending:
      !personalizedProjection && Boolean(personalizedTask),
    payload,
  };
}

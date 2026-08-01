import type { Prisma, PrismaClient } from "@prisma/client";
import { homePagePayloadSchema } from "~/contracts/homepage";
import { resolveHomePageSelection } from "~/server/application/homepage/home-page-selection";
import { publishHomePageGenerationTask } from "~/server/application/homepage/home-page-task-stream";

type HomePageDb = PrismaClient;

function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export async function enqueueHomePageTask(
  db: HomePageDb,
  input: {
    scope: "DEFAULT" | "PERSONALIZED";
    userId?: string;
    preferenceFingerprint?: string;
    baselineDefaultSnapshotId?: string;
    selection?: Prisma.InputJsonValue;
    triggerReason: string;
    targetTradeDate?: string;
    publishImmediately?: boolean;
  },
) {
  const targetTradeDate = input.targetTradeDate ?? shanghaiDate();
  const generationKey =
    input.scope === "DEFAULT"
      ? `default:${targetTradeDate}`
      : `personalized:${input.userId}:${input.preferenceFingerprint}:${input.baselineDefaultSnapshotId}`;
  const retryableFailureCodes = [
    "GENERATOR_TIMEOUT",
    "GENERATOR_CONNECTION_ERROR",
    "GENERATOR_HTTP_408",
    "GENERATOR_HTTP_429",
    "GENERATOR_HTTP_500",
    "GENERATOR_HTTP_502",
    "GENERATOR_HTTP_503",
    "GENERATOR_HTTP_504",
  ];
  await db.homePageGenerationTask.updateMany({
    where: {
      generationKey,
      status: "FAILED",
      errorCode: { in: retryableFailureCodes },
      completedAt: { lte: new Date(Date.now() - 30 * 60 * 1000) },
    },
    data: {
      status: "RETRY_WAIT",
      nextAttemptAt: new Date(),
      eventPublishedAt: null,
      completedAt: null,
    },
  });
  const task = await db.homePageGenerationTask.upsert({
    where: { generationKey },
    create: {
      generationKey,
      scope: input.scope,
      userId: input.userId,
      preferenceFingerprint: input.preferenceFingerprint,
      baselineDefaultSnapshotId: input.baselineDefaultSnapshotId,
      selectionJson: input.selection ?? {},
      triggerReason: input.triggerReason,
      targetTradeDate,
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
      await db.homePageGenerationTask.updateMany({
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
  const [selection, baseline] = await Promise.all([
    resolveHomePageSelection(db, userId),
    db.homePageSnapshot.findFirst({
      where: { scope: "DEFAULT" },
      orderBy: { generatedAt: "desc" },
      select: { id: true },
    }),
  ]);
  if (!selection.personalized || !baseline) return null;
  await db.homePageGenerationTask.updateMany({
    where: {
      userId,
      scope: "PERSONALIZED",
      status: { in: ["PENDING", "RETRY_WAIT"] },
      preferenceFingerprint: { not: selection.fingerprint },
    },
    data: { status: "CANCELLED", completedAt: new Date() },
  });
  return enqueueHomePageTask(db, {
    scope: "PERSONALIZED",
    userId,
    preferenceFingerprint: selection.fingerprint,
    baselineDefaultSnapshotId: baseline.id,
    selection: selection.selection,
    triggerReason,
    publishImmediately,
  });
}

export async function getHomePageSnapshot(db: HomePageDb, userId: string) {
  const [selection, defaultSnapshot] = await Promise.all([
    resolveHomePageSelection(db, userId),
    db.homePageSnapshot.findFirst({
      where: { scope: "DEFAULT" },
      orderBy: { generatedAt: "desc" },
    }),
  ]);
  if (!defaultSnapshot) throw new Error("默认首页快照尚未就绪");

  let selected = defaultSnapshot;
  let task = null;
  if (selection.personalized) {
    const personalized = await db.homePageSnapshot.findFirst({
      where: {
        scope: "PERSONALIZED",
        userId,
        preferenceFingerprint: selection.fingerprint,
      },
      orderBy: { generatedAt: "desc" },
    });
    if (personalized) selected = personalized;
    if (
      !personalized ||
      personalized.baselineDefaultSnapshotId !== defaultSnapshot.id
    ) {
      task = await enqueuePersonalizedHomePage(
        db,
        userId,
        "HOMEPAGE_MISS",
        false,
      );
    }
  }
  const activeTask =
    task ??
    (selection.personalized
      ? await db.homePageGenerationTask.findFirst({
          where: {
            userId,
            preferenceFingerprint: selection.fingerprint,
            status: { in: ["PENDING", "RUNNING", "RETRY_WAIT"] },
          },
          orderBy: { createdAt: "desc" },
        })
      : null);
  const payload = homePagePayloadSchema.parse(selected.payload);
  return {
    snapshotId: selected.id,
    source: selected.scope,
    generatedAt: selected.generatedAt.toISOString(),
    dataAsOf: selected.dataAsOf,
    isStale:
      selected.scope === "PERSONALIZED" &&
      selected.baselineDefaultSnapshotId !== defaultSnapshot.id,
    isRefreshing: Boolean(activeTask),
    personalizationPending:
      selection.personalized && selected.scope === "DEFAULT",
    payload,
  };
}

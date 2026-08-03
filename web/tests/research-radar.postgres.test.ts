import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { ResearchRadarService } from "~/server/application/research-radar/research-radar-service";
import { PrismaResearchRadarRepository } from "~/server/infrastructure/research-radar/prisma-research-radar-repository";

const databaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

function key(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describePostgres("个性化研究雷达 PostgreSQL 契约", () => {
  const db = new PrismaClient({
    datasources: {
      db: {
        url:
          databaseUrl ??
          "postgresql://unused:unused@127.0.0.1:1/unused",
      },
    },
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("先按用户命中选择全量事件，再应用容量且隔离其他用户", async () => {
    const firstUserId = key("radar-user-a");
    const secondUserId = key("radar-user-b");
    await db.user.createMany({
      data: [{ id: firstUserId }, { id: secondUserId }],
    });
    const firstSnapshot = await createSnapshot(db, firstUserId, "FOCUS");
    const secondSnapshot = await createSnapshot(db, secondUserId, "REGULAR");

    const highOne = await createEvent(db, 4, 4, "高排名事件一");
    const highTwo = await createEvent(db, 4, 3, "高排名事件二");
    await createEvent(db, 4, 2, "仅其他用户可见的高排名事件");
    const focusOutsideCapacity = await createEvent(db, 1, 1, "容量外关注事件");
    await createRelevance(db, {
      eventRevisionId: highOne.revisionId,
      userId: firstUserId,
      preferenceSnapshotId: firstSnapshot.id,
      relevance: 2,
      directFocusMatch: false,
      level: "REGULAR",
    });
    await createRelevance(db, {
      eventRevisionId: highTwo.revisionId,
      userId: firstUserId,
      preferenceSnapshotId: firstSnapshot.id,
      relevance: 2,
      directFocusMatch: false,
      level: "REGULAR",
    });
    await createRelevance(db, {
      eventRevisionId: focusOutsideCapacity.revisionId,
      userId: firstUserId,
      preferenceSnapshotId: firstSnapshot.id,
      relevance: 4,
      directFocusMatch: true,
      level: "FOCUS",
    });
    await createRelevance(db, {
      eventRevisionId: highOne.revisionId,
      userId: secondUserId,
      preferenceSnapshotId: secondSnapshot.id,
      relevance: 3,
      directFocusMatch: false,
      level: "REGULAR",
    });

    const service = new ResearchRadarService(
      new PrismaResearchRadarRepository(db),
      () => new Date("2026-08-03T03:00:00.000Z"),
    );
    const firstResult = await service.query(firstUserId, 1);
    const secondResult = await service.query(secondUserId, 20);

    expect(firstResult.items).toHaveLength(1);
    expect(firstResult.items[0]).toMatchObject({
      eventRevisionId: focusOutsideCapacity.revisionId,
      directFocusMatch: true,
      baselineRank: 4,
    });
    expect(secondResult.items.map((item) => item.eventRevisionId)).toEqual([
      highOne.revisionId,
    ]);
    expect(secondResult.items).not.toContainEqual(
      expect.objectContaining({
        eventRevisionId: focusOutsideCapacity.revisionId,
      }),
    );
  });
});

async function createSnapshot(
  db: PrismaClient,
  userId: string,
  level: "FOCUS" | "REGULAR",
) {
  return db.researchPreferenceSnapshot.create({
    data: {
      userId,
      contractVersion: "research-preference.v1",
      enabled: true,
      urgentAlertsEnabled: true,
      briefingsEnabled: true,
      externalCopiesEnabled: true,
      normalizedItemsJson: [
        { targetType: "COMPANY", targetKey: "300750.SZ", level },
      ],
      contentHash: `sha256:${randomUUID().replaceAll("-", "").repeat(2)}`,
      frozenAt: new Date("2026-08-03T02:30:00.000Z"),
    },
  });
}

async function createEvent(
  db: PrismaClient,
  importance: number,
  confidence: number,
  title: string,
) {
  const event = await db.researchEvent.create({
    data: {
      eventKey: key("radar-event-key"),
      canonicalizationVersion: "v1",
      subjectType: "COMPANY",
      subjectKey: "300750.SZ",
    },
  });
  const revision = await db.researchEventRevision.create({
    data: {
      eventId: event.id,
      revisionNo: 1,
      revisionDedupKey: key("radar-revision-key"),
      revisionKind: "CONFIRMED",
      title,
      summary: `${title}摘要`,
      narrativeJson: {},
      uncertaintyJson: {},
      counterEvidenceJson: {},
      occurredAt: new Date("2026-08-03T02:00:00.000Z"),
      knownAt: new Date("2026-08-03T02:01:00.000Z"),
    },
  });
  await db.researchEvent.update({
    where: { id: event.id },
    data: { currentRevisionId: revision.id },
  });
  await db.researchEventGlobalAssessment.create({
    data: {
      eventRevisionId: revision.id,
      inputHash: `sha256:${randomUUID().replaceAll("-", "").repeat(2)}`,
      contractVersion: "research-global-assessment.v1",
      model: "test",
      promptVersion: "v1",
      schemaVersion: "v1",
      importance,
      confidence,
      informationNovelty: importance,
      dimensionsJson: {},
      inputSnapshotJson: {},
      usageJson: {},
    },
  });
  return { eventId: event.id, revisionId: revision.id };
}

async function createRelevance(
  db: PrismaClient,
  input: {
    eventRevisionId: string;
    userId: string;
    preferenceSnapshotId: string;
    relevance: number;
    directFocusMatch: boolean;
    level: "FOCUS" | "REGULAR";
  },
) {
  await db.researchEventRelevanceAssessment.create({
    data: {
      eventRevisionId: input.eventRevisionId,
      userId: input.userId,
      preferenceSnapshotId: input.preferenceSnapshotId,
      inputHash: `sha256:${randomUUID().replaceAll("-", "").repeat(2)}`,
      contractVersion: "research-relevance-assessment.v1",
      model: "test",
      promptVersion: "v1",
      schemaVersion: "v1",
      relevance: input.relevance,
      directFocusMatch: input.directFocusMatch,
      matchedPreferencesJson: [
        {
          targetType: "COMPANY",
          targetKey: "300750.SZ",
          level: input.level,
          relation: input.directFocusMatch ? "DIRECT" : "WEAK",
        },
      ],
      dimensionJson: { reasons: [{ text: "测试偏好命中" }] },
      inputSnapshotJson: {},
      usageJson: {},
    },
  });
}

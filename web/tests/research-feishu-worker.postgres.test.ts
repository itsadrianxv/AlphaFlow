import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  FeishuDueCopyScheduler,
  FeishuDueCopyWorker,
} from "~/server/application/research-distribution/feishu-due-copy-worker";
import { PostgresResearchScheduler } from "~/server/application/scheduling/postgres-research-scheduler";
import type { FeishuDeliveryPort } from "~/server/application/research-distribution/research-distribution-service";

const databaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

function key(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describePostgres("Feishu due copy 正式 worker PostgreSQL 契约", () => {
  const db = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused" } },
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("due copy 幂等建任务，两个正式 worker 并发最多一次发送并结算 SENT", async () => {
    const poolId = key("feishu-pool");
    await db.researchResourcePool.create({
      data: { id: poolId, poolKey: key("feishu-pool-key"), resourceKind: "FEISHU", hardConcurrency: 2, currentConcurrency: 2 },
    });
    const userId = key("feishu-user");
    const entryId = key("feishu-entry");
    await db.user.create({ data: { id: userId } });
    const eventId = key("feishu-event");
    const revisionId = key("feishu-revision");
    await db.researchEvent.create({ data: { id: eventId, eventKey: key("event-key"), canonicalizationVersion: "v1", subjectType: "COMPANY", subjectKey: "300750.SZ" } });
    await db.researchEventRevision.create({
      data: { id: revisionId, eventId, revisionNo: 1, revisionDedupKey: key("revision-key"), revisionKind: "CONFIRMED", title: "事件", summary: "摘要", narrativeJson: {}, uncertaintyJson: {}, counterEvidenceJson: {}, occurredAt: new Date(), knownAt: new Date() },
    });
    const snapshot = await db.researchPreferenceSnapshot.create({
      data: {
        userId,
        contractVersion: "v1",
        enabled: true,
        urgentAlertsEnabled: true,
        briefingsEnabled: true,
        externalCopiesEnabled: true,
        contentHash: `sha256:${randomUUID().replaceAll("-", "").repeat(2)}`,
        frozenAt: new Date(),
      },
    });
    const global = await db.researchEventGlobalAssessment.create({
      data: {
        eventRevisionId: revisionId,
        inputHash: `sha256:${randomUUID().replaceAll("-", "").repeat(2)}`,
        contractVersion: "v1",
        model: "test",
        promptVersion: "v1",
        schemaVersion: "v1",
        dimensionsJson: {},
        inputSnapshotJson: {},
        usageJson: {},
      },
    });
    const relevance = await db.researchEventRelevanceAssessment.create({
      data: {
        eventRevisionId: revisionId,
        userId,
        preferenceSnapshotId: snapshot.id,
        inputHash: `sha256:${randomUUID().replaceAll("-", "").repeat(2)}`,
        contractVersion: "v1",
        model: "test",
        promptVersion: "v1",
        schemaVersion: "v1",
        matchedPreferencesJson: [],
        dimensionJson: {},
        usageJson: {},
      },
    });
    await db.researchInboxEntry.create({
      data: { id: entryId, distributionKey: key("distribution"), userId, eventRevisionId: revisionId, globalAssessmentId: global.id, relevanceAssessmentId: relevance.id, preferenceSnapshotId: snapshot.id, highestChannel: "URGENT_ALERT", entryKind: "EVENT", title: "事件", summary: "摘要", bodyJson: {}, createdAt: new Date(), updatedAt: new Date() },
    });
    const copy = await db.researchExternalCopy.create({
      data: { entryId, idempotencyKey: key("copy-key"), payloadJson: { idempotencyKey: key("payload-key"), title: "事件", reason: "门控", status: "已核实", inboxLink: "/research-inbox" }, retryDeadline: new Date(Date.now() + 60_000) },
    });
    const schedule = new FeishuDueCopyScheduler(db, new PostgresResearchScheduler(db));
    expect((await schedule.scheduleDueCopies({ poolId, limit: 10 })).accepted).toBe(1);
    expect((await schedule.scheduleDueCopies({ poolId, limit: 10 })).deduplicated).toBe(1);

    let sends = 0;
    const feishu: FeishuDeliveryPort = { send: async () => { sends += 1; } };
    const workerA = new FeishuDueCopyWorker(db, new PostgresResearchScheduler(db), { feishu, clock: () => new Date("2026-08-03T03:00:00.000Z") });
    const workerB = new FeishuDueCopyWorker(db, new PostgresResearchScheduler(db), { feishu, clock: () => new Date("2026-08-03T03:00:00.000Z") });
    await Promise.all([workerA.runOnce(poolId, "feishu-worker-a"), workerB.runOnce(poolId, "feishu-worker-b")]);
    expect(sends).toBe(1);
    await expect(db.researchExternalCopy.findUnique({ where: { id: copy.id } })).resolves.toMatchObject({ status: "SENT", sentAt: expect.any(Date) });
  });

  it("观测写入失败不影响权威结算", async () => {
    const poolId = key("feishu-observer-pool");
    await db.researchResourcePool.create({ data: { id: poolId, poolKey: key("feishu-observer-key"), resourceKind: "FEISHU", hardConcurrency: 1, currentConcurrency: 1 } });
    const userId = key("feishu-observer-user");
    await db.user.create({ data: { id: userId } });
    const entry = await db.researchInboxEntry.create({ data: { distributionKey: key("distribution"), userId, highestChannel: "URGENT_ALERT", entryKind: "EVENT", title: "事件", summary: "摘要", bodyJson: {} } });
    const copy = await db.researchExternalCopy.create({ data: { entryId: entry.id, idempotencyKey: key("copy"), payloadJson: { idempotencyKey: key("payload"), title: "事件", reason: "门控", status: "已核实", inboxLink: "/research-inbox" }, retryDeadline: new Date(Date.now() + 60_000) } });
    const scheduler = new PostgresResearchScheduler(db);
    await new FeishuDueCopyScheduler(db, scheduler).scheduleDueCopies({ poolId });
    const worker = new FeishuDueCopyWorker(db, scheduler, {
      feishu: { send: async () => undefined },
      observer: { record: async () => { throw new Error("观测不可用"); } },
    });

    await expect(worker.runOnce(poolId, "feishu-observer-worker")).resolves.toMatchObject({ copy: { status: "SENT" } });
    await expect(db.researchExternalCopy.findUniqueOrThrow({ where: { id: copy.id } })).resolves.toMatchObject({ status: "SENT" });
  });
});

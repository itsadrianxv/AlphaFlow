import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PrismaResearchDistributionStore } from "~/server/infrastructure/research-distribution/prisma-research-distribution-store";

const databaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

function key(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describePostgres("研究分发 PostgreSQL 副本契约", () => {
  const db = new PrismaClient({
    datasources: {
      db: {
        url:
          databaseUrl ??
          "postgresql://unused:unused@127.0.0.1:1/unused",
      },
    },
  });
  const entryIds: string[] = [];
  const userIds: string[] = [];

  afterAll(async () => {
    await db.$disconnect();
  });

  afterEach(async () => {
    for (const entryId of entryIds.splice(0)) {
      await db.$executeRawUnsafe(
        `DELETE FROM "ResearchExternalCopy" WHERE "entryId" = $1`,
        entryId,
      );
      await db.$executeRawUnsafe(
        `DELETE FROM "ResearchInboxEntryHistory" WHERE "entryId" = $1`,
        entryId,
      );
      await db.$executeRawUnsafe(
        `DELETE FROM "ResearchInboxEntry" WHERE "id" = $1`,
        entryId,
      );
    }
    for (const userId of userIds.splice(0)) {
      await db.$executeRawUnsafe(`DELETE FROM "User" WHERE "id" = $1`, userId);
    }
    await db.$executeRawUnsafe(
      `UPDATE "ResearchDeliveryCircuit"
          SET "state" = 'CLOSED', "consecutiveFailures" = 0,
              "openCount" = 0, "retryAfter" = NULL
        WHERE "channel" = 'FEISHU'`,
    );
  });

  it("并发建档保持幂等并持久化重试与熔断事实", async () => {
    const userId = key("distribution-user");
    const entryId = key("distribution-entry");
    const eventId = key("distribution-event");
    const eventRevisionId = key("distribution-revision");
    const idempotencyKey = `feishu:${entryId}`;
    userIds.push(userId);
    entryIds.push(entryId);
    await db.user.create({ data: { id: userId } });
    await db.researchEvent.create({
      data: {
        id: eventId,
        eventKey: key("event-key"),
        canonicalizationVersion: "v1",
        subjectType: "COMPANY",
        subjectKey: "000001.SZ",
      },
    });
    await db.researchEventRevision.create({
      data: {
        id: eventRevisionId,
        eventId,
        revisionNo: 1,
        revisionDedupKey: key("revision-dedup"),
        revisionKind: "CONFIRMED",
        title: "研究事件",
        summary: "摘要",
        narrativeJson: {},
        uncertaintyJson: {},
        counterEvidenceJson: {},
        occurredAt: new Date("2026-08-03T00:00:00.000Z"),
        knownAt: new Date("2026-08-03T00:00:00.000Z"),
      },
    });
    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchInboxEntry" (
         "id", "distributionKey", "userId", "eventRevisionId", "highestChannel", "entryKind",
         "title", "summary", "bodyJson", "createdAt", "updatedAt"
       ) VALUES ($1, $2, $3, $4, 'URGENT_ALERT', 'EVENT', '研究事件', '摘要', $5::jsonb, NOW(), NOW())`,
      entryId,
      key("gate"),
      userId,
      eventRevisionId,
      JSON.stringify({}),
    );
    const store = new PrismaResearchDistributionStore(db);
    const input = {
      entryId,
      now: new Date("2026-08-03T00:00:00.000Z"),
      payload: {
        idempotencyKey,
        title: "研究事件",
        reason: "满足紧急提醒的确定性门槛",
        status: "已核实",
        inboxLink: `/research/inbox/${entryId}`,
      },
    };

    const created = await Promise.all(
      Array.from({ length: 4 }, () => store.createCopy(input)),
    );
    expect(created.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(created.map((result) => result.copy.id)).size).toBe(1);

    const copy = created[0]!.copy;
    const retrying = await store.saveCopy({
      ...copy,
      status: "RETRY_WAIT",
      attempts: 1,
      firstAttemptAt: input.now.toISOString(),
      nextAttemptAt: "2026-08-03T00:01:00.000Z",
      lastErrorCode: "FEISHU_HTTP_503",
    });
    expect(await store.getCopyByKey(idempotencyKey)).toEqual(retrying);

    const circuit = await store.saveCircuit({
      state: "OPEN",
      consecutiveFailures: 5,
      openCount: 1,
      retryAfter: "2026-08-03T00:01:00.000Z",
    });
    await expect(store.getCircuit()).resolves.toEqual(circuit);
  });

  it("并发 worker 只有一个能领取副本，旧 fencing 不能覆盖成功状态", async () => {
    const userId = key("copy-claim-user");
    const entryId = key("copy-claim-entry");
    const eventId = key("copy-claim-event");
    const eventRevisionId = key("copy-claim-revision");
    userIds.push(userId);
    entryIds.push(entryId);
    await db.user.create({ data: { id: userId } });
    await db.researchEvent.create({
      data: {
        id: eventId,
        eventKey: key("copy-claim-event-key"),
        canonicalizationVersion: "v1",
        subjectType: "COMPANY",
        subjectKey: "000001.SZ",
      },
    });
    await db.researchEventRevision.create({
      data: {
        id: eventRevisionId,
        eventId,
        revisionNo: 1,
        revisionDedupKey: key("copy-claim-revision-dedup"),
        revisionKind: "CONFIRMED",
        title: "研究事件",
        summary: "摘要",
        narrativeJson: {},
        uncertaintyJson: {},
        counterEvidenceJson: {},
        occurredAt: new Date("2026-08-03T00:00:00.000Z"),
        knownAt: new Date("2026-08-03T00:00:00.000Z"),
      },
    });
    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchInboxEntry" (
         "id", "distributionKey", "userId", "eventRevisionId", "highestChannel", "entryKind",
         "title", "summary", "bodyJson", "createdAt", "updatedAt"
       ) VALUES ($1, $2, $3, $4, 'URGENT_ALERT', 'EVENT', '研究事件', '摘要', '{}'::jsonb, NOW(), NOW())`,
      entryId,
      key("copy-claim-gate"),
      userId,
      eventRevisionId,
    );
    const store = new PrismaResearchDistributionStore(db);
    const queued = await store.createCopy({
      entryId,
      now: new Date("2026-08-03T00:00:00.000Z"),
      payload: {
        idempotencyKey: `feishu:${entryId}`,
        title: "研究事件",
        reason: "确定性门控",
        status: "已核实",
        inboxLink: `/research-inbox?entry=${entryId}`,
      },
    });

    const claims = await Promise.all(
      Array.from({ length: 4 }, () =>
        store.claimCopy(
          queued.copy.id,
          new Date("2026-08-03T00:00:01.000Z"),
          60_000,
        ),
      ),
    );
    const claimed = claims.filter((claim) => claim !== null);
    expect(claimed).toHaveLength(1);
    const claim = claimed[0]!;
    const sent = await store.settleCopy({
      ...claim,
      status: "SENT",
      sentAt: "2026-08-03T00:00:02.000Z",
      lastErrorCode: null,
    });
    expect(sent.status).toBe("SENT");

    await expect(
      store.settleCopy({
        ...claim,
        status: "RETRY_WAIT",
        nextAttemptAt: "2026-08-03T00:01:00.000Z",
        lastErrorCode: "FEISHU_HTTP_503",
      }),
    ).rejects.toThrow();
    await expect(store.getCopy(claim.id)).resolves.toMatchObject({
      status: "SENT",
      sentAt: "2026-08-03T00:00:02.000Z",
    });
  });
});

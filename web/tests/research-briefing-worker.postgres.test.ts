import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  BriefingProductionScheduler,
  BriefingProductionWorker,
} from "~/server/application/research-distribution/briefing-production-worker";
import { PostgresResearchScheduler } from "~/server/application/scheduling/postgres-research-scheduler";

const databaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
function key(prefix: string) { return `${prefix}-${randomUUID()}`; }
function hashKey() { return `sha256:${randomUUID().replaceAll("-", "").repeat(2).slice(0, 64)}`; }

describePostgres("三时点简报 PostgreSQL production worker 契约", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused" } } });
  const poolIds: string[] = [];
  const userIds: string[] = [];
  afterAll(async () => db.$disconnect());

  it("按交易日和时点幂等冻结正文/证据/偏好，并先写站内简报 inbox", async () => {
    const poolId = key("briefing-pool"); poolIds.push(poolId);
    await db.researchResourcePool.create({ data: { id: poolId, poolKey: key("briefing-pool-key"), resourceKind: "BRIEFING", hardConcurrency: 2, currentConcurrency: 1 } });
    const userId = key("briefing-user"); userIds.push(userId);
    await db.user.create({ data: { id: userId } });
    await db.researchPreference.create({ data: { userId } });
    const eventId = key("briefing-event"); const revisionId = key("briefing-revision");
    await db.researchEvent.create({ data: { id: eventId, eventKey: key("briefing-event-key"), canonicalizationVersion: "v1", subjectType: "COMPANY", subjectKey: "300750.SZ" } });
    await db.researchEventRevision.create({ data: { id: revisionId, eventId, revisionNo: 1, revisionDedupKey: key("briefing-revision-key"), revisionKind: "CONFIRMED", title: "量产节点变化", summary: "摘要", narrativeJson: { impact: "影响", reasons: ["原因"], nextChecks: [], risks: [] }, uncertaintyJson: {}, counterEvidenceJson: {}, occurredAt: new Date("2026-08-03T00:00:00.000Z"), knownAt: new Date("2026-08-03T00:10:00.000Z") } });
    await db.researchEvent.update({ where: { id: eventId }, data: { currentRevisionId: revisionId } });
    const snapshot = await db.researchPreferenceSnapshot.create({ data: { userId, contractVersion: "v1", enabled: true, urgentAlertsEnabled: true, briefingsEnabled: true, externalCopiesEnabled: false, normalizedItemsJson: [], contentHash: hashKey(), frozenAt: new Date("2026-08-03T00:20:00.000Z") } });
    await db.researchEventGlobalAssessment.create({ data: { eventRevisionId: revisionId, inputHash: hashKey(), contractVersion: "v1", model: "test", promptVersion: "v1", schemaVersion: "v1", importance: 4, confidence: 4, informationNovelty: 4, dimensionsJson: {}, inputSnapshotJson: {}, usageJson: {} } });
    await db.researchEventRelevanceAssessment.create({ data: { eventRevisionId: revisionId, userId, preferenceSnapshotId: snapshot.id, inputHash: hashKey(), contractVersion: "v1", model: "test", promptVersion: "v1", schemaVersion: "v1", relevance: 4, directFocusMatch: false, matchedPreferencesJson: [], dimensionJson: {}, inputSnapshotJson: {}, usageJson: {} } });
    const scheduler = new BriefingProductionScheduler(db, new PostgresResearchScheduler(db));
    const scheduled = await scheduler.scheduleDueBriefings({ poolId, now: new Date("2026-08-03T00:50:00.000Z"), tradingDate: "2026-08-03", userIds: [userId] });
    expect(scheduled.accepted).toBe(1);
    const worker = new BriefingProductionWorker(db, new PostgresResearchScheduler(db), { clock: () => new Date("2026-08-03T00:50:00.000Z") });
    const result = await worker.runOnce(poolId, "briefing-worker-a");
    expect(result?.status).toBe("PUBLISHED");
    expect(await db.researchBriefingScope.count({ where: { userId, tradingDate: "2026-08-03", slot: "PRE_MARKET" } })).toBe(1);
    expect(await db.researchInboxEntry.count({ where: { userId, briefingTaskId: result?.taskId } })).toBe(1);
  });
});

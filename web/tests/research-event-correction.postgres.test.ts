import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { ResearchEventCorrectionService } from "~/server/application/research-production/research-event-correction";
import type {
  ResearchAssessmentLlmAdapter,
  ResearchAssessmentLlmRequest,
} from "~/server/application/research-assessment/research-assessment-service";
import { runResearchEventRevisionCommand } from "~/server/application/research-production/production";

const databaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
function key(prefix: string) { return `${prefix}-${randomUUID()}`; }
function hash() { return `sha256:${randomUUID().replaceAll("-", "").repeat(2).slice(0, 64)}`; }

const assessmentLlm: ResearchAssessmentLlmAdapter = {
  async complete(request: ResearchAssessmentLlmRequest) {
    const marker = "冻结输入：";
    const content = request.messages.at(-1)?.content ?? "";
    const snapshot = JSON.parse(content.slice(content.indexOf(marker) + marker.length)) as {
      eventRevision: { revisionId: string };
      preferenceSnapshot?: { items: unknown[] };
    };
    const ref = { refId: snapshot.eventRevision.revisionId, refType: "EVENT_REVISION" };
    const dimension = { score: 4, reasons: [{ text: "更正事实需要立即同步。", citations: [ref] }], uncertainty: "仅依据冻结输入。" };
    return {
      rawOutput: JSON.stringify(
        request.kind === "GLOBAL"
          ? { importance: dimension, confidence: dimension, informationNovelty: dimension }
          : { relevance: dimension, matchedPreferences: [] },
      ),
      usage: { credentialId: "contract", inputTokens: 1, outputTokens: 1 },
    };
  },
};

describePostgres("研究事件更正/撤回 PostgreSQL revision 契约", () => {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused" } } });
  afterAll(async () => db.$disconnect());

  it("并发更正只有一个成功，旧 expected revision 被拒绝且历史不变", async () => {
    const eventId = key("correction-event"); const oldRevisionId = key("old-revision");
    await db.researchEvent.create({ data: { id: eventId, eventKey: key("event-key"), canonicalizationVersion: "v1", subjectType: "COMPANY", subjectKey: "300750.SZ" } });
    await db.researchEventRevision.create({ data: { id: oldRevisionId, eventId, revisionNo: 1, revisionDedupKey: key("old-dedup"), revisionKind: "CONFIRMED", title: "旧事实", summary: "旧摘要", narrativeJson: {}, uncertaintyJson: {}, counterEvidenceJson: {}, occurredAt: new Date("2026-08-03T00:00:00.000Z"), knownAt: new Date("2026-08-03T00:01:00.000Z") } });
    await db.researchEvent.update({ where: { id: eventId }, data: { currentRevisionId: oldRevisionId } });
    const sourceAssertion = await db.sourceAssertion.create({ data: { id: key("source"), assertionKey: key("assertion"), canonicalizationVersion: "v1", sourceKey: "cninfo", datasetKey: "announcement", sourceRecordKey: key("record"), observationIdentityKey: key("identity"), rawRecordJson: { content: "更正" }, contentHash: hash(), requestParamsHash: hash(), providerVersion: "test", fetchedAt: new Date() } });
    const service = new ResearchEventCorrectionService(db);
    const input = { eventId, expectedRevisionId: oldRevisionId, commandId: key("correction-command"), revisionKind: "CORRECTED" as const, reason: "权威公告更正", title: "更正事实", summary: "更正摘要", narrative: { impact: "影响" }, uncertainty: {}, counterEvidence: {}, occurredAt: "2026-08-03T00:00:00.000Z", knownAt: "2026-08-03T00:10:00.000Z", claims: [{ claimType: "FACT", text: "更正后的事实", isInference: false, citations: [{ sourceAssertionId: sourceAssertion.id, relation: "SUPPORTS" as const, sourceIdentityStatus: "VERIFIED" as const, proofQualification: "QUALIFIED" as const, citation: { source: "公告" } }] }] };
    const results = await Promise.allSettled([service.execute(input), service.execute(input)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const current = await db.researchEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(current.currentRevisionId).not.toBe(oldRevisionId);
    expect(await db.researchEventRevision.count({ where: { eventId } })).toBe(2);
    await expect(service.execute({ ...input, commandId: key("stale-command") })).rejects.toThrow(/expected current revision/);
  });

  it("正式命令会重新评估并创建新的 inbox 与外部副本", async () => {
    const userId = key("correction-user");
    await db.user.create({ data: { id: userId } });
    await db.researchPreference.create({ data: { userId } });
    const eventId = key("correction-publish-event");
    const oldRevisionId = key("correction-publish-old");
    await db.researchEvent.create({ data: { id: eventId, eventKey: key("event-key"), canonicalizationVersion: "v1", subjectType: "COMPANY", subjectKey: "300750.SZ" } });
    await db.researchEventRevision.create({ data: { id: oldRevisionId, eventId, revisionNo: 1, revisionDedupKey: key("old-dedup"), revisionKind: "CONFIRMED", title: "旧事实", summary: "旧摘要", narrativeJson: {}, uncertaintyJson: {}, counterEvidenceJson: {}, occurredAt: new Date("2026-08-03T00:00:00.000Z"), knownAt: new Date("2026-08-03T00:01:00.000Z") } });
    await db.researchEvent.update({ where: { id: eventId }, data: { currentRevisionId: oldRevisionId } });
    const sourceAssertion = await db.sourceAssertion.create({ data: { assertionKey: key("assertion"), canonicalizationVersion: "v1", sourceKey: "cninfo", datasetKey: "announcement", sourceRecordKey: key("record"), observationIdentityKey: key("identity"), rawRecordJson: { content: "更正" }, contentHash: hash(), requestParamsHash: hash(), providerVersion: "test", fetchedAt: new Date() } });
    const input = { eventId, expectedRevisionId: oldRevisionId, commandId: key("publish-command"), revisionKind: "CORRECTED" as const, reason: "权威公告更正", title: "更正事实", summary: "更正摘要", narrative: { impact: "影响", reasons: ["公告更正"], nextChecks: ["继续跟踪"], risks: ["仍可能变化"] }, uncertainty: {}, counterEvidence: {}, occurredAt: "2026-08-03T00:00:00.000Z", knownAt: "2026-08-03T00:10:00.000Z", claims: [{ claimType: "FACT", text: "更正后的事实", isInference: false, citations: [{ sourceAssertionId: sourceAssertion.id, relation: "SUPPORTS" as const, sourceIdentityStatus: "VERIFIED" as const, proofQualification: "QUALIFIED" as const, citation: { source: "公告", evidenceKey: "correction-evidence" } }] }] };
    const result = await runResearchEventRevisionCommand(db, input, { assessmentLlm });
    expect(result.status).toBe("COMPLETED");
    expect(result.distributions).toContainEqual(
      expect.objectContaining({ userId }),
    );
    const entry = await db.researchInboxEntry.findFirstOrThrow({ where: { eventRevisionId: result.eventRevisionId! }, include: { externalCopy: true } });
    expect(entry.entryKind).toBe("CORRECTION");
    expect(entry.externalCopy).not.toBeNull();
  });
});

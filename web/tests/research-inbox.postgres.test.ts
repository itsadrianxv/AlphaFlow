import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { ResearchInboxService } from "~/server/application/research-inbox/research-inbox-service";
import type { CreateResearchInboxEntryInput } from "~/server/domain/research-inbox/types";
import { PrismaResearchInboxRepository } from "~/server/infrastructure/research-inbox/prisma-research-inbox-repository";

const contractDatabaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = contractDatabaseUrl ? describe : describe.skip;

function key(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describePostgres("研究收件箱 application/repository PostgreSQL 契约", () => {
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

  it("并发重复门控只写一条，阅读历史与反馈分别结算", async () => {
    const userId = key("inbox-user");
    const eventId = key("inbox-event");
    const eventRevisionId = key("inbox-revision");
    const distributionKey = key("distribution");
    await db.user.create({ data: { id: userId } });
    await db.researchEvent.create({
      data: {
        id: eventId,
        eventKey: key("event-key"),
        canonicalizationVersion: "v1",
        subjectType: "COMPANY",
        subjectKey: "300750.SZ",
      },
    });
    await db.researchEventRevision.create({
      data: {
        id: eventRevisionId,
        eventId,
        revisionNo: 1,
        revisionDedupKey: key("revision-dedup"),
        revisionKind: "CONFIRMED",
        title: "量产节点调整",
        summary: "量产节点由三季度调整至四季度。",
        narrativeJson: {},
        uncertaintyJson: {},
        counterEvidenceJson: {},
        occurredAt: new Date("2026-08-03T02:31:00.000Z"),
        knownAt: new Date("2026-08-03T02:42:00.000Z"),
      },
    });
    const service = new ResearchInboxService(
      new PrismaResearchInboxRepository(db),
      { clock: () => new Date("2026-08-03T02:42:00.000Z") },
    );
    const input: CreateResearchInboxEntryInput = {
      distributionKey,
      userId,
      eventRevisionId,
      highestChannel: "URGENT_ALERT",
      entryKind: "EVENT",
      title: "量产节点调整",
      summary: "量产节点由三季度调整至四季度。",
      body: {
        subject: { type: "COMPANY", key: "300750.SZ", label: "宁德时代" },
        eventStatus: "CONFIRMED",
        occurredAt: "2026-08-03T02:31:00.000Z",
        facts: ["公司公告调整量产节点。"],
        impact: "短期收入确认节奏可能延后。",
        reasons: ["客户验证周期延长。"],
        nextChecks: ["确认客户验证完成率。"],
        risks: ["尚未披露影响金额。"],
        assessments: {
          importance: { level: "高", reason: "影响兑现节奏。" },
          confidence: { level: "高", reason: "公司公告证明。" },
          relevance: { level: "极高", reason: "直接命中关注。" },
          informationNovelty: { level: "高", reason: "修正时间判断。" },
        },
        evidence: [
          {
            id: "evidence-1",
            source: "公司公告",
            excerpt: "调整至第四季度。",
            qualification: "可证明项目进度。",
          },
        ],
        revisions: [
          {
            id: eventRevisionId,
            kind: "CONFIRMED",
            label: "首次生成",
            summary: "记录量产节点调整。",
            createdAt: "2026-08-03T02:42:00.000Z",
          },
        ],
        aiDisclosure: "AI 生成研究解释，仅依据所列证据。",
        externalCopyStatus: "飞书副本待发送",
      },
    };

    const results = await Promise.all(
      Array.from({ length: 4 }, () => service.recordDistribution(input)),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.entry.id)).size).toBe(1);

    const entryId = results[0]!.entry.id;
    await service.open(userId, entryId, key("open"));
    await service.changeState(userId, {
      entryId,
      state: "UNREAD",
      commandId: key("restore-unread"),
    });
    await service.setFeedback(userId, {
      entryId,
      value: "USEFUL",
      commandId: key("feedback"),
    });
    const detail = await service.get(userId, entryId);
    expect(detail.state).toBe("UNREAD");
    expect(detail.feedback).toBe("USEFUL");
    expect(detail.history.map((item) => item.action)).toEqual([
      "DISTRIBUTED",
      "OPENED",
      "RESTORED_UNREAD",
    ]);
    expect(detail.body.evidence[0]?.id).toBe("evidence-1");

    await expect(
      db.researchInboxEntry.update({
        where: { id: entryId },
        data: { title: "不得覆盖" },
      }),
    ).rejects.toThrow(/immutable/);
  });
});

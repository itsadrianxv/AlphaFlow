import { describe, expect, it } from "vitest";
import { ResearchInboxService } from "~/server/application/research-inbox/research-inbox-service";
import { InMemoryResearchInboxRepository } from "~/server/domain/research-inbox/repository";
import type { CreateResearchInboxEntryInput } from "~/server/domain/research-inbox/types";

const now = new Date("2026-08-03T02:42:00.000Z");

function entryInput(
  overrides: Partial<CreateResearchInboxEntryInput> = {},
): CreateResearchInboxEntryInput {
  return {
    distributionKey: "gate:user-1:revision-2",
    userId: "user-1",
    eventRevisionId: "revision-2",
    globalAssessmentId: "global-2",
    relevanceAssessmentId: "relevance-2",
    preferenceSnapshotId: "preference-2",
    highestChannel: "URGENT_ALERT",
    entryKind: "CORRECTION",
    title: "更正：欧洲工厂量产节点调整",
    summary: "量产节点由三季度调整至四季度，短期收入确认节奏随之变化。",
    body: {
      subject: { type: "COMPANY", key: "300750.SZ", label: "宁德时代" },
      eventStatus: "CORRECTED",
      occurredAt: "2026-08-03T02:31:00.000Z",
      facts: ["公司公告将首批量产节点调整至四季度。"],
      impact: "短期收入确认可能延后，长期产能假设尚未改变。",
      reasons: ["客户验证周期较原计划更长。"],
      nextChecks: ["下一次经营交流确认客户验证完成率。"],
      risks: ["公告未披露对应收入金额。"],
      assessments: {
        importance: { level: "高", reason: "影响海外收入兑现节奏。" },
        confidence: { level: "高", reason: "由公司公告直接证明。" },
        relevance: { level: "极高", reason: "直接命中重点关注公司。" },
        informationNovelty: { level: "高", reason: "修正原量产时间判断。" },
      },
      evidence: [
        {
          id: "evidence-2",
          source: "宁德时代临时公告",
          excerpt: "首批量产时间预计调整至第四季度。",
          qualification: "有资格证明项目进度。",
        },
      ],
      revisions: [
        {
          id: "revision-2",
          kind: "CORRECTED",
          label: "事实更正",
          summary: "量产节点由三季度调整至四季度。",
          createdAt: "2026-08-03T02:42:00.000Z",
        },
        {
          id: "revision-1",
          kind: "CONFIRMED",
          label: "首次生成",
          summary: "原记录为三季度量产。",
          createdAt: "2026-08-02T02:42:00.000Z",
        },
      ],
      aiDisclosure: "AI 生成研究解释，仅依据所列证据。",
      externalCopyStatus: "飞书副本待发送",
    },
    ...overrides,
  };
}

describe("研究收件箱应用接口", () => {
  it("同一次门控只形成一条权威记录并保留全部引用", async () => {
    const service = new ResearchInboxService(
      new InMemoryResearchInboxRepository(),
      { clock: () => now },
    );

    const first = await service.recordDistribution(entryInput());
    const repeated = await service.recordDistribution(
      entryInput({ title: "不应覆盖既有权威内容" }),
    );

    expect(first.created).toBe(true);
    expect(repeated.created).toBe(false);
    expect(repeated.entry.id).toBe(first.entry.id);
    expect(repeated.entry.title).toBe("更正：欧洲工厂量产节点调整");
    expect(repeated.entry.highestChannel).toBe("URGENT_ALERT");
    expect(repeated.entry.references).toEqual({
      eventRevisionId: "revision-2",
      candidateId: null,
      briefingTaskId: null,
      globalAssessmentId: "global-2",
      relevanceAssessmentId: "relevance-2",
      preferenceSnapshotId: "preference-2",
    });
    expect(repeated.entry.body.evidence[0]?.id).toBe("evidence-2");
    expect(repeated.entry.body.revisions.map((revision) => revision.id)).toEqual([
      "revision-2",
      "revision-1",
    ]);
  });

  it("待处理、未读、稍后和归档保持独立筛选语义", async () => {
    const service = new ResearchInboxService(
      new InMemoryResearchInboxRepository(),
      { clock: () => now },
    );
    const unread = await service.recordDistribution(entryInput());
    const later = await service.recordDistribution(
      entryInput({ distributionKey: "gate:later", eventRevisionId: "revision-3" }),
    );
    const archived = await service.recordDistribution(
      entryInput({ distributionKey: "gate:archived", eventRevisionId: "revision-4" }),
    );
    const read = await service.recordDistribution(
      entryInput({ distributionKey: "gate:read", eventRevisionId: "revision-5" }),
    );
    await service.changeState("user-1", {
      entryId: later.entry.id,
      state: "LATER",
      commandId: "later-1",
    });
    await service.changeState("user-1", {
      entryId: archived.entry.id,
      state: "ARCHIVED",
      commandId: "archive-1",
    });
    await service.changeState("user-1", {
      entryId: read.entry.id,
      state: "READ",
      commandId: "read-1",
    });

    expect((await service.list("user-1", "PENDING")).items.map((item) => item.id)).toEqual([
      read.entry.id,
      later.entry.id,
      unread.entry.id,
    ]);
    expect((await service.list("user-1", "UNREAD")).items.map((item) => item.id)).toEqual([
      unread.entry.id,
    ]);
    expect((await service.list("user-1", "LATER")).items.map((item) => item.id)).toEqual([
      later.entry.id,
    ]);
    expect((await service.list("user-1", "ARCHIVED")).items.map((item) => item.id)).toEqual([
      archived.entry.id,
    ]);
  });

  it("打开、恢复未读、稍后和归档只改变阅读状态并保留历史", async () => {
    const service = new ResearchInboxService(
      new InMemoryResearchInboxRepository(),
      { clock: () => now },
    );
    const created = await service.recordDistribution(entryInput());

    const opened = await service.open("user-1", created.entry.id, "open-1");
    const restored = await service.changeState("user-1", {
      entryId: created.entry.id,
      state: "UNREAD",
      commandId: "unread-1",
    });
    await service.changeState("user-1", {
      entryId: created.entry.id,
      state: "LATER",
      commandId: "later-1",
    });
    const archived = await service.changeState("user-1", {
      entryId: created.entry.id,
      state: "ARCHIVED",
      commandId: "archive-1",
    });

    expect(opened.state).toBe("READ");
    expect(opened.openedAt).toBe(now.toISOString());
    expect(restored.state).toBe("UNREAD");
    expect(archived.state).toBe("ARCHIVED");
    expect(archived.history.map((item) => item.action)).toEqual([
      "DISTRIBUTED",
      "OPENED",
      "RESTORED_UNREAD",
      "SAVED_FOR_LATER",
      "ARCHIVED",
    ]);
  });

  it("有用与噪声反馈独立于阅读状态和评估引用", async () => {
    const service = new ResearchInboxService(
      new InMemoryResearchInboxRepository(),
      { clock: () => now },
    );
    const created = await service.recordDistribution(entryInput());

    const useful = await service.setFeedback("user-1", {
      entryId: created.entry.id,
      value: "USEFUL",
      commandId: "feedback-1",
    });
    const noise = await service.setFeedback("user-1", {
      entryId: created.entry.id,
      value: "NOISE",
      commandId: "feedback-2",
    });
    const detail = await service.get("user-1", created.entry.id);

    expect(useful.feedback).toBe("USEFUL");
    expect(noise.feedback).toBe("NOISE");
    expect(detail.state).toBe("UNREAD");
    expect(detail.references.globalAssessmentId).toBe("global-2");
    expect(detail.references.preferenceSnapshotId).toBe("preference-2");
  });
});

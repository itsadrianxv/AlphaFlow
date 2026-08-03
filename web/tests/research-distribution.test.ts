import { describe, expect, it } from "vitest";
import type { ResearchPreferenceSnapshot } from "~/contracts/research-preference";
import {
  briefingScheduleForTradingDay,
  FeishuDeliveryError,
  InMemoryResearchDistributionStore,
  ResearchDistributionService,
  type DistributionCandidate,
  type FeishuDeliveryPayload,
  type FeishuDeliveryPort,
  type ResearchDistributionStore,
} from "~/server/application/research-distribution/research-distribution-service";
import { InMemoryResearchInboxRepository } from "~/server/domain/research-inbox/repository";
import { ResearchInboxService } from "~/server/application/research-inbox/research-inbox-service";
import { LeaseLostError } from "~/server/domain/scheduling/types";

const now = new Date("2026-08-03T00:00:00.000Z");

function preference(
  overrides: Partial<ResearchPreferenceSnapshot> = {},
): ResearchPreferenceSnapshot {
  return {
    id: "snapshot-1",
    userId: "user-1",
    contractVersion: "1.0",
    enabled: true,
    urgentAlertsEnabled: true,
    briefingsEnabled: true,
    externalCopiesEnabled: true,
    items: [
      { targetType: "COMPANY", targetKey: "000001.SZ", level: "FOCUS" },
    ],
    contentHash:
      "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    frozenAt: now,
    personalDataDeletedAt: null,
    ...overrides,
  };
}

function candidate(
  overrides: Partial<DistributionCandidate> = {},
): DistributionCandidate {
  return {
    distributionKey: "gate:user-1:revision-1",
    userId: "user-1",
    subject: { kind: "EVENT_REVISION", id: "revision-1" },
    revisionKind: "EVENT",
    title: "公司公告重大订单",
    summary: "订单变化可能影响后续收入验证。",
    body: {
      subject: { type: "COMPANY", key: "000001.SZ", label: "示例公司" },
      eventStatus: "已核实",
      occurredAt: now.toISOString(),
      facts: ["公司公告新增重大订单。"],
      impact: "后续收入确认路径发生变化。",
      reasons: ["订单规模具有实质影响。"],
      nextChecks: ["跟踪收入确认。"],
      risks: ["履约进度仍需验证。"],
      assessments: {
        importance: { level: "高", reason: "影响重要。" },
        confidence: { level: "高", reason: "证据充分。" },
        relevance: { level: "高", reason: "直接命中重点关注。" },
        informationNovelty: { level: "高", reason: "存在实质增量。" },
      },
      evidence: [
        {
          id: "evidence-1",
          source: "公司公告",
          excerpt: "新增重大订单",
          qualification: "可证明核心事实",
        },
      ],
      revisions: [
        {
          id: "revision-1",
          kind: "EVENT",
          label: "首次核实",
          summary: "形成研究事件。",
          createdAt: now.toISOString(),
        },
      ],
      aiDisclosure: "由 AI 辅助整理，确定性规则完成分发。",
      externalCopyStatus: "飞书副本待发送",
    },
    scores: {
      importance: 3,
      confidence: 3,
      relevance: 3,
      informationNovelty: 3,
    },
    directPreferenceMatch: true,
    directFocusMatch: true,
    preferenceSnapshot: preference(),
    globalAssessmentId: "global-assessment-1",
    relevanceAssessmentId: "relevance-assessment-1",
    sourceIdentityVerified: true,
    coreFactEvidenceQualified: true,
    anomalyOnly: false,
    ...overrides,
  };
}

function service() {
  const inbox = new ResearchInboxService(new InMemoryResearchInboxRepository(), {
    clock: () => now,
  });
  return {
    inbox,
    distribution: new ResearchDistributionService(
      inbox,
      new InMemoryResearchDistributionStore(),
      { clock: () => now },
    ),
  };
}

class ScriptedFeishu implements FeishuDeliveryPort {
  readonly payloads: FeishuDeliveryPayload[] = [];

  constructor(
    private readonly outcomes: Array<"SUCCESS" | Error>,
    private readonly beforeSend?: () => Promise<void>,
  ) {}

  async send(payload: FeishuDeliveryPayload) {
    await this.beforeSend?.();
    this.payloads.push(payload);
    const outcome = this.outcomes.shift() ?? "SUCCESS";
    if (outcome instanceof Error) throw outcome;
  }
}

const directFeishuGuard = {
  run: (_copyId: string, operation: () => Promise<void>) => operation(),
};

describe("确定性分发 application seam", () => {
  it.each([
    {
      name: "有效事件即使存在无法判断维度也只进入站内",
      input: candidate({
        scores: {
          importance: null,
          confidence: 3,
          relevance: null,
          informationNovelty: 3,
        },
      }),
      channel: "IN_APP",
    },
    {
      name: "三项全局维度均达到 2 时进入简报",
      input: candidate({
        scores: {
          importance: 2,
          confidence: 2,
          relevance: null,
          informationNovelty: 2,
        },
      }),
      channel: "BRIEFING",
    },
    {
      name: "四维达到 3 且直接命中重点关注时进入紧急提醒",
      input: candidate(),
      channel: "URGENT_ALERT",
    },
    {
      name: "常规关注不能单独取得紧急提醒资格",
      input: candidate({ directFocusMatch: false }),
      channel: "BRIEFING",
    },
    {
      name: "层级弱传播不能单独取得紧急提醒资格",
      input: candidate({ directPreferenceMatch: false, directFocusMatch: false }),
      channel: "BRIEFING",
    },
    {
      name: "关闭紧急提醒后降到简报",
      input: candidate({
        preferenceSnapshot: preference({ urgentAlertsEnabled: false }),
      }),
      channel: "BRIEFING",
    },
    {
      name: "关闭个性化后重点关注不再取得紧急资格",
      input: candidate({
        preferenceSnapshot: preference({ enabled: false }),
      }),
      channel: "BRIEFING",
    },
    {
      name: "关闭简报后降到站内",
      input: candidate({
        scores: {
          importance: 2,
          confidence: 2,
          relevance: 4,
          informationNovelty: 2,
        },
        preferenceSnapshot: preference({ briefingsEnabled: false }),
      }),
      channel: "IN_APP",
    },
  ])("$name", async ({ input, channel }) => {
    const { distribution } = service();
    const result = await distribution.distribute(input);

    expect(result.decision.highestChannel).toBe(channel);
    expect(result.entry.highestChannel).toBe(channel);
  });

  it.each([
    { name: "允许满足全部资格的暂缓候选", input: candidate({ subject: { kind: "CANDIDATE", id: "candidate-1" }, revisionKind: "PENDING_VERIFICATION", scores: { importance: 3, confidence: 1, relevance: 3, informationNovelty: 3 } }), channel: "URGENT_ALERT" },
    { name: "阻断来源身份未核实的暂缓候选", input: candidate({ subject: { kind: "CANDIDATE", id: "candidate-1" }, revisionKind: "PENDING_VERIFICATION", scores: { importance: 3, confidence: 2, relevance: 3, informationNovelty: 3 }, sourceIdentityVerified: false }), channel: "IN_APP" },
    { name: "阻断没有合格核心事实证据的暂缓候选", input: candidate({ subject: { kind: "CANDIDATE", id: "candidate-1" }, revisionKind: "PENDING_VERIFICATION", scores: { importance: 4, confidence: 2, relevance: 4, informationNovelty: 4 }, coreFactEvidenceQualified: false }), channel: "IN_APP" },
    { name: "阻断仅由异常数据触发的暂缓候选", input: candidate({ subject: { kind: "CANDIDATE", id: "candidate-1" }, revisionKind: "PENDING_VERIFICATION", scores: { importance: 4, confidence: 2, relevance: 4, informationNovelty: 4 }, anomalyOnly: true }), channel: "IN_APP" },
  ])("$name", async ({ input, channel }) => {
    const { distribution } = service();
    const result = await distribution.distribute(input);

    expect(result.decision.highestChannel).toBe(channel);
    expect(result.entry.entryKind).toBe("CANDIDATE_PENDING_VERIFICATION");
    expect(result.entry.title).toContain("待核实");
  });

  it("相同门控身份只写入一条站内权威记录", async () => {
    const { distribution, inbox } = service();
    const first = await distribution.distribute(candidate());
    const replay = await distribution.distribute(candidate());

    expect(first.created).toBe(true);
    expect(replay.created).toBe(false);
    expect(replay.entry.id).toBe(first.entry.id);
    await expect(inbox.list("user-1", "PENDING")).resolves.toMatchObject({
      items: [{ id: first.entry.id }],
    });
  });

  it("暂缓候选必须引用候选主体，事件通知必须引用事件修订", async () => {
    const { distribution } = service();
    await expect(
      distribution.distribute(
        candidate({ revisionKind: "PENDING_VERIFICATION" }),
      ),
    ).rejects.toThrow("暂缓候选必须引用候选主体");
    await expect(
      distribution.distribute(
        candidate({ subject: { kind: "CANDIDATE", id: "candidate-1" } }),
      ),
    ).rejects.toThrow("事件通知必须引用事件修订");
  });
});

describe("定时简报 application seam", () => {
  it("按交易日北京时间固定生成盘前、收盘和晚间节奏", () => {
    expect(briefingScheduleForTradingDay("2026-08-03")).toEqual({
      PRE_MARKET: "2026-08-03T00:50:00.000Z",
      CLOSE: "2026-08-03T08:45:00.000Z",
      EVENING: "2026-08-03T14:50:00.000Z",
    });
  });

  it("容量只约束普通候选，必显更正和撤回不能被草稿删除", () => {
    const { distribution } = service();
    const scope = distribution.freezeBriefingScope({
      slot: "CLOSE",
      taskId: "briefing-task-1",
      userId: "user-1",
      capacity: 1,
      candidates: [
        { id: "event-low", revisionKind: "EVENT", importance: 2, confidence: 2, informationNovelty: 2 },
        { id: "event-high", revisionKind: "EVENT", importance: 4, confidence: 4, informationNovelty: 4 },
        { id: "correction-1", revisionKind: "CORRECTION", importance: null, confidence: null, informationNovelty: null },
        { id: "retraction-1", revisionKind: "RETRACTION", importance: null, confidence: null, informationNovelty: null },
      ],
    });

    expect(scope).toMatchObject({
      status: "READY",
      includedIds: ["correction-1", "retraction-1", "event-high"],
      mandatoryIds: ["correction-1", "retraction-1"],
    });
    expect(() =>
      distribution.validateBriefingDraft(scope, {
        includedIds: ["event-high"],
      }),
    ).toThrow("必显更正或撤回");
    expect(
      distribution.validateBriefingDraft(scope, {
        includedIds: ["correction-1", "retraction-1", "event-high"],
      }),
    ).toEqual(scope);
  });

  it("晚间没有实质信息增量时静默跳过，但必显修订仍生成简报", () => {
    const { distribution } = service();
    const skipped = distribution.freezeBriefingScope({
      slot: "EVENING",
      taskId: "briefing-task-empty",
      userId: "user-1",
      capacity: 10,
      candidates: [
        { id: "no-increment", revisionKind: "EVENT", importance: 4, confidence: 4, informationNovelty: 1 },
      ],
    });
    const correction = distribution.freezeBriefingScope({
      slot: "EVENING",
      taskId: "briefing-task-correction",
      userId: "user-1",
      capacity: 10,
      candidates: [
        { id: "correction-1", revisionKind: "CORRECTION", importance: null, confidence: null, informationNovelty: null },
      ],
    });

    expect(skipped).toMatchObject({ status: "SKIPPED_NO_INCREMENT", includedIds: [] });
    expect(correction).toMatchObject({ status: "READY", includedIds: ["correction-1"] });
  });

  it("冻结范围校验后写入一条简报权威记录，静默跳过不产生记录", async () => {
    const inbox = new ResearchInboxService(new InMemoryResearchInboxRepository(), {
      clock: () => now,
    });
    const feishu = new ScriptedFeishu(["SUCCESS"]);
    const distribution = new ResearchDistributionService(
      inbox,
      new InMemoryResearchDistributionStore(),
      { clock: () => now, feishu, feishuGuard: directFeishuGuard },
    );
    const ready = distribution.freezeBriefingScope({
      slot: "PRE_MARKET",
      taskId: "briefing-task-ready",
      userId: "user-1",
      capacity: 10,
      candidates: [
        { id: "event-1", revisionKind: "EVENT", importance: 3, confidence: 3, informationNovelty: 3 },
      ],
    });
    const skipped = distribution.freezeBriefingScope({
      slot: "EVENING",
      taskId: "briefing-task-skipped",
      userId: "user-1",
      capacity: 10,
      candidates: [],
    });

    const published = await distribution.publishBriefing({
      scope: ready,
      draft: {
        includedIds: ["event-1"],
        title: "盘前研究简报",
        summary: "隔夜事件与当日前瞻。",
        body: candidate().body,
      },
      preferenceSnapshot: preference(),
    });
    const silent = await distribution.publishBriefing({
      scope: skipped,
      draft: {
        includedIds: [],
        title: "晚间增量简报",
        summary: "无增量。",
        body: candidate().body,
      },
      preferenceSnapshot: preference(),
    });

    expect(published).toMatchObject({
      status: "PUBLISHED",
      entry: {
        entryKind: "BRIEFING",
        highestChannel: "BRIEFING",
        references: { briefingTaskId: "briefing-task-ready" },
      },
      externalCopy: { status: "SENT" },
    });
    expect(silent).toEqual({
      status: "SKIPPED_NO_INCREMENT",
      entry: null,
      externalCopy: null,
    });
    expect((await inbox.list("user-1", "PENDING")).items).toHaveLength(1);
  });

  it("关闭简报渠道后不写站内简报或 Feishu 副本", async () => {
    const inbox = new ResearchInboxService(new InMemoryResearchInboxRepository(), {
      clock: () => now,
    });
    const feishu = new ScriptedFeishu(["SUCCESS"]);
    const distribution = new ResearchDistributionService(
      inbox,
      new InMemoryResearchDistributionStore(),
      { clock: () => now, feishu, feishuGuard: directFeishuGuard },
    );
    const scope = distribution.freezeBriefingScope({
      slot: "CLOSE",
      taskId: "briefing-task-disabled",
      userId: "user-1",
      capacity: 1,
      candidates: [
        { id: "event-1", revisionKind: "EVENT", importance: 3, confidence: 3, informationNovelty: 3 },
      ],
    });

    const result = await distribution.publishBriefing({
      scope,
      draft: {
        includedIds: ["event-1"],
        title: "收盘简报",
        summary: "收盘结构。",
        body: candidate().body,
      },
      preferenceSnapshot: preference({ briefingsEnabled: false }),
    });

    expect(result).toEqual({
      status: "SKIPPED_CHANNEL_DISABLED",
      entry: null,
      externalCopy: null,
    });
    expect((await inbox.list("user-1", "PENDING")).items).toHaveLength(0);
    expect(feishu.payloads).toHaveLength(0);
  });
});

describe("Feishu 副本 application seam", () => {
  it("默认预授权启用时先写站内，再只发送必要字段", async () => {
    const inbox = new ResearchInboxService(new InMemoryResearchInboxRepository(), {
      clock: () => now,
    });
    const feishu = new ScriptedFeishu(["SUCCESS"], async () => {
      const authoritative = await inbox.list("user-1", "PENDING");
      expect(authoritative.items).toHaveLength(1);
    });
    const distribution = new ResearchDistributionService(
      inbox,
      new InMemoryResearchDistributionStore(),
      {
        clock: () => now,
        feishu,
        feishuGuard: directFeishuGuard,
        inboxLink: (entryId) => `/research/inbox/${entryId}`,
      },
    );

    const result = await distribution.distribute(candidate());

    expect(result.externalCopy).toMatchObject({ status: "SENT", attempts: 1 });
    expect(feishu.payloads).toEqual([
      {
        idempotencyKey: `feishu:${result.entry.id}`,
        title: "公司公告重大订单",
        reason: "满足紧急提醒的确定性门槛",
        status: "已核实",
        inboxLink: `/research/inbox/${result.entry.id}`,
      },
    ]);
  });

  it("用户关闭外部副本后不创建投递，重放也不重复发送", async () => {
    const inbox = new ResearchInboxService(new InMemoryResearchInboxRepository(), {
      clock: () => now,
    });
    const feishu = new ScriptedFeishu(["SUCCESS"]);
    const distribution = new ResearchDistributionService(
      inbox,
      new InMemoryResearchDistributionStore(),
      { clock: () => now, feishu, feishuGuard: directFeishuGuard },
    );
    const input = candidate({
      preferenceSnapshot: preference({ externalCopiesEnabled: false }),
    });

    const first = await distribution.distribute(input);
    const replay = await distribution.distribute(input);

    expect(first.externalCopy).toBeNull();
    expect(replay.externalCopy).toBeNull();
    expect(feishu.payloads).toHaveLength(0);
  });

  it("Feishu 失败与熔断不回滚站内记录，恢复后按原幂等键补发", async () => {
    let clock = new Date(now);
    const inbox = new ResearchInboxService(new InMemoryResearchInboxRepository(), {
      clock: () => clock,
    });
    const failure = () => new FeishuDeliveryError("FEISHU_HTTP_503", true);
    const feishu = new ScriptedFeishu([
      failure(),
      failure(),
      failure(),
      failure(),
      failure(),
      "SUCCESS",
    ]);
    const store = new InMemoryResearchDistributionStore();
    const distribution = new ResearchDistributionService(inbox, store, {
      clock: () => clock,
      feishu,
      feishuGuard: directFeishuGuard,
    });

    const failed = [];
    for (let index = 1; index <= 5; index += 1) {
      failed.push(
        await distribution.distribute(
          candidate({
            distributionKey: `gate:user-1:revision-${index}`,
            subject: { kind: "EVENT_REVISION", id: `revision-${index}` },
          }),
        ),
      );
    }
    const deferred = await distribution.distribute(
      candidate({
        distributionKey: "gate:user-1:revision-6",
        subject: { kind: "EVENT_REVISION", id: "revision-6" },
      }),
    );

    expect((await inbox.list("user-1", "PENDING")).items).toHaveLength(6);
    expect(failed.every((item) => item.externalCopy?.status === "RETRY_WAIT")).toBe(true);
    await expect(store.getCircuit()).resolves.toMatchObject({ state: "OPEN" });
    expect(deferred.externalCopy).toMatchObject({ status: "DEFERRED_CIRCUIT", attempts: 1 });
    expect(feishu.payloads).toHaveLength(5);

    clock = new Date(clock.getTime() + 60_000);
    const recovered = await distribution.retryFeishuCopy(
      failed[0]!.externalCopy!.id,
    );

    expect(recovered).toMatchObject({ status: "SENT", attempts: 2 });
    await expect(store.getCircuit()).resolves.toMatchObject({ state: "CLOSED", consecutiveFailures: 0 });
    expect(feishu.payloads[5]?.idempotencyKey).toBe(
      feishu.payloads[0]?.idempotencyKey,
    );
  });

  it("站内提交后副本建档中断，重放会补建并发送原幂等副本", async () => {
    const inbox = new ResearchInboxService(new InMemoryResearchInboxRepository(), {
      clock: () => now,
    });
    const delegate = new InMemoryResearchDistributionStore();
    let interrupted = true;
    const store: ResearchDistributionStore = {
      createCopy: async (input) => {
        if (interrupted) {
          interrupted = false;
          throw new Error("模拟站内提交后的进程中断");
        }
        return delegate.createCopy(input);
      },
      getCopy: (id) => delegate.getCopy(id),
      getCopyByKey: (key) => delegate.getCopyByKey(key),
      claimCopy: (id, claimedAt, leaseMs) =>
        delegate.claimCopy(id, claimedAt, leaseMs),
      settleCopy: (copy) => delegate.settleCopy(copy),
      saveCopy: (copy) => delegate.saveCopy(copy),
      getCircuit: () => delegate.getCircuit(),
      saveCircuit: (circuit) => delegate.saveCircuit(circuit),
    };
    const feishu = new ScriptedFeishu(["SUCCESS"]);
    const distribution = new ResearchDistributionService(inbox, store, {
      clock: () => now,
      feishu,
      feishuGuard: directFeishuGuard,
    });

    await expect(distribution.distribute(candidate())).rejects.toThrow(
      "模拟站内提交后的进程中断",
    );
    expect((await inbox.list("user-1", "PENDING")).items).toHaveLength(1);

    const recovered = await distribution.distribute(candidate());
    expect(recovered.created).toBe(false);
    expect(recovered.externalCopy).toMatchObject({ status: "SENT", attempts: 1 });
    expect(feishu.payloads).toHaveLength(1);
  });

  it("不可重试错误进入配置阻断且不累计技术熔断", async () => {
    const inbox = new ResearchInboxService(new InMemoryResearchInboxRepository(), {
      clock: () => now,
    });
    const store = new InMemoryResearchDistributionStore();
    const feishu = new ScriptedFeishu([
      new FeishuDeliveryError("FEISHU_BUSINESS_19001", false),
    ]);
    const distribution = new ResearchDistributionService(inbox, store, {
      clock: () => now,
      feishu,
      feishuGuard: directFeishuGuard,
    });

    const result = await distribution.distribute(candidate());

    expect(result.externalCopy).toMatchObject({
      status: "CONFIG_BLOCKED",
      attempts: 1,
    });
    await expect(store.getCircuit()).resolves.toMatchObject({
      state: "CLOSED",
      consecutiveFailures: 0,
    });
  });

  it("旧 fencing worker 不能结算 Feishu 副本状态", async () => {
    const inbox = new ResearchInboxService(new InMemoryResearchInboxRepository(), {
      clock: () => now,
    });
    const store = new InMemoryResearchDistributionStore();
    const distribution = new ResearchDistributionService(inbox, store, {
      clock: () => now,
      feishu: new ScriptedFeishu(["SUCCESS"]),
      feishuGuard: {
        run: async () => {
          throw new LeaseLostError();
        },
      },
    });

    await expect(distribution.distribute(candidate())).rejects.toBeInstanceOf(
      LeaseLostError,
    );
    const entry = (await inbox.list("user-1", "PENDING")).items[0]!;
    await expect(store.getCopyByKey(`feishu:${entry.id}`)).resolves.toMatchObject({
      status: "RETRY_WAIT",
      attempts: 1,
      lastErrorCode: "FEISHU_PERMIT_LEASE_LOST",
    });
  });
});

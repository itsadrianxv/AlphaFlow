import { describe, expect, it } from "vitest";
import { ResearchEventLifecycleService } from "~/server/domain/research-event";
import type {
  CandidateSeedInput,
  FactClaimInput,
} from "~/server/domain/research-event";

const fetchedAt = "2026-08-03T02:00:00.000Z";

function seed(overrides: Partial<CandidateSeedInput> = {}): CandidateSeedInput {
  return {
    seedKey: "seed:announcement:1",
    subjectType: "COMPANY",
    subjectKey: "600000.SH",
    eventIdentityKey: "company-announcement-board-change-2026-08-03",
    aggregationCertainty: "EXACT",
    materials: [
      {
        materialKey: "material:sse:notice:1",
        contentHash: "sha256:notice-content",
        kind: "ANNOUNCEMENT",
        sourceItemKey: "sse:notice:1",
        rawContent: { title: "董事长变更公告" },
        fetchedAt,
      },
    ],
    evidence: [
      {
        materialKey: "material:sse:notice:1",
        evidenceKind: "ANNOUNCEMENT",
        evidenceRole: "CORE_FACT",
        sourceIdentityStatus: "VERIFIED",
        proofQualification: "QUALIFIED",
        independenceKey: "sse-announcement-chain",
        citation: { quote: "公司公告董事长变更" },
      },
    ],
    ...overrides,
  };
}

function claim(candidateEvidenceId: string): FactClaimInput {
  return {
    claimType: "WHAT_HAPPENED",
    claimText: "公司公告董事长发生变更。",
    citations: [
      {
        candidateEvidenceId,
        relation: "SUPPORTS",
        sourceIdentityStatus: "VERIFIED",
        proofQualification: "QUALIFIED",
        citation: { quote: "董事长变更" },
      },
    ],
  };
}

describe("研究事件生命周期应用接口契约", () => {
  it("精确重复合并且候选簇保留原始证据，不确定聚合不强行合并", () => {
    const service = new ResearchEventLifecycleService();

    const first = service.backfillCandidate(seed());
    const duplicate = service.backfillCandidate(
      seed({
        seedKey: "seed:announcement:duplicate",
        materials: [
          {
            materialKey: "material:sse:notice:1",
            contentHash: "sha256:notice-content",
            kind: "ANNOUNCEMENT",
            sourceItemKey: "sse:notice:1",
            rawContent: { title: "同一公告转载" },
            fetchedAt,
          },
        ],
      }),
    );
    const uncertain = service.backfillCandidate(
      seed({
        seedKey: "seed:news:uncertain",
        eventIdentityKey: undefined,
        aggregationCertainty: "UNCERTAIN",
        materials: [
          {
            materialKey: "material:news:similar-but-not-same",
            contentHash: "sha256:news-content",
            kind: "NEWS",
            normalizedUrl: "https://example.test/news",
            rawContent: { title: "疑似同类人事变化" },
            fetchedAt,
          },
        ],
      }),
    );

    expect(duplicate.candidates[0]?.candidateKey).toBe(
      first.candidates[0]?.candidateKey,
    );
    expect(duplicate.duplicateMaterialKeys).toEqual(["material:sse:notice:1"]);
    expect(service.getStore().snapshot().materials).toHaveLength(2);
    expect(uncertain.candidates[0]?.candidateKey).not.toBe(
      first.candidates[0]?.candidateKey,
    );
    expect(first.candidates[0]?.subjectKey).toBe("600000.SH");
  });

  it("晋级幂等结算并要求每项事实主张关联合格证据", () => {
    const service = new ResearchEventLifecycleService();
    const candidate = service.backfillCandidate(seed()).candidates[0];
    const evidenceId = service.getStore().snapshot().evidence[0]?.id;
    if (!candidate || !evidenceId) throw new Error("测试夹具缺少候选证据");

    const first = service.adjudicateCandidate({
      candidateKey: candidate.candidateKey,
      inputHash: "sha256:adjudication-1",
      outcome: "PROMOTE",
      decidedAt: "2026-08-03T03:00:00.000Z",
      title: "浦发银行董事长变更",
      summary: "公司公告董事长发生变更，属于需要进入专业市场基线的治理变化。",
      occurredAt: "2026-08-03T01:00:00.000Z",
      claims: [claim(evidenceId)],
    });
    const again = service.adjudicateCandidate({
      candidateKey: candidate.candidateKey,
      inputHash: "sha256:adjudication-1",
      outcome: "PROMOTE",
      decidedAt: "2026-08-03T03:10:00.000Z",
      title: "不应创建第二个事件",
      summary: "重复输入哈希返回既有裁定。",
      occurredAt: "2026-08-03T01:00:00.000Z",
      claims: [claim(evidenceId)],
    });

    expect(again.decision.id).toBe(first.decision.id);
    expect(again.event?.eventKey).toBe(first.event?.eventKey);
    expect(service.getStore().snapshot().events).toHaveLength(1);
    expect(service.getStore().snapshot().revisions).toHaveLength(1);
  });

  it("同一事实采集链的佐证不能冒充独立交叉印证", () => {
    const service = new ResearchEventLifecycleService();
    const candidate = service.backfillCandidate(
      seed({
        materials: [
          {
            materialKey: "material:wire:1",
            contentHash: "sha256:wire-1",
            kind: "NEWS",
            normalizedUrl: "https://example.test/wire-1",
            rawContent: { title: "通讯社稿件" },
            fetchedAt,
          },
          {
            materialKey: "material:portal:copy",
            contentHash: "sha256:wire-copy",
            kind: "NEWS",
            normalizedUrl: "https://example.test/wire-copy",
            rawContent: { title: "门户转载通讯社稿件" },
            fetchedAt,
          },
        ],
        evidence: [
          {
            materialKey: "material:wire:1",
            evidenceKind: "NEWS",
            evidenceRole: "CORE_FACT",
            sourceIdentityStatus: "VERIFIED",
            proofQualification: "CORROBORATING_ONLY",
            independenceKey: "wire-upstream",
            citation: { quote: "通讯社称公司发生治理变化" },
          },
          {
            materialKey: "material:portal:copy",
            evidenceKind: "NEWS",
            evidenceRole: "CORE_FACT",
            sourceIdentityStatus: "VERIFIED",
            proofQualification: "CORROBORATING_ONLY",
            independenceKey: "wire-upstream",
            citation: { quote: "门户转载同一通讯社稿件" },
          },
        ],
      }),
    ).candidates[0];
    const evidenceIds = service.getStore().snapshot().evidence.map((item) => item.id);
    if (!candidate || evidenceIds.length < 2) throw new Error("测试夹具缺少候选证据");

    expect(() =>
      service.adjudicateCandidate({
        candidateKey: candidate.candidateKey,
        inputHash: "sha256:not-independent",
        outcome: "PROMOTE",
        decidedAt: "2026-08-03T03:00:00.000Z",
        title: "同源转载不得晋级",
        summary: "同一上游的两条材料不能满足交叉印证。",
        occurredAt: "2026-08-03T01:00:00.000Z",
        claims: [
          {
            claimType: "WHAT_HAPPENED",
            claimText: "公司发生治理变化。",
            citations: evidenceIds.map((candidateEvidenceId) => ({
              candidateEvidenceId,
              relation: "SUPPORTS",
              sourceIdentityStatus: "VERIFIED",
              proofQualification: "CORROBORATING_ONLY",
              citation: { quote: "同一上游" },
            })),
          },
        ],
      }),
    ).toThrow(/没有关联合格证据/);
  });

  it("异常数据不能独立晋级，技术失败只保留缺口和解除条件", () => {
    const service = new ResearchEventLifecycleService();
    const anomalyCandidate = service.backfillCandidate(
      seed({
        seedKey: "seed:data-anomaly",
        eventIdentityKey: "abnormal-volume-2026-08-03",
        materials: [
          {
            materialKey: "material:data:volume-spike",
            contentHash: "sha256:volume-spike",
            kind: "DATA_ANOMALY",
            sourceAssertionId: "source-assertion-volume",
            rawContent: { volumeRatio: 4.2 },
            fetchedAt,
          },
        ],
        evidence: [
          {
            materialKey: "material:data:volume-spike",
            evidenceKind: "DATA_ANOMALY",
            evidenceRole: "CORE_FACT",
            sourceIdentityStatus: "VERIFIED",
            proofQualification: "QUALIFIED",
            independenceKey: "market-data-chain",
            citation: { value: 4.2 },
          },
        ],
      }),
    ).candidates[0];
    const anomalyEvidenceId = service.getStore().snapshot().evidence[0]?.id;
    if (!anomalyCandidate || !anomalyEvidenceId) {
      throw new Error("测试夹具缺少异常数据候选");
    }

    expect(() =>
      service.adjudicateCandidate({
        candidateKey: anomalyCandidate.candidateKey,
        inputHash: "sha256:anomaly-promote",
        outcome: "PROMOTE",
        decidedAt: "2026-08-03T03:00:00.000Z",
        title: "异常放量",
        summary: "异常数据不能直接成为事件。",
        occurredAt: "2026-08-03T01:00:00.000Z",
        claims: [claim(anomalyEvidenceId)],
      }),
    ).toThrow(/异常数据不能独立晋级/);

    const hold = service.adjudicateCandidate({
      candidateKey: anomalyCandidate.candidateKey,
      inputHash: "sha256:technical-failure",
      outcome: "TECHNICAL_HOLD",
      decidedAt: "2026-08-03T03:30:00.000Z",
      evidenceGap: ["公告源抓取失败，缺少一手公告核验"],
      releaseConditions: ["公告源恢复后重新抓取并重裁定"],
    });

    expect(hold.event).toBeUndefined();
    expect(hold.candidate.status).toBe("TECHNICAL_HOLD");
    expect(hold.decision.evidenceGap).toEqual([
      "公告源抓取失败，缺少一手公告核验",
    ]);
    expect(service.getStore().snapshot().events).toHaveLength(0);
  });

  it("暂缓、重裁定、驳回和观察终结完整保留裁定历史", () => {
    const service = new ResearchEventLifecycleService();
    const candidate = service.backfillCandidate(seed()).candidates[0];
    if (!candidate) throw new Error("测试夹具缺少候选");

    const defer = service.adjudicateCandidate({
      candidateKey: candidate.candidateKey,
      inputHash: "sha256:defer-1",
      outcome: "DEFER",
      decidedAt: "2026-08-03T03:00:00.000Z",
      evidenceGap: ["缺少独立来源交叉印证"],
      releaseConditions: ["出现独立一手或合格二手证据"],
    });
    const reject = service.adjudicateCandidate({
      candidateKey: candidate.candidateKey,
      inputHash: "sha256:reject-2",
      outcome: "REJECT",
      decidedAt: "2026-08-04T03:00:00.000Z",
      evidenceGap: [],
      releaseConditions: [],
    });

    expect(defer.candidate.status).toBe("REJECTED");
    expect(reject.candidate.decisionIds).toHaveLength(2);
    expect(service.getStore().snapshot().decisions.map((item) => item.outcome)).toEqual([
      "DEFER",
      "REJECT",
    ]);

    const endedCandidate = service.backfillCandidate(
      seed({
        seedKey: "seed:ended",
        eventIdentityKey: "rumor-watch-window",
      }),
    ).candidates[0];
    if (!endedCandidate) throw new Error("测试夹具缺少观察候选");
    service.adjudicateCandidate({
      candidateKey: endedCandidate.candidateKey,
      inputHash: "sha256:defer-ended",
      outcome: "DEFER",
      decidedAt: "2026-08-03T03:00:00.000Z",
      evidenceGap: ["观察窗口内无实质证据增量"],
      releaseConditions: ["观察到新独立证据时回灌新候选"],
    });
    expect(
      service.endObservation(
        endedCandidate.candidateKey,
        "2026-08-10T03:00:00.000Z",
      ).status,
    ).toBe("DEFERRED_ENDED");
  });

  it("拆分、合并和候选回灌通过同一应用接口表达", () => {
    const service = new ResearchEventLifecycleService();
    const parent = service.backfillCandidate(
      seed({
        seedKey: "seed:mixed",
        eventIdentityKey: undefined,
        aggregationCertainty: "UNCERTAIN",
        materials: [
          {
            materialKey: "material:mixed:1",
            contentHash: "sha256:mixed-1",
            kind: "NEWS",
            normalizedUrl: "https://example.test/mixed",
            rawContent: { title: "同一新闻包含两个主体" },
            fetchedAt,
          },
        ],
      }),
    ).candidates[0];
    const other = service.backfillCandidate(
      seed({
        seedKey: "seed:duplicate-cluster",
        eventIdentityKey: undefined,
        aggregationCertainty: "UNCERTAIN",
        materials: [
          {
            materialKey: "material:mixed:2",
            contentHash: "sha256:mixed-2",
            kind: "NEWS",
            normalizedUrl: "https://example.test/mixed-copy",
            rawContent: { title: "同一事实的另一条候选" },
            fetchedAt,
          },
        ],
      }),
    ).candidates[0];
    if (!parent || !other) throw new Error("测试夹具缺少候选");

    const split = service.adjudicateCandidate({
      candidateKey: parent.candidateKey,
      inputHash: "sha256:split-merge",
      outcome: "DEFER",
      decidedAt: "2026-08-03T04:00:00.000Z",
      evidenceGap: ["拆分后的候选等待各自主体证据补全"],
      releaseConditions: ["分别补全主体一手证据"],
      splitInto: [
        {
          candidateKey: "candidate:split:600000",
          subjectType: "COMPANY",
          subjectKey: "600000.SH",
          eventIdentityKey: "split-600000",
          evidenceIds: parent.evidenceIds,
        },
        {
          candidateKey: "candidate:split:000001",
          subjectType: "COMPANY",
          subjectKey: "000001.SZ",
          eventIdentityKey: "split-000001",
          evidenceIds: parent.evidenceIds,
        },
      ],
      mergeCandidateKeys: [other.candidateKey],
    });
    const backfilled = service.backfillCandidate(
      seed({
        seedKey: "seed:followup",
        eventIdentityKey: "split-600000",
        aggregationCertainty: "EXACT",
        materials: [
          {
            materialKey: "material:followup:official",
            contentHash: "sha256:followup",
            kind: "ANNOUNCEMENT",
            sourceItemKey: "official-followup",
            rawContent: { title: "回灌补充公告" },
            fetchedAt,
          },
        ],
      }),
    );

    expect(split.splitCandidates.map((item) => item.candidateKey)).toEqual([
      "candidate:split:600000",
      "candidate:split:000001",
    ]);
    expect(split.mergedCandidateKeys).toEqual([other.candidateKey]);
    expect(service.getStore().candidates.get(other.candidateKey)?.status).toBe(
      "REJECTED",
    );
    expect(backfilled.candidates[0]?.candidateKey).not.toBe(parent.candidateKey);
  });

  it("更正、重新核实和撤回创建单调不可变修订链，旧产物读取提示当前状态", () => {
    const service = new ResearchEventLifecycleService();
    const candidate = service.backfillCandidate(seed()).candidates[0];
    const evidenceId = service.getStore().snapshot().evidence[0]?.id;
    if (!candidate || !evidenceId) throw new Error("测试夹具缺少候选证据");

    const promoted = service.adjudicateCandidate({
      candidateKey: candidate.candidateKey,
      inputHash: "sha256:promote-for-revision",
      outcome: "PROMOTE",
      decidedAt: "2026-08-03T03:00:00.000Z",
      title: "浦发银行董事长变更",
      summary: "原始摘要保留。",
      occurredAt: "2026-08-03T01:00:00.000Z",
      claims: [claim(evidenceId)],
    });
    if (!promoted.event || !promoted.revision) {
      throw new Error("晋级应创建事件与首个修订");
    }

    const corrected = service.reviseEvent({
      eventKey: promoted.event.eventKey,
      revisionDedupKey: "sha256:revision-corrected",
      revisionKind: "CORRECTED",
      title: "更正：浦发银行董事长变更",
      summary: "更正后的摘要。",
      narrative: { correction: "补充任职生效日期" },
      uncertainty: {},
      counterEvidence: {},
      occurredAt: "2026-08-03T01:00:00.000Z",
      knownAt: "2026-08-03T05:00:00.000Z",
      claims: [claim(evidenceId)],
    });
    const reverified = service.reviseEvent({
      eventKey: promoted.event.eventKey,
      revisionDedupKey: "sha256:revision-reverified",
      revisionKind: "REVERIFIED",
      title: "重新核实：浦发银行董事长变更",
      summary: "重新核实原事实仍成立。",
      narrative: { reverified: true },
      uncertainty: {},
      counterEvidence: {},
      occurredAt: "2026-08-03T01:00:00.000Z",
      knownAt: "2026-08-04T05:00:00.000Z",
      claims: [claim(evidenceId)],
    });
    const retracted = service.reviseEvent({
      eventKey: promoted.event.eventKey,
      revisionDedupKey: "sha256:revision-retracted",
      revisionKind: "RETRACTED",
      title: "撤回：浦发银行董事长变更",
      summary: "撤回该事件。",
      narrative: { retracted: true },
      uncertainty: {},
      counterEvidence: { reason: "公告被撤回" },
      occurredAt: "2026-08-03T01:00:00.000Z",
      knownAt: "2026-08-05T05:00:00.000Z",
      claims: [claim(evidenceId)],
    });

    expect([corrected.revisionNo, reverified.revisionNo, retracted.revisionNo]).toEqual([
      2,
      3,
      4,
    ]);
    expect(service.readRevision(promoted.revision.id)).toMatchObject({
      summary: "原始摘要保留。",
      isCurrent: false,
      eventStatus: "RETRACTED",
    });
    expect(service.readRevision(promoted.revision.id).statusNotice).toContain(
      "原内容保留用于审计",
    );
    expect(service.readRevision(retracted.id)).toMatchObject({
      isCurrent: true,
      eventStatus: "RETRACTED",
    });
  });
});

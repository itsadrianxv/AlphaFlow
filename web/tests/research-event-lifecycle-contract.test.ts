import { describe, expect, it } from "vitest";
import {
  InMemoryResearchEventLifecycleStore,
  ResearchEventLifecycleService,
} from "~/server/domain/research-event";
import type {
  AdjudicateCandidateInput,
  CandidateSeedInput,
  FactClaimInput,
  ResearchEventLifecycleSnapshot,
} from "~/server/domain/research-event";

const fetchedAt = "2026-08-03T02:00:00.000Z";
const decidedAt = "2026-08-03T03:00:00.000Z";

function createService() {
  const store = new InMemoryResearchEventLifecycleStore();
  const service = new ResearchEventLifecycleService(store, () => decidedAt);
  return { service, store };
}

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
        normalizedUrl: "https://sse.example/notice/1",
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

function claim(
  candidateEvidenceId: string,
  overrides: Partial<FactClaimInput> = {},
): FactClaimInput {
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
    ...overrides,
  };
}

function deferInput(
  candidateKey: string,
  inputHash: string,
  overrides: Partial<AdjudicateCandidateInput> = {},
): AdjudicateCandidateInput {
  return {
    candidateKey,
    inputHash,
    outcome: "DEFER",
    decidedAt,
    evidenceGap: ["缺少独立来源交叉印证"],
    releaseConditions: ["出现独立一手或合格二手证据"],
    observationWindowEndsAt: "2026-08-10T03:00:00.000Z",
    nextCheckAt: "2026-08-04T03:00:00.000Z",
    ...overrides,
  };
}

function snapshotCounts(snapshot: ResearchEventLifecycleSnapshot) {
  return {
    materials: snapshot.materials.length,
    conflicts: snapshot.materialConflicts.length,
    candidates: snapshot.candidates.length,
    evidence: snapshot.evidence.length,
    decisions: snapshot.decisions.length,
    relations: snapshot.candidateRelations.length,
    events: snapshot.events.length,
    revisions: snapshot.revisions.length,
  };
}

describe("研究事件生命周期应用接口契约", () => {
  it("内存 store 只能作为显式测试替身，快照与返回对象不能改写内部状态", () => {
    const { service, store } = createService();

    expect(() => new ResearchEventLifecycleService()).toThrow(
      /必须显式提供研究事件持久化 port/,
    );

    const result = service.backfillCandidate(seed());
    const returnedCandidate = result.candidates[0];
    const snapshot = store.snapshot();
    if (!returnedCandidate) throw new Error("测试夹具缺少候选");

    returnedCandidate.status = "REJECTED";
    snapshot.candidates[0]?.evidenceIds.push("forged-evidence");

    expect(store.snapshot().candidates[0]?.status).toBe("OPEN");
    expect(store.snapshot().candidates[0]?.evidenceIds).not.toContain(
      "forged-evidence",
    );
  });

  it("按 sourceItemKey、规范 URL 和内容哈希精确去重，并保留身份冲突与不同来源材料", () => {
    const { service, store } = createService();

    service.backfillCandidate(seed());
    const duplicate = service.backfillCandidate(
      seed({
        seedKey: "seed:duplicate",
        materials: [
          {
            materialKey: "material:another-key",
            contentHash: "sha256:notice-content",
            kind: "ANNOUNCEMENT",
            sourceItemKey: "sse:notice:1",
            normalizedUrl: "https://sse.example/notice/1",
            rawContent: { title: "同一公告的新抓取键" },
            fetchedAt,
          },
        ],
      }),
    );
    const conflict = service.backfillCandidate(
      seed({
        seedKey: "seed:conflict",
        materials: [
          {
            materialKey: "material:sse:notice:1",
            contentHash: "sha256:changed-content",
            kind: "ANNOUNCEMENT",
            sourceItemKey: "sse:notice:1",
            normalizedUrl: "https://sse.example/notice/1",
            rawContent: { title: "同一来源条目的不同正文" },
            fetchedAt,
          },
        ],
      }),
    );
    service.backfillCandidate(
      seed({
        seedKey: "seed:other-source",
        materials: [
          {
            materialKey: "material:other-source",
            contentHash: "sha256:notice-content",
            kind: "NEWS",
            sourceItemKey: "wire:notice:1",
            normalizedUrl: "https://wire.example/notice/1",
            rawContent: { title: "不同来源的相同正文" },
            fetchedAt,
          },
        ],
      }),
    );

    expect(duplicate.duplicateMaterialKeys).toEqual(["material:another-key"]);
    expect(conflict.materialConflicts).toHaveLength(1);
    expect(store.snapshot().materials).toHaveLength(3);
    expect(store.snapshot().materialConflicts[0]?.conflictFields).toEqual(
      expect.arrayContaining(["sourceItemKey", "contentHash", "materialKey"]),
    );
  });

  it("事实主张引用必须闭合到当前候选冻结证据，调用方不能伪造资格或跨候选引用", () => {
    const { service, store } = createService();
    const firstCandidate = service.backfillCandidate(seed()).candidates[0];
    const secondCandidate = service.backfillCandidate(
      seed({
        seedKey: "seed:other-candidate",
        eventIdentityKey: "other-event",
        subjectKey: "000001.SZ",
      }),
    ).candidates[0];
    const evidence = store.snapshot().evidence;
    const firstEvidence = evidence.find(
      (item) => item.candidateKey === firstCandidate?.candidateKey,
    );
    const secondEvidence = evidence.find(
      (item) => item.candidateKey === secondCandidate?.candidateKey,
    );
    if (!firstCandidate || !secondCandidate || !firstEvidence || !secondEvidence) {
      throw new Error("测试夹具缺少候选证据");
    }

    const before = snapshotCounts(store.snapshot());
    expect(() =>
      service.adjudicateCandidate({
        candidateKey: firstCandidate.candidateKey,
        inputHash: "sha256:forged-evidence",
        outcome: "PROMOTE",
        decidedAt,
        title: "伪造资格",
        summary: "不能凭调用方字段晋级。",
        occurredAt: "2026-08-03T01:00:00.000Z",
        claims: [
          claim("does-not-exist", {
            citations: [
              {
                candidateEvidenceId: "does-not-exist",
                relation: "SUPPORTS",
                sourceIdentityStatus: "VERIFIED",
                proofQualification: "QUALIFIED",
                citation: {},
              },
            ],
          }),
        ],
      }),
    ).toThrow(/引用.*不存在|闭合/);
    expect(() =>
      service.adjudicateCandidate({
        candidateKey: firstCandidate.candidateKey,
        inputHash: "sha256:cross-candidate-evidence",
        outcome: "PROMOTE",
        decidedAt,
        title: "跨候选引用",
        summary: "不能引用另一个候选的证据。",
        occurredAt: "2026-08-03T01:00:00.000Z",
        claims: [claim(secondEvidence.id)],
      }),
    ).toThrow(/不属于当前候选|闭合/);
    expect(() =>
      service.adjudicateCandidate({
        candidateKey: firstCandidate.candidateKey,
        inputHash: "sha256:forged-qualification",
        outcome: "PROMOTE",
        decidedAt,
        title: "伪造资格",
        summary: "存储中的资格不能被调用方升级。",
        occurredAt: "2026-08-03T01:00:00.000Z",
        claims: [
          claim(firstEvidence.id, {
            citations: [
              {
                candidateEvidenceId: firstEvidence.id,
                relation: "CONTRADICTS",
                sourceIdentityStatus: "VERIFIED",
                proofQualification: "QUALIFIED",
                citation: {},
              },
            ],
          }),
        ],
      }),
    ).toThrow(/合格证据|SUPPORTS/);

    expect(snapshotCounts(store.snapshot())).toEqual(before);
  });

  it("证据集合在每次裁定时冻结，暂缓后的新证据不改写旧裁定输入", () => {
    const { service, store } = createService();
    const candidate = service.backfillCandidate(seed()).candidates[0];
    if (!candidate) throw new Error("测试夹具缺少候选");

    const deferred = service.adjudicateCandidate(
      deferInput(candidate.candidateKey, "sha256:defer"),
    );
    const frozenDecision = store.snapshot().decisions[0];
    if (!frozenDecision) throw new Error("测试夹具缺少裁定");

    service.backfillCandidate(
      seed({
        seedKey: "seed:follow-up-evidence",
        materials: [
          {
            materialKey: "material:follow-up",
            contentHash: "sha256:follow-up",
            kind: "ANNOUNCEMENT",
            sourceItemKey: "sse:follow-up",
            rawContent: { title: "补充公告" },
            fetchedAt,
          },
        ],
        evidence: [
          {
            materialKey: "material:follow-up",
            evidenceKind: "ANNOUNCEMENT",
            evidenceRole: "CORE_FACT",
            sourceIdentityStatus: "VERIFIED",
            proofQualification: "QUALIFIED",
            independenceKey: "sse-follow-up-chain",
            citation: { quote: "补充公告" },
          },
        ],
      }),
    );

    const afterBackfill = store.snapshot();
    expect(deferred.candidate.status).toBe("DEFERRED");
    expect(frozenDecision.frozenEvidenceIds).toHaveLength(1);
    expect(frozenDecision.evidenceSetHash).toMatch(/^sha256:/);
    expect(afterBackfill.decisions[0]?.frozenEvidenceIds).toEqual(
      frozenDecision.frozenEvidenceIds,
    );
    expect(afterBackfill.decisions[0]?.evidenceSetHash).toBe(
      frozenDecision.evidenceSetHash,
    );
    expect(afterBackfill.candidates[0]?.evidenceIds.length).toBeGreaterThan(
      frozenDecision.frozenEvidenceIds.length,
    );
  });

  it("非法晋级在任何决策、拆分、合并或关系写入前失败", () => {
    const { service, store } = createService();
    const parent = service.backfillCandidate(
      seed({
        eventIdentityKey: undefined,
        aggregationCertainty: "UNCERTAIN",
      }),
    ).candidates[0];
    const mergeTarget = service.backfillCandidate(
      seed({
        seedKey: "seed:merge-target",
        eventIdentityKey: "merge-target",
      }),
    ).candidates[0];
    if (!parent || !mergeTarget) throw new Error("测试夹具缺少候选");
    const before = snapshotCounts(store.snapshot());

    expect(() =>
      service.adjudicateCandidate({
        candidateKey: parent.candidateKey,
        inputHash: "sha256:invalid-promotion-with-relations",
        outcome: "PROMOTE",
        decidedAt,
        title: "不完整晋级",
        summary: "缺少事实主张时不得产生关系副作用。",
        occurredAt: "2026-08-03T01:00:00.000Z",
        claims: [],
        splitInto: [
          {
            candidateKey: "candidate:split:invalid",
            subjectType: "COMPANY",
            subjectKey: "000002.SZ",
            eventIdentityKey: "split-invalid",
            evidenceIds: parent.evidenceIds,
          },
        ],
        mergeCandidateKeys: [mergeTarget.candidateKey],
      }),
    ).toThrow(/事实主张/);

    expect(snapshotCounts(store.snapshot())).toEqual(before);
    expect(store.snapshot().candidates).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ candidateKey: "candidate:split:invalid" }),
      ]),
    );
  });

  it("候选状态只按显式转移矩阵变化，驳回和晋级后不能再次裁定", () => {
    const first = createService();
    const firstCandidate = first.service.backfillCandidate(seed()).candidates[0];
    if (!firstCandidate) throw new Error("测试夹具缺少候选");

    const deferred = first.service.adjudicateCandidate(
      deferInput(firstCandidate.candidateKey, "sha256:defer-first"),
    );
    expect(deferred.candidate.status).toBe("DEFERRED");
    const rejected = first.service.adjudicateCandidate({
      candidateKey: firstCandidate.candidateKey,
      inputHash: "sha256:reject-after-defer",
      outcome: "REJECT",
      decidedAt: "2026-08-04T03:00:00.000Z",
    });
    expect(rejected.candidate.status).toBe("REJECTED");

    expect(() =>
      first.service.adjudicateCandidate({
        candidateKey: firstCandidate.candidateKey,
        inputHash: "sha256:promote-after-reject",
        outcome: "PROMOTE",
        decidedAt: "2026-08-05T03:00:00.000Z",
        title: "非法晋级",
        summary: "驳回候选不能重新晋级。",
        occurredAt: "2026-08-05T01:00:00.000Z",
        claims: [],
      }),
    ).toThrow(/状态转移|REJECTED/);

    const second = createService();
    const promotedCandidate = second.service.backfillCandidate(seed()).candidates[0];
    const evidenceId = second.store.snapshot().evidence[0]?.id;
    if (!promotedCandidate || !evidenceId) throw new Error("测试夹具缺少证据");
    const promoted = second.service.adjudicateCandidate({
      candidateKey: promotedCandidate.candidateKey,
      inputHash: "sha256:promote-terminal",
      outcome: "PROMOTE",
      decidedAt,
      title: "董事长变更",
      summary: "研究价值成立。",
      occurredAt: "2026-08-03T01:00:00.000Z",
      claims: [claim(evidenceId)],
      researchValue: {
        meaning: "治理结构变化需要纳入专业市场基线。",
        claimIndexes: [0],
        impactObjects: [
          {
            subjectType: "COMPANY",
            subjectKey: "600000.SH",
            impactType: "ATTENTION",
            materiality: "HIGH",
            claimIndexes: [0],
          },
        ],
      },
    });
    expect(promoted.candidate.status).toBe("PROMOTED");
    expect(() =>
      second.service.adjudicateCandidate({
        candidateKey: promotedCandidate.candidateKey,
        inputHash: "sha256:reject-after-promote",
        outcome: "REJECT",
        decidedAt: "2026-08-04T03:00:00.000Z",
      }),
    ).toThrow(/状态转移|PROMOTED/);
  });

  it("暂缓记录未来观察窗口与 nextCheck，技术暂挂使用有界重试预算", () => {
    const { service, store } = createService();
    const candidate = service.backfillCandidate(seed()).candidates[0];
    if (!candidate) throw new Error("测试夹具缺少候选");

    const deferred = service.adjudicateCandidate(
      deferInput(candidate.candidateKey, "sha256:future-check"),
    );
    expect(deferred.candidate.observationWindowEndsAt).toBe(
      "2026-08-10T03:00:00.000Z",
    );
    expect(deferred.candidate.nextCheckAt).toBe(
      "2026-08-04T03:00:00.000Z",
    );
    expect(
      new Date(deferred.candidate.nextCheckAt ?? 0).getTime(),
    ).toBeGreaterThan(new Date(decidedAt).getTime());

    const holdCandidate = service.backfillCandidate(
      seed({ seedKey: "seed:technical-hold", eventIdentityKey: "technical-hold" }),
    ).candidates[0];
    if (!holdCandidate) throw new Error("测试夹具缺少技术暂挂候选");
    const hold = service.adjudicateCandidate({
      candidateKey: holdCandidate.candidateKey,
      inputHash: "sha256:technical-hold",
      outcome: "TECHNICAL_HOLD",
      decidedAt,
      evidenceGap: ["Provider 暂时不可用"],
      releaseConditions: ["Provider 恢复后重试"],
      technicalRetry: {
        attempt: 1,
        maxAttempts: 3,
        nextRetryAt: "2026-08-03T03:10:00.000Z",
      },
    });
    expect(hold.candidate.status).toBe("TECHNICAL_HOLD");
    expect(hold.candidate.nextCheckAt).toBe("2026-08-03T03:10:00.000Z");
    expect(store.snapshot().events).toHaveLength(0);

    const exhaustedCandidate = service.backfillCandidate(
      seed({ seedKey: "seed:technical-exhausted", eventIdentityKey: "technical-exhausted" }),
    ).candidates[0];
    if (!exhaustedCandidate) throw new Error("测试夹具缺少重试候选");
    const before = snapshotCounts(store.snapshot());
    expect(() =>
      service.adjudicateCandidate({
        candidateKey: exhaustedCandidate.candidateKey,
        inputHash: "sha256:technical-exhausted",
        outcome: "TECHNICAL_HOLD",
        decidedAt,
        technicalRetry: {
          attempt: 4,
          maxAttempts: 3,
          nextRetryAt: "2026-08-03T03:10:00.000Z",
        },
      }),
    ).toThrow(/重试预算/);
    expect(snapshotCounts(store.snapshot())).toEqual(before);
  });

  it("事件身份只由稳定现实变化 identity 决定，不随标题、发生时间或修订文案变化", () => {
    const { service, store } = createService();
    const candidate = service.backfillCandidate(seed()).candidates[0];
    const evidenceId = store.snapshot().evidence[0]?.id;
    if (!candidate || !evidenceId) throw new Error("测试夹具缺少候选证据");

    const promoted = service.adjudicateCandidate({
      candidateKey: candidate.candidateKey,
      inputHash: "sha256:stable-event",
      outcome: "PROMOTE",
      decidedAt,
      title: "标题一",
      summary: "摘要一",
      occurredAt: "2026-08-03T01:00:00.000Z",
      claims: [claim(evidenceId)],
      researchValue: {
        meaning: "治理变化会影响后续研究。",
        claimIndexes: [0],
        impactObjects: [
          {
            subjectType: "COMPANY",
            subjectKey: "600000.SH",
            impactType: "ATTENTION",
            materiality: "MEDIUM",
            claimIndexes: [0],
          },
        ],
      },
    });
    if (!promoted.event || !promoted.revision) {
      throw new Error("晋级应创建事件与首个修订");
    }

    const corrected = service.reviseEvent({
      eventKey: promoted.event.eventKey,
      revisionDedupKey: "sha256:stable-correction",
      revisionKind: "CORRECTED",
      title: "标题二：更正",
      summary: "摘要二：更正后的发生时间。",
      narrative: {},
      uncertainty: {},
      counterEvidence: {},
      occurredAt: "2026-08-04T01:00:00.000Z",
      knownAt: "2026-08-04T05:00:00.000Z",
      claims: [claim(evidenceId)],
      researchValue: {
        meaning: "更正仍然解释同一现实变化。",
        claimIndexes: [0],
        impactObjects: [
          {
            subjectType: "COMPANY",
            subjectKey: "600000.SH",
            impactType: "ATTENTION",
            materiality: "MEDIUM",
            claimIndexes: [0],
          },
        ],
      },
    });

    expect(corrected.eventKey).toBe(promoted.event.eventKey);
    expect(store.snapshot().events).toHaveLength(1);
    expect(store.snapshot().candidates[0]?.eventIdentityKey).toBe(
      "company-announcement-board-change-2026-08-03",
    );
  });

  it("裁定幂等键按 candidate 作用域隔离，修订幂等键按 event 作用域隔离", () => {
    const { service, store } = createService();
    const firstCandidate = service.backfillCandidate(seed()).candidates[0];
    const secondCandidate = service.backfillCandidate(
      seed({
        seedKey: "seed:second-event",
        subjectKey: "000001.SZ",
        eventIdentityKey: "second-event",
      }),
    ).candidates[0];
    const evidence = store.snapshot().evidence;
    const firstEvidence = evidence.find(
      (item) => item.candidateKey === firstCandidate?.candidateKey,
    );
    const secondEvidence = evidence.find(
      (item) => item.candidateKey === secondCandidate?.candidateKey,
    );
    if (!firstCandidate || !secondCandidate || !firstEvidence || !secondEvidence) {
      throw new Error("测试夹具缺少候选");
    }

    const first = service.adjudicateCandidate({
      candidateKey: firstCandidate.candidateKey,
      inputHash: "sha256:same-input-hash",
      outcome: "PROMOTE",
      decidedAt,
      title: "事件一",
      summary: "摘要",
      occurredAt: "2026-08-03T01:00:00.000Z",
      claims: [claim(firstEvidence.id)],
      researchValue: {
        meaning: "事件一具有研究价值。",
        claimIndexes: [0],
        impactObjects: [
          {
            subjectType: "COMPANY",
            subjectKey: "600000.SH",
            impactType: "ATTENTION",
            materiality: "MEDIUM",
            claimIndexes: [0],
          },
        ],
      },
    });
    const second = service.adjudicateCandidate({
      candidateKey: secondCandidate.candidateKey,
      inputHash: "sha256:same-input-hash",
      outcome: "PROMOTE",
      decidedAt,
      title: "事件二",
      summary: "摘要",
      occurredAt: "2026-08-03T01:00:00.000Z",
      claims: [claim(secondEvidence.id)],
      researchValue: {
        meaning: "事件二具有研究价值。",
        claimIndexes: [0],
        impactObjects: [
          {
            subjectType: "COMPANY",
            subjectKey: "000001.SZ",
            impactType: "ATTENTION",
            materiality: "MEDIUM",
            claimIndexes: [0],
          },
        ],
      },
    });

    expect(first.decision.id).not.toBe(second.decision.id);
    expect(first.event?.eventKey).not.toBe(second.event?.eventKey);

    const firstRevision = service.reviseEvent({
      eventKey: first.event?.eventKey ?? "",
      revisionDedupKey: "same-revision-key",
      revisionKind: "CORRECTED",
      title: "事件一更正",
      summary: "更正一",
      narrative: {},
      uncertainty: {},
      counterEvidence: {},
      occurredAt: "2026-08-03T01:00:00.000Z",
      knownAt: "2026-08-04T01:00:00.000Z",
      claims: [claim(firstEvidence.id)],
      researchValue: {
        meaning: "更正一仍然属于事件一。",
        claimIndexes: [0],
        impactObjects: [
          {
            subjectType: "COMPANY",
            subjectKey: "600000.SH",
            impactType: "ATTENTION",
            materiality: "MEDIUM",
            claimIndexes: [0],
          },
        ],
      },
    });
    const secondRevision = service.reviseEvent({
      eventKey: second.event?.eventKey ?? "",
      revisionDedupKey: "same-revision-key",
      revisionKind: "CORRECTED",
      title: "事件二更正",
      summary: "更正二",
      narrative: {},
      uncertainty: {},
      counterEvidence: {},
      occurredAt: "2026-08-03T01:00:00.000Z",
      knownAt: "2026-08-04T01:00:00.000Z",
      claims: [claim(secondEvidence.id)],
      researchValue: {
        meaning: "更正二仍然属于事件二。",
        claimIndexes: [0],
        impactObjects: [
          {
            subjectType: "COMPANY",
            subjectKey: "000001.SZ",
            impactType: "ATTENTION",
            materiality: "MEDIUM",
            claimIndexes: [0],
          },
        ],
      },
    });

    expect(firstRevision.id).not.toBe(secondRevision.id);
  });

  it("撤回是事件修订链的终止状态，撤回后不能追加重新核实或更正", () => {
    const { service, store } = createService();
    const candidate = service.backfillCandidate(seed()).candidates[0];
    const evidenceId = store.snapshot().evidence[0]?.id;
    if (!candidate || !evidenceId) throw new Error("测试夹具缺少候选证据");
    const promoted = service.adjudicateCandidate({
      candidateKey: candidate.candidateKey,
      inputHash: "sha256:retractable",
      outcome: "PROMOTE",
      decidedAt,
      title: "可撤回事件",
      summary: "摘要",
      occurredAt: "2026-08-03T01:00:00.000Z",
      claims: [claim(evidenceId)],
      researchValue: {
        meaning: "该变化对研究有影响。",
        claimIndexes: [0],
        impactObjects: [
          {
            subjectType: "COMPANY",
            subjectKey: "600000.SH",
            impactType: "ATTENTION",
            materiality: "MEDIUM",
            claimIndexes: [0],
          },
        ],
      },
    });
    if (!promoted.event) throw new Error("测试夹具缺少事件");
    const retracted = service.reviseEvent({
      eventKey: promoted.event.eventKey,
      revisionDedupKey: "sha256:retracted",
      revisionKind: "RETRACTED",
      title: "撤回事件",
      summary: "原材料被撤回。",
      narrative: {},
      uncertainty: {},
      counterEvidence: { reason: "公告撤回" },
      occurredAt: "2026-08-03T01:00:00.000Z",
      knownAt: "2026-08-05T01:00:00.000Z",
      claims: [claim(evidenceId)],
      researchValue: {
        meaning: "撤回本身是需要记录的研究状态变化。",
        claimIndexes: [0],
        impactObjects: [
          {
            subjectType: "COMPANY",
            subjectKey: "600000.SH",
            impactType: "ATTENTION",
            materiality: "MEDIUM",
            claimIndexes: [0],
          },
        ],
      },
    });
    const before = snapshotCounts(store.snapshot());

    expect(() =>
      service.reviseEvent({
        eventKey: promoted.event?.eventKey ?? "",
        revisionDedupKey: "sha256:after-retract",
        revisionKind: "REVERIFIED",
        title: "不应重新核实",
        summary: "撤回后不能继续。",
        narrative: {},
        uncertainty: {},
        counterEvidence: {},
        occurredAt: "2026-08-03T01:00:00.000Z",
        knownAt: "2026-08-06T01:00:00.000Z",
        claims: [claim(evidenceId)],
        researchValue: {
          meaning: "非法修订。",
          claimIndexes: [0],
          impactObjects: [
            {
              subjectType: "COMPANY",
              subjectKey: "600000.SH",
              impactType: "ATTENTION",
              materiality: "MEDIUM",
              claimIndexes: [0],
            },
          ],
        },
      }),
    ).toThrow(/撤回|终止/);
    expect(snapshotCounts(store.snapshot())).toEqual(before);
    expect(service.readRevision(retracted.id)).toMatchObject({
      eventStatus: "RETRACTED",
      isCurrent: true,
    });
  });

  it("研究价值必须结构化并逐项引用事实主张，拆分/合并关系保留审计信息", () => {
    const { service, store } = createService();
    const candidate = service.backfillCandidate(
      seed({
        eventIdentityKey: undefined,
        aggregationCertainty: "UNCERTAIN",
      }),
    ).candidates[0];
    const mergeTarget = service.backfillCandidate(
      seed({
        seedKey: "seed:merge-target-2",
        eventIdentityKey: "merge-target-2",
        subjectKey: "600000.SH",
      }),
    ).candidates[0];
    const evidenceId = store.snapshot().evidence.find(
      (item) => item.candidateKey === candidate?.candidateKey,
    )?.id;
    if (!candidate || !mergeTarget || !evidenceId) {
      throw new Error("测试夹具缺少候选");
    }

    expect(() =>
      service.adjudicateCandidate({
        candidateKey: candidate.candidateKey,
        inputHash: "sha256:missing-research-value",
        outcome: "PROMOTE",
        decidedAt,
        title: "缺少研究价值",
        summary: "只有事实不能晋级。",
        occurredAt: "2026-08-03T01:00:00.000Z",
        claims: [claim(evidenceId)],
      }),
    ).toThrow(/研究价值|影响对象/);

    const split = service.adjudicateCandidate({
      candidateKey: candidate.candidateKey,
      inputHash: "sha256:split-merge-relations",
      outcome: "DEFER",
      decidedAt,
      evidenceGap: ["拆分后分别补全主体证据"],
      releaseConditions: ["出现各自主体的合格证据"],
      observationWindowEndsAt: "2026-08-10T03:00:00.000Z",
      nextCheckAt: "2026-08-04T03:00:00.000Z",
      splitInto: [
        {
          candidateKey: "candidate:split:600000",
          subjectType: "COMPANY",
          subjectKey: "600000.SH",
          eventIdentityKey: "split-600000",
          evidenceIds: [evidenceId],
        },
      ],
      mergeCandidateKeys: [mergeTarget.candidateKey],
    });

    expect(split.splitCandidates[0]).toMatchObject({
      candidateKey: "candidate:split:600000",
      parentCandidateKey: candidate.candidateKey,
    });
    expect(split.mergedCandidateKeys).toEqual([mergeTarget.candidateKey]);
    expect(store.snapshot().candidateRelations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationKind: "SPLIT_FROM",
          fromCandidateKey: candidate.candidateKey,
          toCandidateKey: "candidate:split:600000",
          evidenceIds: [evidenceId],
        }),
        expect.objectContaining({
          relationKind: "MERGED_INTO",
          fromCandidateKey: mergeTarget.candidateKey,
          toCandidateKey: candidate.candidateKey,
        }),
      ]),
    );
  });

  it("暂缓窗口结束前不能终结，终结后不能继续回灌或裁定", () => {
    const { service, store } = createService();
    const candidate = service.backfillCandidate(seed()).candidates[0];
    if (!candidate) throw new Error("测试夹具缺少候选");
    service.adjudicateCandidate(
      deferInput(candidate.candidateKey, "sha256:end-observation"),
    );

    expect(() =>
      service.endObservation(
        candidate.candidateKey,
        "2026-08-04T03:00:00.000Z",
      ),
    ).toThrow(/观察窗口/);

    const ended = service.endObservation(
      candidate.candidateKey,
      "2026-08-10T03:00:00.000Z",
    );
    expect(ended.status).toBe("DEFERRED_ENDED");
    const before = snapshotCounts(store.snapshot());
    expect(() =>
      service.adjudicateCandidate(
        deferInput(candidate.candidateKey, "sha256:after-ended"),
      ),
    ).toThrow(/状态转移|DEFERRED_ENDED/);
    expect(() =>
      service.backfillCandidate(
        seed({
          seedKey: "seed:after-ended",
          materials: [
            {
              materialKey: "material:after-ended",
              contentHash: "sha256:after-ended",
              kind: "NEWS",
              rawContent: {},
              fetchedAt,
            },
          ],
          evidence: [],
        }),
      ),
    ).toThrow(/终结|DEFERRED_ENDED/);
    expect(snapshotCounts(store.snapshot())).toEqual(before);
  });
});

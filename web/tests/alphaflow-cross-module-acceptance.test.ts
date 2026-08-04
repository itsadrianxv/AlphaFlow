import { describe, expect, it } from "vitest";
import {
  buildImmediateResearchCandidateSeeds,
  enforceResearchOnlyFinalText,
} from "../../agent_runtime/src/research-only-policy";
import type { ResearchPreferenceSnapshot } from "~/contracts/research-preference";
import {
  getBaselineItemsForPhase,
  MARKET_BASELINE_DOMAIN_IDS,
  MARKET_BASELINE_PHASES,
  PROFESSIONAL_MARKET_BASELINE,
} from "~/contracts/professional-market-baseline";
import {
  generateHomepageDraft,
  sha256Canonical,
  type HomepageGenerationInput,
} from "~/server/application/homepage/home-page-generation";
import { getHomePageSnapshot } from "~/server/application/homepage/home-page-snapshot-service";
import {
  type ResearchAssessmentLlmAdapter,
  type ResearchAssessmentLlmRequest,
  ResearchAssessmentService,
} from "~/server/application/research-assessment/research-assessment-service";
import {
  FeishuDeliveryError,
  InMemoryResearchDistributionStore,
  ResearchDistributionService,
  type DistributionCandidate,
  type FeishuDeliveryPayload,
} from "~/server/application/research-distribution/research-distribution-service";
import { ResearchInboxService } from "~/server/application/research-inbox/research-inbox-service";
import {
  InMemoryRuntimeObservabilityRepository,
  RuntimeObservabilityService,
} from "~/server/application/runtime-observability/runtime-observability-service";
import {
  ResearchScheduler,
  schedulingPolicy,
} from "~/server/application/scheduling/research-scheduler";
import { ResearchEventLifecycleService } from "~/server/domain/research-event";
import type { CandidateSeedInput } from "~/server/domain/research-event";
import { InMemoryResearchInboxRepository } from "~/server/domain/research-inbox/repository";

const NOW = new Date("2026-08-03T00:00:00.000Z");

function preference(
  overrides: Partial<ResearchPreferenceSnapshot> = {},
): ResearchPreferenceSnapshot {
  return {
    id: "preference-snapshot-1",
    userId: "user-1",
    contractVersion: "1.0",
    enabled: true,
    urgentAlertsEnabled: true,
    briefingsEnabled: true,
    externalCopiesEnabled: true,
    items: [{ targetType: "COMPANY", targetKey: "000001.SZ", level: "FOCUS" }],
    contentHash:
      "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    frozenAt: NOW,
    personalDataDeletedAt: null,
    ...overrides,
  };
}

function eventSeed(overrides: Partial<CandidateSeedInput> = {}): CandidateSeedInput {
  return {
    seedKey: "seed:company:announcement:1",
    subjectType: "COMPANY",
    subjectKey: "000001.SZ",
    eventIdentityKey: "company-order-2026-08-03",
    aggregationCertainty: "EXACT",
    materials: [
      {
        materialKey: "material:announcement:1",
        contentHash: "sha256:announcement-1",
        kind: "ANNOUNCEMENT",
        sourceItemKey: "announcement:1",
        rawContent: { title: "重大订单公告" },
        fetchedAt: NOW.toISOString(),
      },
    ],
    evidence: [
      {
        materialKey: "material:announcement:1",
        evidenceKind: "ANNOUNCEMENT",
        evidenceRole: "CORE_FACT",
        sourceIdentityStatus: "VERIFIED",
        proofQualification: "QUALIFIED",
        independenceKey: "company-announcement-chain",
        citation: { quote: "公司公告新增重大订单" },
      },
    ],
    ...overrides,
  };
}

function promoteCompanyEvent(service: ResearchEventLifecycleService) {
  const candidate = service.backfillCandidate(eventSeed()).candidates[0];
  const evidenceId = service.getStore().snapshot().evidence[0]?.id;
  if (!candidate || !evidenceId) throw new Error("跨 module 夹具缺少候选证据");
  return service.adjudicateCandidate({
    candidateKey: candidate.candidateKey,
    inputHash: "sha256:adjudication:company-order",
    outcome: "PROMOTE",
    decidedAt: "2026-08-03T01:00:00.000Z",
    title: "公司新增重大订单",
    summary: "订单变化可能影响后续收入验证。",
    occurredAt: "2026-08-03T00:30:00.000Z",
    claims: [
      {
        claimType: "WHAT_HAPPENED",
        claimText: "公司公告新增重大订单。",
        citations: [
          {
            candidateEvidenceId: evidenceId,
            relation: "SUPPORTS",
            sourceIdentityStatus: "VERIFIED",
            proofQualification: "QUALIFIED",
            citation: { quote: "新增重大订单" },
          },
        ],
      },
    ],
  });
}

function assessmentEvent(revisionId: string) {
  return {
    revisionId,
    eventKey: "event:company-order",
    title: "公司新增重大订单",
    summary: "订单变化可能影响后续收入验证。",
    claims: [{ id: "claim-1", text: "公司公告新增重大订单。", evidenceRefs: ["evidence-1"] }],
    evidence: [{ id: "evidence-1", summary: "公司公告原文。" }],
    impacts: [
      {
        id: "impact-1",
        subjectType: "COMPANY" as const,
        subjectKey: "000001.SZ",
        relation: "DIRECT" as const,
        materiality: "HIGH" as const,
      },
    ],
    cognitiveBaseline: [{ id: "baseline-1", summary: "此前只有订单意向。" }],
  };
}

function scoreDimension(refId: string, refType: string, score = 3) {
  return {
    score,
    reasons: [{ text: "冻结输入支持该判断。", citations: [{ refId, refType }] }],
    uncertainty: "仍需跟踪履约。",
  };
}

class ScriptedAssessment implements ResearchAssessmentLlmAdapter {
  readonly requests: ResearchAssessmentLlmRequest[] = [];

  constructor(private readonly outputs: Array<string | Error>) {}

  async complete(request: ResearchAssessmentLlmRequest) {
    this.requests.push(request);
    const output = this.outputs.shift();
    if (output instanceof Error) throw output;
    if (!output) throw new Error("脚本化 DeepSeek 没有剩余输出");
    return { rawOutput: output, usage: { credentialId: "deepseek:fixture" } };
  }
}

function globalOutput() {
  return JSON.stringify({
    importance: scoreDimension("claim-1", "FACT_CLAIM"),
    confidence: scoreDimension("evidence-1", "EVIDENCE"),
    informationNovelty: scoreDimension("baseline-1", "COGNITIVE_BASELINE"),
  });
}

function relevanceOutput() {
  return JSON.stringify({
    relevance: scoreDimension("preference:COMPANY:000001.SZ", "RESEARCH_PREFERENCE"),
    matchedPreferences: [
      {
        targetType: "COMPANY",
        targetKey: "000001.SZ",
        level: "FOCUS",
        relation: "DIRECT",
      },
    ],
  });
}

function inboxBody(revisionId: string, eventStatus = "已核实") {
  return {
    subject: { type: "COMPANY", key: "000001.SZ", label: "示例公司" },
    eventStatus,
    occurredAt: NOW.toISOString(),
    facts: ["公司公告新增重大订单。"],
    impact: "后续收入确认路径发生变化。",
    reasons: ["订单规模具有实质影响。"],
    nextChecks: ["跟踪履约进度。"],
    risks: ["收入确认仍有不确定性。"],
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
        id: revisionId,
        kind: "EVENT",
        label: eventStatus,
        summary: "研究事件发生变化。",
        createdAt: NOW.toISOString(),
      },
    ],
    aiDisclosure: "由 AI 辅助整理，确定性规则完成分发。",
    externalCopyStatus: "飞书副本待发送",
  };
}

function distributionCandidate(
  revisionId: string,
  snapshot: ResearchPreferenceSnapshot,
  overrides: Partial<DistributionCandidate> = {},
): DistributionCandidate {
  return {
    distributionKey: `gate:${snapshot.userId}:${revisionId}`,
    userId: snapshot.userId,
    subject: { kind: "EVENT_REVISION", id: revisionId },
    revisionKind: "EVENT",
    title: "公司新增重大订单",
    summary: "订单变化可能影响后续收入验证。",
    body: inboxBody(revisionId),
    scores: { importance: 3, confidence: 3, relevance: 3, informationNovelty: 3 },
    directPreferenceMatch: true,
    directFocusMatch: true,
    preferenceSnapshot: snapshot,
    globalAssessmentId: "global-assessment-fixture",
    relevanceAssessmentId: "relevance-assessment-fixture",
    sourceIdentityVerified: true,
    coreFactEvidenceQualified: true,
    anomalyOnly: false,
    ...overrides,
  };
}

function homepageInput(gateStatus: "READY" | "READY_WITH_LIMITATION") {
  const settlementStatus = gateStatus === "READY" ? "READY" : "DEGRADED";
  const base = {
    contractVersion: "1.0",
    task: {
      id: `task:${gateStatus}`,
      manifestId: `manifest:${gateStatus}`,
      activationSequence: gateStatus === "READY" ? "1" : "2",
      promotionMode: "PROMOTABLE" as const,
      generationInputContractVersion: "1.0",
      generatorDefinitionVersion: "1.0",
      payloadSchemaVersion: "1.0",
    },
    manifest: {
      id: `manifest:${gateStatus}`,
      manifestKey: `baseline:${gateStatus}`,
      canonicalizationVersion: "jcs-1",
      scope: "BASELINE" as const,
      definitionVersion: "definition-v1",
      targetContextKey: "trade-date:20260803",
      targetContextJson: { phase: gateStatus === "READY" ? "PRE_MARKET" : "POST_MARKET" },
      activationSequence: gateStatus === "READY" ? "1" : "2",
      userId: null,
      baseManifestId: null,
      frozenPreferenceContractVersion: null,
      frozenPreferenceJson: null,
      gateStatus,
    },
    baseManifest: null,
    items: [
      {
        id: "item:market-structure",
        itemKey: "market-structure",
        sourceManifestId: `manifest:${gateStatus}`,
        canonicalizationVersion: "jcs-1",
        datasetKey: "market_structure",
        factScopeKey: "cn-a",
        factScopeJson: { market: "CN_A" },
        requirementVersion: "1.0",
        required: true,
        emptyPolicy: "DISALLOW_EMPTY",
        targetDataCutoffKey: "20260803",
        targetDataCutoffJson: { tradeDate: "20260803" },
        settlement: {
          id: "settlement:market-structure",
          settlementStatus: "READY",
          providerResultStatus: "success",
          requestedScopeJson: { market: "CN_A" },
          coveredScopeJson: { market: "CN_A" },
          missingScopeJson: {},
          targetDataCutoffKey: "20260803",
          targetDataCutoffJson: { tradeDate: "20260803" },
          actualDataCutoffKey: "20260803",
          actualDataCutoffJson: { tradeDate: "20260803" },
          qualityStatus: "normal",
          qualityFlags: [],
          limitations: [],
          errorClass: null,
          retryability: null,
          revisions: [],
        },
      },
      {
        id: "item:money-flow",
        itemKey: "money-flow",
        sourceManifestId: `manifest:${gateStatus}`,
        canonicalizationVersion: "jcs-1",
        datasetKey: "money_flow",
        factScopeKey: "cn-a-flow",
        factScopeJson: { market: "CN_A" },
        requirementVersion: "1.0",
        required: false,
        emptyPolicy: "ALLOW_EMPTY",
        targetDataCutoffKey: "20260803",
        targetDataCutoffJson: { tradeDate: "20260803" },
        settlement: {
          id: "settlement:money-flow",
          settlementStatus,
          providerResultStatus: settlementStatus === "READY" ? "success" : "degraded",
          requestedScopeJson: { market: "CN_A" },
          coveredScopeJson: settlementStatus === "READY" ? { market: "CN_A" } : {},
          missingScopeJson: settlementStatus === "READY" ? {} : { dataset: ["northbound_flow"] },
          targetDataCutoffKey: "20260803",
          targetDataCutoffJson: { tradeDate: "20260803" },
          actualDataCutoffKey: "20260803",
          actualDataCutoffJson: { tradeDate: "20260803" },
          qualityStatus: settlementStatus === "READY" ? "normal" : "degraded",
          qualityFlags: settlementStatus === "READY" ? [] : ["OPTIONAL_DATA_LIMITED"],
          limitations: settlementStatus === "READY" ? [] : ["可选资金流降级"],
          errorClass: null,
          retryability: null,
          revisions: [],
        },
      },
    ],
  };
  return { ...base, inputHash: sha256Canonical(base) } as HomepageGenerationInput;
}

function marketBaselineSnapshots() {
  const domains = ["market", "flow", "company", "news", "expectation", "calendar"];
  return ["PRE_MARKET", "INTRADAY", "POST_MARKET", "FORWARD"].map(
    (phase, phaseIndex) => ({
      id: `market-snapshot-${phase}`,
      manifestId: `market-manifest-${phase}`,
      activationSequence: BigInt(phaseIndex + 1),
      generatedAt: NOW,
      manifest: {
        targetContextKey: `2026-08-03:${phase}`,
        targetContextJson: { phase, targetTradeDate: "2026-08-03" },
        gateStatus: "READY",
        items: domains.map((domain) => ({
          datasetKey: `fixture.${domain}`,
          required: domain === "market",
          factScopeJson: { baselineDomain: domain },
          settlement: {
            targetDataCutoffKey: "trade_date",
            targetDataCutoffJson: { key: "trade_date", value: "2026-08-03" },
            actualDataCutoffKey: "trade_date",
            actualDataCutoffJson: { key: "trade_date", value: "2026-08-03" },
            settlementStatus: "EMPTY",
            providerResultStatus: "empty",
            qualityStatus: "NORMAL",
            qualityFlags: [],
            limitations: [],
            requestedScopeJson: {},
            coveredScopeJson: {},
            missingScopeJson: {},
            revisions: [],
          },
        })),
      },
    }),
  );
}

describe("F04 跨 module 验收场景", () => {
  it("场景 1：盘前全局基线对不同用户保持四阶段六域的相同集合与顺序", async () => {
    const generated = generateHomepageDraft(homepageInput("READY"));
    const baselineProjection = {
      id: "baseline-projection",
      scope: "BASELINE",
      userId: null,
      activationSequence: 1n,
      snapshot: {
        id: "baseline-snapshot",
        scope: "BASELINE",
        userId: null,
        manifestId: generated.manifestId,
        payloadJson: generated.payload,
        dataCoverageJson: generated.dataCoverage,
        generatedAt: NOW,
        manifest: { baseManifestId: null },
      },
    };
    const db = {
      homepageCurrentSnapshotProjection: {
        findFirst: async (query: { where: { scope: string } }) =>
          query.where.scope === "PERSONALIZED" ? null : baselineProjection,
      },
      homepageGenerationTask: { findFirst: async () => null },
    };
    const [withoutFocus, withFocus] = await Promise.all([
      getHomePageSnapshot(db as never, "user-without-focus"),
      getHomePageSnapshot(db as never, "user-with-focus"),
    ]);

    expect(withoutFocus).toEqual(withFocus);
    expect(withoutFocus).toMatchObject({
      source: "BASELINE",
      manifestId: generated.manifestId,
      payload: generated.payload,
    });
    expect(MARKET_BASELINE_PHASES).toHaveLength(4);
    expect(
      MARKET_BASELINE_PHASES.every(
        (phase) => getBaselineItemsForPhase(phase).length === MARKET_BASELINE_DOMAIN_IDS.length,
      ),
    ).toBe(true);
  });

  it("场景 2：盘后可选资金流降级生成 READY_WITH_LIMITATION，新投影前进且旧快照保留", () => {
    const oldSnapshot = generateHomepageDraft(homepageInput("READY"));
    const limitedSnapshot = generateHomepageDraft(homepageInput("READY_WITH_LIMITATION"));
    const history = [oldSnapshot, limitedSnapshot];
    const current = history.reduce((latest, snapshot) =>
      BigInt(snapshot.activationSequence) > BigInt(latest.activationSequence) ? snapshot : latest,
    );

    expect(limitedSnapshot.dataCoverage).toContainEqual(
      expect.objectContaining({
        datasetKey: "money_flow",
        required: false,
        settlementStatus: "DEGRADED",
        limitations: ["可选资金流降级"],
      }),
    );
    expect(current.taskId).toBe(limitedSnapshot.taskId);
    expect(history.map((snapshot) => snapshot.taskId)).toEqual([
      oldSnapshot.taskId,
      limitedSnapshot.taskId,
    ]);
  });

  it("场景 3：公司事件晋级并完成四维评估后，先写站内紧急提醒再发送 Feishu", async () => {
    const lifecycle = new ResearchEventLifecycleService();
    const promoted = promoteCompanyEvent(lifecycle);
    if (!promoted.revision) throw new Error("事件未晋级");
    const adapter = new ScriptedAssessment([globalOutput(), relevanceOutput()]);
    const assessment = new ResearchAssessmentService(adapter);
    const frozenPreference = preference();
    const global = await assessment.assessGlobal(assessmentEvent(promoted.revision.id));
    const relevance = await assessment.assessRelevance({
      userId: "user-1",
      eventRevision: assessmentEvent(promoted.revision.id),
      preferenceSnapshot: frozenPreference,
    });
    const sends: FeishuDeliveryPayload[] = [];
    const inbox = new ResearchInboxService(new InMemoryResearchInboxRepository(), {
      clock: () => NOW,
    });
    const distribution = new ResearchDistributionService(
      inbox,
      new InMemoryResearchDistributionStore(),
      {
        clock: () => NOW,
        feishu: {
          send: async (payload) => {
            sends.push(payload);
          },
        },
        feishuGuard: { run: async (_copyId, operation) => operation() },
      },
    );
    const result = await distribution.distribute(
      distributionCandidate(promoted.revision.id, frozenPreference, {
        globalAssessmentId: global.assessment.id,
        relevanceAssessmentId: relevance.assessment.id,
      }),
    );

    expect(result.entry.highestChannel).toBe("URGENT_ALERT");
    expect(result.entry.references).toMatchObject({
      eventRevisionId: promoted.revision.id,
      globalAssessmentId: global.assessment.id,
      relevanceAssessmentId: relevance.assessment.id,
      preferenceSnapshotId: frozenPreference.id,
    });
    expect(result.externalCopy?.status).toBe("SENT");
    expect(sends).toHaveLength(1);
  });

  it("场景 4：合格冲突证据可形成待核实提醒，未核实来源版本被阻断", async () => {
    const lifecycle = new ResearchEventLifecycleService();
    const deferred = lifecycle.backfillCandidate(eventSeed()).candidates[0];
    if (!deferred) throw new Error("候选未创建");
    lifecycle.adjudicateCandidate({
      candidateKey: deferred.candidateKey,
      inputHash: "sha256:defer:conflict",
      outcome: "DEFER",
      decidedAt: NOW.toISOString(),
      evidenceGap: ["合格证据对订单金额存在冲突"],
      releaseConditions: ["取得公司更正公告"],
    });
    const inbox = new ResearchInboxService(new InMemoryResearchInboxRepository(), {
      clock: () => NOW,
    });
    const distribution = new ResearchDistributionService(
      inbox,
      new InMemoryResearchDistributionStore(),
      { clock: () => NOW },
    );
    const pending = distributionCandidate("candidate:deferred", preference(), {
      subject: { kind: "CANDIDATE", id: deferred.id },
      revisionKind: "PENDING_VERIFICATION",
      title: "待核实重大订单变化",
      body: inboxBody("candidate:deferred", "待核实"),
      scores: { importance: 4, confidence: 2, relevance: 4, informationNovelty: 4 },
    });

    const qualified = await distribution.distribute(pending);
    const unverified = await distribution.distribute({
      ...pending,
      distributionKey: "gate:user-1:candidate-unverified",
      subject: { kind: "CANDIDATE", id: "candidate-unverified" },
      sourceIdentityVerified: false,
    });

    expect(qualified.entry.entryKind).toBe("CANDIDATE_PENDING_VERIFICATION");
    expect(qualified.entry.highestChannel).toBe("URGENT_ALERT");
    expect(unverified.entry.highestChannel).toBe("IN_APP");
  });

  it("场景 5：更正与撤回形成不可变链、历史提示和新的收件箱通知", async () => {
    const lifecycle = new ResearchEventLifecycleService();
    const promoted = promoteCompanyEvent(lifecycle);
    if (!promoted.event || !promoted.revision) throw new Error("事件未晋级");
    const evidenceId = lifecycle.getStore().snapshot().evidence[0]?.id;
    if (!evidenceId) throw new Error("事件证据缺失");
    const claims = [
      {
        claimType: "WHAT_HAPPENED" as const,
        claimText: "公司更正订单金额。",
        citations: [
          {
            candidateEvidenceId: evidenceId,
            relation: "SUPPORTS" as const,
            sourceIdentityStatus: "VERIFIED" as const,
            proofQualification: "QUALIFIED" as const,
            citation: { quote: "更正订单金额" },
          },
        ],
      },
    ];
    const correction = lifecycle.reviseEvent({
      eventKey: promoted.event.eventKey,
      revisionDedupKey: "revision:correction:1",
      revisionKind: "CORRECTED",
      title: "订单金额更正",
      summary: "权威公告更正订单金额。",
      narrative: {},
      uncertainty: {},
      counterEvidence: {},
      occurredAt: "2026-08-03T02:00:00.000Z",
      knownAt: "2026-08-03T02:05:00.000Z",
      claims,
    });
    const retraction = lifecycle.reviseEvent({
      eventKey: promoted.event.eventKey,
      revisionDedupKey: "revision:retraction:1",
      revisionKind: "RETRACTED",
      title: "订单公告撤回",
      summary: "公司撤回原订单公告。",
      narrative: {},
      uncertainty: {},
      counterEvidence: {},
      occurredAt: "2026-08-03T03:00:00.000Z",
      knownAt: "2026-08-03T03:05:00.000Z",
      claims,
    });
    const sent: FeishuDeliveryPayload[] = [];
    const inbox = new ResearchInboxService(new InMemoryResearchInboxRepository(), {
      clock: () => NOW,
    });
    const distribution = new ResearchDistributionService(
      inbox,
      new InMemoryResearchDistributionStore(),
      {
        clock: () => NOW,
        feishu: {
          send: async (payload) => {
            sent.push(payload);
          },
        },
        feishuGuard: { run: async (_copyId, operation) => operation() },
      },
    );
    const correctionNotice = await distribution.distribute(
      distributionCandidate(correction.id, preference(), {
        revisionKind: "CORRECTION",
        body: inboxBody(correction.id, "已更正"),
      }),
    );
    const retractionNotice = await distribution.distribute(
      distributionCandidate(retraction.id, preference(), {
        revisionKind: "RETRACTION",
        body: inboxBody(retraction.id, "已撤回"),
      }),
    );

    expect(lifecycle.readRevision(promoted.revision.id).statusNotice).toContain(
      retraction.id,
    );
    expect(lifecycle.getStore().snapshot().revisions).toHaveLength(3);
    expect([correctionNotice.entry.entryKind, retractionNotice.entry.entryKind]).toEqual([
      "CORRECTION",
      "RETRACTION",
    ]);
    expect([correctionNotice.externalCopy?.status, retractionNotice.externalCopy?.status]).toEqual([
      "SENT",
      "SENT",
    ]);
    expect(sent).toHaveLength(2);
    expect(
      distribution.freezeBriefingScope({
        slot: "EVENING",
        taskId: "briefing:corrections",
        userId: "user-1",
        capacity: 0,
        candidates: [
          {
            id: correction.id,
            revisionKind: "CORRECTION",
            importance: 0,
            confidence: 0,
            informationNovelty: 0,
          },
          {
            id: retraction.id,
            revisionKind: "RETRACTION",
            importance: 0,
            confidence: 0,
            informationNovelty: 0,
          },
        ],
      }).mandatoryIds,
    ).toEqual([correction.id, retraction.id]);
  });

  it("场景 6：偏好变化隔离旧 fencing 与在途发送，并在新个性化快照就绪前回退基线", async () => {
    let now = new Date(NOW);
    const scheduler = new ResearchScheduler({ clock: { now: () => new Date(now) }, leaseMs: 1_000 });
    scheduler.registerPool({
      id: "homepage",
      poolKey: "homepage",
      resourceKind: "HOMEPAGE",
      hardConcurrency: 1,
      currentConcurrency: 1,
    });
    const admitted = scheduler.enqueue({
      taskType: "PERSONALIZED_HOMEPAGE",
      idempotencyKey: "homepage:user-1:old-preference",
      inputHash: "sha256:old-preference",
      inputContractVersion: "1.0",
      input: { preferenceSnapshotId: "old" },
      schedulingTier: "TIME_CRITICAL",
      resourcePoolId: "homepage",
      fairnessKey: "user-1",
      userId: "user-1",
    });
    const oldClaim = scheduler.claim("homepage", "worker-old");
    if (!admitted.task || !oldClaim) throw new Error("个性化首页任务未领取");
    now = new Date(NOW.getTime() + 1_001);
    const newClaim = scheduler.claim("homepage", "worker-new");
    if (!newClaim) throw new Error("失效任务未重新领取");
    expect(() =>
      scheduler.settle(admitted.task!.id, oldClaim.task.fencingToken, {
        disposition: "COMPLETED",
        resultContractVersion: "1.0",
        result: { snapshot: "stale-personalized" },
      }),
    ).toThrow(/fencing|租约/);

    const oldFrozenPreference = preference();
    const currentPreference = preference({
      id: "preference-snapshot-2",
      items: [],
      contentHash:
        "sha256:2222222222222222222222222222222222222222222222222222222222222222",
    });
    const baselineProjection = {
      id: "baseline-projection",
      scope: "BASELINE",
      userId: null,
      activationSequence: 2n,
      snapshot: {
        id: "baseline-snapshot",
        scope: "BASELINE",
        userId: null,
        manifestId: "baseline-manifest",
        payloadJson: generateHomepageDraft(homepageInput("READY")).payload,
        dataCoverageJson: [],
        generatedAt: NOW,
        manifest: { baseManifestId: null },
      },
    };
    const baselineFallback = await getHomePageSnapshot(
      {
        homepageCurrentSnapshotProjection: {
          findFirst: async (query: { where: { scope: string } }) =>
            query.where.scope === "PERSONALIZED" ? null : baselineProjection,
        },
        homepageGenerationTask: { findFirst: async () => ({ id: newClaim.task.id }) },
      } as never,
      "user-1",
    );
    const inbox = new ResearchInboxService(new InMemoryResearchInboxRepository(), {
      clock: () => NOW,
    });
    const inFlight = await new ResearchDistributionService(
      inbox,
      new InMemoryResearchDistributionStore(),
      { clock: () => NOW },
    ).distribute(distributionCandidate("revision-in-flight", oldFrozenPreference));

    expect(currentPreference.items).toHaveLength(0);
    expect(baselineFallback).toMatchObject({
      source: "BASELINE",
      personalizationPending: true,
      refreshInProgress: true,
    });
    expect(inFlight.entry.references.preferenceSnapshotId).toBe(oldFrozenPreference.id);
    expect(inFlight.entry.highestChannel).toBe("URGENT_ALERT");
  });

  it("场景 7：Minishare 限流、DeepSeek 超时与 Feishu 故障在独立资源池降级且不回滚", async () => {
    const scheduler = new ResearchScheduler();
    scheduler.registerPool({
      id: "minishare",
      poolKey: "minishare",
      resourceKind: "PROVIDER",
      hardConcurrency: 4,
      currentConcurrency: 4,
    });
    scheduler.registerPool({
      id: "deepseek",
      poolKey: "deepseek",
      resourceKind: "LLM",
      hardConcurrency: 4,
      currentConcurrency: 4,
    });
    scheduler.registerPool({
      id: "feishu",
      poolKey: "feishu",
      resourceKind: "DELIVERY",
      hardConcurrency: 2,
      currentConcurrency: 2,
    });
    const minishare = scheduler.recordAdaptiveOutcome("minishare", {
      kind: "RATE_LIMITED",
      retryAfterMs: 60_000,
    });
    const deepseek = scheduler.recordAdaptiveOutcome("deepseek", { kind: "TIMEOUT" });
    expect(minishare.current).toBe(2);
    expect(deepseek.current).toBe(3);
    expect(scheduler.getPool("feishu")?.currentConcurrency).toBe(2);

    const adapter = new ScriptedAssessment([globalOutput(), new Error("DeepSeek timeout"), new Error("DeepSeek timeout")]);
    const assessment = new ResearchAssessmentService(adapter);
    const event = assessmentEvent("revision-timeout");
    const first = await assessment.assessGlobal(event);
    const stale = await assessment.assessGlobal({
      ...event,
      cognitiveBaseline: [...event.cognitiveBaseline, { id: "baseline-2", summary: "新增基线" }],
    });
    expect(first.status).toBe("CREATED");
    expect(stale.status).toBe("STALE_RETAINED");
    expect(stale.assessment.id).toBe(first.assessment.id);

    const inbox = new ResearchInboxService(new InMemoryResearchInboxRepository(), {
      clock: () => NOW,
    });
    const distribution = new ResearchDistributionService(
      inbox,
      new InMemoryResearchDistributionStore(),
      {
        clock: () => NOW,
        feishu: {
          send: async () => {
            throw new FeishuDeliveryError("FEISHU_UNAVAILABLE", true);
          },
        },
        feishuGuard: { run: async (_copyId, operation) => operation() },
      },
    );
    const result = await distribution.distribute(distributionCandidate("revision-feishu-failure", preference()));
    expect(result.entry.id).toBeTruthy();
    expect(result.externalCopy?.status).toBe("RETRY_WAIT");
    expect((await inbox.get("user-1", result.entry.id))?.id).toBe(result.entry.id);
  });

  it("场景 8：即时研究回答与权威事件隔离，research_only 拦截价格指令且只异步产种子", () => {
    const prompt = "研究这家公司公告，并给出目标价和买入计划";
    const guarded = enforceResearchOnlyFinalText({
      prompt,
      text: "事实与证据：公司发布公告。\n目标价 20 元，建议买入。\n主要风险：履约不及预期。",
    });
    const seeds = buildImmediateResearchCandidateSeeds({
      runId: "run-immediate-1",
      prompt,
      toolSummaries: [
        {
          toolName: "internal_web_fetch",
          inputSummary: "https://example.test/announcement",
          outputSummary: "公司公开公告原文",
        },
      ],
    });
    const lifecycle = new ResearchEventLifecycleService();

    expect(guarded.blocked).toBe(true);
    expect(guarded.text).toContain("事实与证据");
    expect(guarded.text).not.toContain("目标价 20 元");
    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toMatchObject({
      source: "post_response_async",
      writesSynchronously: false,
      targetStores: ["candidate_seed_queue"],
    });
    expect(lifecycle.getStore().snapshot().events).toHaveLength(0);
  });

  it("场景 9：调度饱和时即时研究仍从独立资源池获许可，背压与时效违约可观测", async () => {
    let now = new Date(NOW);
    const scheduler = new ResearchScheduler({ clock: { now: () => new Date(now) } });
    scheduler.registerPool({
      id: "background",
      poolKey: "background",
      resourceKind: "REPLAY",
      hardConcurrency: 1,
      currentConcurrency: 1,
    });
    scheduler.registerPool({
      id: "interactive",
      poolKey: "interactive",
      resourceKind: "AGENT",
      hardConcurrency: 1,
      currentConcurrency: 1,
    });
    const background = scheduler.enqueue({
      taskType: "REPLAY",
      idempotencyKey: "replay-1",
      inputHash: "sha256:replay-1",
      inputContractVersion: "1.0",
      input: {},
      schedulingTier: "BACKGROUND",
      resourcePoolId: "background",
      fairnessKey: "replay",
    });
    scheduler.claim("background", "worker-background");
    now = new Date(NOW.getTime() + 30_000);
    let rejected = scheduler.enqueue({
      taskType: "REPLAY",
      idempotencyKey: "replay-backlog-0",
      inputHash: "sha256:replay-backlog-0",
      inputContractVersion: "1.0",
      input: {},
      schedulingTier: "BACKGROUND",
      resourcePoolId: "background",
      fairnessKey: "replay",
    });
    for (let index = 1; rejected.decision === "ACCEPTED" && index < 100; index += 1) {
      rejected = scheduler.enqueue({
        taskType: "REPLAY",
        idempotencyKey: `replay-backlog-${index}`,
        inputHash: `sha256:replay-backlog-${index}`,
        inputContractVersion: "1.0",
        input: {},
        schedulingTier: "BACKGROUND",
        resourcePoolId: "background",
        fairnessKey: "replay",
      });
    }
    const interactive = scheduler.enqueue({
      taskType: "IMMEDIATE_RESEARCH",
      idempotencyKey: "immediate-1",
      inputHash: "sha256:immediate-1",
      inputContractVersion: "1.0",
      input: {},
      schedulingTier: "INTERACTIVE",
      resourcePoolId: "interactive",
      fairnessKey: "user-1",
      userId: "user-1",
      targetCompletionAt: new Date(now.getTime() + 20_000),
    });
    const interactiveClaim = scheduler.claim("interactive", "worker-interactive");

    expect(background.decision).toBe("ACCEPTED");
    expect(rejected.decision).not.toBe("ACCEPTED");
    expect(rejected.reason).toBeTruthy();
    expect(interactive.decision).toBe("ACCEPTED");
    expect(interactiveClaim?.task.taskType).toBe("IMMEDIATE_RESEARCH");
    now = new Date(now.getTime() + 10_000);
    const backlogAge = scheduler.getBacklog("background").oldestAgeMs;
    expect(backlogAge).not.toBeNull();
    expect(schedulingPolicy.tierWeights).toEqual({
      INTERACTIVE: 5,
      TIME_CRITICAL: 3,
      BACKGROUND: 1,
    });
    const runtime = new RuntimeObservabilityService(
      new InMemoryRuntimeObservabilityRepository(),
    );
    const observation = await runtime.recordResourceSnapshot({
      idempotencyKey: "saturated-background-pool",
      resourcePool: "background",
      stage: "REPLAY",
      observedAt: now,
      backlogAgeMs: Number(backlogAge ?? 0n),
      backlogTargetMs: 1_000,
      success: false,
    });
    expect(observation.breaches.map((breach) => breach.kind)).toContain("BACKLOG");
  });
});

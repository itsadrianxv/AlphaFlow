import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import type {
  ResearchAssessmentLlmAdapter,
  ResearchAssessmentLlmRequest,
} from "~/server/application/research-assessment/research-assessment-service";
import {
  CandidateProductionScheduler,
  CandidateProductionWorker,
  type CandidateAdjudicationAdapter,
  enqueueResearchCandidateSeed,
} from "~/server/application/research-production/candidate-production";
import { createProductionResearchInboxService } from "~/server/application/research-production/production";
import { ResearchPreferenceService } from "~/server/application/research-preference/research-preference-service";
import { PostgresResearchScheduler } from "~/server/application/scheduling/postgres-research-scheduler";
import { PrismaResearchPreferenceRepository } from "~/server/infrastructure/research-preference/prisma-research-preference-repository";

const databaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

function key(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

class ContractAssessmentAdapter implements ResearchAssessmentLlmAdapter {
  async complete(request: ResearchAssessmentLlmRequest) {
    const marker = "冻结输入：";
    const content = request.messages.at(-1)?.content ?? "";
    const snapshot = JSON.parse(
      content.slice(content.indexOf(marker) + marker.length),
    ) as {
      eventRevision: { revisionId: string };
      preferenceSnapshot?: {
        items: Array<{ targetType: string; targetKey: string; level: string }>;
      };
    };
    const ref = {
      refId: snapshot.eventRevision.revisionId,
      refType: "EVENT_REVISION",
    } as const;
    const dimension = (score: 0 | 1 | 2 | 3 | 4, text: string) => ({
      score,
      reasons: [{ text, citations: [ref] }],
      uncertainty: "仅依据冻结输入。",
    });
    const preference = snapshot.preferenceSnapshot?.items[0];
    return {
      rawOutput: JSON.stringify(
        request.kind === "GLOBAL"
          ? {
              importance: dimension(4, "公告影响量产节奏。"),
              confidence: dimension(4, "权威来源与观测一致。"),
              informationNovelty: dimension(3, "新增量产节点变化。"),
            }
          : {
              relevance: dimension(preference ? 4 : 0, "命中冻结研究关注。"),
              matchedPreferences: preference
                ? [{ ...preference, relation: "DIRECT" }]
                : [],
            },
      ),
      usage: { credentialId: "candidate-contract" },
    };
  }
}

class ContractCandidateAdapter implements CandidateAdjudicationAdapter {
  async adjudicate(input: {
    subject: { type: string; key: string };
    evidence: Array<{ evidenceKey: string }>;
    knownAt: string;
  }) {
    return {
      contractVersion: "candidate-adjudication-output.v1" as const,
      candidate: {
        eventIdentityKey: "capacity-ramp-schedule-2026-q4",
        clusterKey: "company:300750.SZ:capacity-ramp-schedule",
      },
      evidence: input.evidence.map((item, index) => ({
        evidenceKey: item.evidenceKey,
        evidenceRole: "CORE_FACT" as const,
        sourceIdentityStatus: "VERIFIED" as const,
        proofQualification:
          index === 0 ? ("QUALIFIED" as const) : ("CORROBORATING_ONLY" as const),
        independenceKey: `authority-${String(index + 1)}`,
        citation: {
          source: index === 0 ? "巨潮资讯公司公告" : "规范化数据观测",
          excerpt: "量产节点调整至第四季度。",
        },
      })),
      adjudication: {
        outcome: "PROMOTE" as const,
        title: "宁德时代量产节点调整至第四季度",
        summary: "公告与数据观测确认量产节点调整。",
        occurredAt: input.knownAt,
        knownAt: input.knownAt,
        narrative: {
          impact: "收入确认节奏可能后移。",
          reasons: ["客户验证周期延长。"],
          nextChecks: ["确认客户验证完成率。"],
          risks: ["尚未披露影响金额。"],
        },
        uncertainty: { items: ["尚未披露影响金额。"] },
        counterEvidence: { items: [] },
        claims: [
          {
            claimKey: "capacity-schedule",
            claimType: "FACT",
            text: "量产节点已调整至第四季度。",
            evidenceKeys: input.evidence.map((item) => item.evidenceKey),
          },
        ],
        impacts: [
          {
            subjectType: input.subject.type,
            subjectKey: input.subject.key,
            impactType: "DIRECT" as const,
            materiality: "HIGH" as const,
            path: ["量产节点", "收入确认节奏"],
          },
        ],
      },
    };
  }
}

describePostgres("candidate/adjudication 自动生产 PostgreSQL 纵向契约", () => {
  const db = new PrismaClient({
    datasources: {
      db: { url: databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused" },
    },
  });
  afterAll(async () => db.$disconnect());

  async function createPool() {
    const id = key("candidate-pool");
    await db.researchResourcePool.create({
      data: {
        id,
        poolKey: key("candidate-pool-key"),
        resourceKind: "LLM",
        hardConcurrency: 4,
        currentConcurrency: 2,
      },
    });
    return id;
  }

  it("只写入权威观测修订后，正式 scheduler/worker 可产生事件、评估和 inbox", async () => {
    const poolId = await createPool();
    const userId = key("candidate-user");
    await db.user.create({ data: { id: userId } });
    const preferences = new ResearchPreferenceService(
      new PrismaResearchPreferenceRepository(db),
      { clock: () => new Date("2026-08-03T02:45:00.000Z") },
    );
    await preferences.add(userId, {
      commandId: key("candidate-focus"),
      target: { targetType: "COMPANY", targetKey: "300750.SZ" },
      level: "FOCUS",
    });

    const sourceAssertionId = key("candidate-source");
    const observationIdentityKey = key("candidate-observation-identity");
    await db.sourceAssertion.create({
      data: {
        id: sourceAssertionId,
        assertionKey: key("candidate-assertion"),
        canonicalizationVersion: "provider-source-assertion.v1",
        sourceKey: "minishare",
        datasetKey: "news.major",
        sourceRecordKey: key("cninfo-record"),
        observationIdentityKey,
        rawRecordJson: {
          title: "关于量产节点调整的公告",
          content: "量产节点调整至第四季度。",
          url: "https://www.cninfo.com.cn/new/disclosure/detail",
        },
        contentHash:
          "sha256:16b23d2055660ddc617f079aec4250dc66b16c82892365700d64ac9396db5f14",
        requestParamsHash:
          "sha256:30c3961f604b394e68e0cbf702f532e19a1a73d53bdc6b0594fe4c7bf1df8d6f",
        providerVersion: "minishare-v1",
        sourcePublishedAt: new Date("2026-08-03T02:31:00.000Z"),
        fetchedAt: new Date("2026-08-03T02:40:00.000Z"),
      },
    });
    const observation = await db.dataObservation.create({
      data: {
        identityKey: observationIdentityKey,
        canonicalizationVersion: "observation.v1",
        subjectType: "COMPANY",
        subjectKey: "300750.SZ",
        metricCatalogId: "capacity_ramp_schedule",
        observationKind: "INSTANT",
        observationDate: new Date("2026-08-03T00:00:00.000Z"),
      },
    });
    const revision = await db.dataObservationRevision.create({
      data: {
        observationId: observation.id,
        revisionNo: 1,
        revisionDedupKey: key("candidate-revision"),
        canonicalizationVersion: "observation.v1",
        valueType: "TEXT",
        valueText: "量产节点调整至第四季度",
        qualityStatus: "NORMAL",
        valueHash:
          "sha256:6ec8e07f3ceff7e09054d98964983c27368f9d239da56199383f94a9f2d8119c",
        normalizationRulesVersion: "capacity-rules.v1",
        normalizedAt: new Date("2026-08-03T02:43:00.000Z"),
        revisionSources: {
          create: {
            sourceAssertionId,
            role: "SELECTED",
            authorityStrategyVersion: "authority.v1",
            selectionReason: "公司公告为权威来源",
          },
        },
      },
    });
    await db.dataObservation.update({
      where: { id: observation.id },
      data: { currentRevisionId: revision.id },
    });

    const scheduler = new PostgresResearchScheduler(db);
    const productionScheduler = new CandidateProductionScheduler(db, scheduler);
    const scheduled = await productionScheduler.scheduleAuthorityInputs({
      poolId,
      limit: 20,
    });
    expect(scheduled.accepted).toBe(1);

    const worker = new CandidateProductionWorker(
      db,
      scheduler,
      new ContractCandidateAdapter(),
      {
        assessmentLlm: new ContractAssessmentAdapter(),
        clock: () => new Date("2026-08-03T02:45:00.000Z"),
      },
    );
    const result = await worker.runOnce(poolId, "candidate-worker-a");
    expect(result?.status).toBe("COMPLETED");
    expect(result?.production.eventRevisionId).toBeTruthy();

    const inbox = createProductionResearchInboxService(db);
    const entries = await inbox.list(userId, "PENDING");
    expect(entries.items).toHaveLength(1);
    expect(entries.items[0]?.references.eventRevisionId).toBe(
      result?.production.eventRevisionId,
    );
    const taskObservations = await db.researchRuntimeObservation.findMany({
      where: {
        stage: { in: ["candidate-production", "adjudication-production"] },
      },
    });
    expect(taskObservations.map((item) => item.stage).sort()).toEqual([
      "adjudication-production",
      "candidate-production",
    ]);
    expect(
      taskObservations.every((item) => {
        const context = item.observationContextJson as {
          taskId?: string;
          inputHash?: string;
          fencingToken?: string;
          authoritativeObjectIds?: string[];
        };
        return (
          typeof context.taskId === "string" &&
          context.inputHash?.startsWith("sha256:") === true &&
          typeof context.fencingToken === "string" &&
          (context.authoritativeObjectIds?.length ?? 0) > 0
        );
      }),
    ).toBe(true);
  });

  it("即时研究 seed 在同一事务保存任务与审计，重放不重复且非法输入留有拒绝审计", async () => {
    const poolId = await createPool();
    const seed = {
      contractVersion: "research-candidate-seed.v1" as const,
      idempotencyKey: key("immediate-seed"),
      triggerSource: "IMMEDIATE_RESEARCH" as const,
      runId: key("run"),
      scope: "COMPANY",
      subject: { type: "COMPANY", key: "300750.SZ" },
      question: "公告对量产节奏有什么影响？",
      sourceReferences: [
        {
          sourceType: "PUBLIC_WEB" as const,
          sourceKey: "https://www.cninfo.com.cn/new/disclosure/detail",
          summary: "公司公告称量产节点调整至第四季度。",
        },
      ],
    };

    const first = await enqueueResearchCandidateSeed(db, seed, { poolId });
    const replay = await enqueueResearchCandidateSeed(db, seed, { poolId });
    expect(first.created).toBe(true);
    expect(replay).toEqual({ ...first, created: false });
    expect(
      await db.researchAuditRecord.count({
        where: { auditKey: `candidate-seed:${seed.idempotencyKey}` },
      }),
    ).toBe(1);

    await expect(
      enqueueResearchCandidateSeed(
        db,
        {
          ...seed,
          idempotencyKey: key("invalid-seed"),
          question: "给出目标价和买入计划",
          sourceReferences: [],
        },
        { poolId },
      ),
    ).rejects.toThrow();
    expect(
      await db.researchAuditRecord.count({
        where: { action: "RESEARCH_CANDIDATE_SEED_REJECTED" },
      }),
    ).toBeGreaterThan(0);
  });
});

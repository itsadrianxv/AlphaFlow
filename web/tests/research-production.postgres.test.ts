import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import type {
  ResearchAssessmentLlmAdapter,
  ResearchAssessmentLlmRequest,
} from "~/server/application/research-assessment/research-assessment-service";
import { ResearchPreferenceService } from "~/server/application/research-preference/research-preference-service";
import {
  createProductionResearchInboxService,
  runResearchProduction,
} from "~/server/application/research-production/production";
import { PrismaResearchPreferenceRepository } from "~/server/infrastructure/research-preference/prisma-research-preference-repository";

const contractDatabaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = contractDatabaseUrl ? describe : describe.skip;

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
      eventRevision: {
        revisionId: string;
        claims: Array<{ id: string }>;
      };
      preferenceSnapshot?: {
        items: Array<{
          targetType: string;
          targetKey: string;
          level: string;
        }>;
      };
    };
    const eventRef = {
      refId: snapshot.eventRevision.revisionId,
      refType: "EVENT_REVISION",
    } as const;
    const dimension = (score: 0 | 1 | 2 | 3 | 4, text: string) => ({
      score,
      reasons: [{ text, citations: [eventRef] }],
      uncertainty: "仅依据冻结输入。",
    });

    if (request.kind === "GLOBAL") {
      return {
        rawOutput: JSON.stringify({
          importance: dimension(4, "产能节点变化影响兑现节奏。"),
          confidence: dimension(4, "公告与数据观测相互印证。"),
          informationNovelty: dimension(3, "相对既有认知新增量产节点变化。"),
        }),
        usage: { credentialId: "contract", inputTokens: 100, outputTokens: 80 },
      };
    }

    const preference = snapshot.preferenceSnapshot?.items[0];
    if (!preference) {
      return {
        rawOutput: JSON.stringify({
          relevance: dimension(0, "未命中任何冻结研究关注。"),
          matchedPreferences: [],
        }),
        usage: { credentialId: "contract", inputTokens: 40, outputTokens: 20 },
      };
    }
    return {
      rawOutput: JSON.stringify({
        relevance: dimension(4, "直接命中重点公司关注。"),
        matchedPreferences: [
          {
            ...preference,
            relation: "DIRECT",
          },
        ],
      }),
      usage: { credentialId: "contract", inputTokens: 60, outputTokens: 40 },
    };
  }
}

describePostgres("主动研究生产编排 PostgreSQL 纵向契约", () => {
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

  it("公告材料和数据观测修订可在重启后幂等产生事件、评估与研究收件箱", async () => {
    const userId = key("production-user");
    const eventIdentityKey = key("cninfo-capacity-schedule");
    await db.user.create({ data: { id: userId } });
    const preferences = new ResearchPreferenceService(
      new PrismaResearchPreferenceRepository(db),
      { clock: () => new Date("2026-08-03T02:45:00.000Z") },
    );
    await preferences.add(userId, {
      commandId: key("focus-command"),
      target: { targetType: "COMPANY", targetKey: "300750.SZ" },
      level: "FOCUS",
    });

    const observationId = key("observation");
    const observationRevisionId = key("observation-revision");
    const materialSourceAssertionId = key("material-source-assertion");
    await db.sourceAssertion.create({
      data: {
        id: materialSourceAssertionId,
        assertionKey: key("material-assertion-key"),
        canonicalizationVersion: "provider-source-assertion.v1",
        sourceKey: "minishare",
        datasetKey: "news.major",
        sourceRecordKey: "cninfo:300750:2026-capacity-schedule",
        observationIdentityKey: key("material-observation-identity"),
        rawRecordJson: {
          title: "关于量产节点调整的公告",
          content: "量产节点调整至第四季度。",
          url: "https://www.cninfo.com.cn/new/disclosure/detail?announcementId=capacity-schedule",
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
    await db.dataObservation.create({
      data: {
        id: observationId,
        identityKey: key("observation-identity"),
        canonicalizationVersion: "observation.v1",
        subjectType: "COMPANY",
        subjectKey: "300750.SZ",
        metricCatalogId: "capacity_ramp_schedule",
        observationKind: "INSTANT",
        observationDate: new Date("2026-08-03T00:00:00.000Z"),
      },
    });
    await db.dataObservationRevision.create({
      data: {
        id: observationRevisionId,
        observationId,
        revisionNo: 1,
        revisionDedupKey: key("observation-revision-dedup"),
        canonicalizationVersion: "observation.v1",
        valueType: "TEXT",
        valueText: "量产节点调整至第四季度",
        qualityStatus: "NORMAL",
        valueHash: "sha256:6ec8e07f3ceff7e09054d98964983c27368f9d239da56199383f94a9f2d8119c",
        normalizationRulesVersion: "capacity-rules.v1",
        normalizedAt: new Date("2026-08-03T02:43:00.000Z"),
      },
    });
    await db.dataObservation.update({
      where: { id: observationId },
      data: { currentRevisionId: observationRevisionId },
    });

    const productionInput = {
      contractVersion: "research-production.v1" as const,
      idempotencyKey: key("production-run"),
      candidate: {
        candidateKey: key("candidate"),
        clusterKey: key("cluster"),
        subjectType: "COMPANY",
        subjectKey: "300750.SZ",
        eventIdentityKey,
        evidence: [
          {
            evidenceKey: "announcement",
            evidenceRole: "CORE_FACT" as const,
            sourceIdentityStatus: "VERIFIED" as const,
            proofQualification: "QUALIFIED" as const,
            independenceKey: "cninfo:announcement:2026-capacity-schedule",
            citation: {
              source: "巨潮资讯公司公告",
              excerpt: "量产节点调整至第四季度。",
              href: "https://www.cninfo.com.cn/",
            },
            material: {
              materialKey: key("announcement-material"),
              sourceAssertionId: materialSourceAssertionId,
              sourceItemKey: "cninfo:300750:2026-capacity-schedule",
              normalizedUrl: "https://www.cninfo.com.cn/new/disclosure/detail?announcementId=capacity-schedule",
              contentHash:
                "sha256:16b23d2055660ddc617f079aec4250dc66b16c82892365700d64ac9396db5f14",
              rawContent: {
                title: "关于量产节点调整的公告",
                content: "量产节点调整至第四季度。",
              },
              publishedAt: "2026-08-03T02:31:00.000Z",
              fetchedAt: "2026-08-03T02:40:00.000Z",
            },
          },
          {
            evidenceKey: "observation-change",
            evidenceRole: "CORE_FACT" as const,
            sourceIdentityStatus: "VERIFIED" as const,
            proofQualification: "CORROBORATING_ONLY" as const,
            independenceKey: "observation:capacity-ramp-schedule",
            citation: {
              source: "产能节点数据观测",
              excerpt: "规范化节点由三季度变化为第四季度。",
            },
            observationRevisionId,
          },
        ],
      },
      adjudication: {
        outcome: "PROMOTE" as const,
        contractVersion: "candidate-adjudication.v1",
        model: "deepseek-v4-flash",
        promptVersion: "candidate-adjudication.prompt.v1",
        schemaVersion: "candidate-adjudication.schema.v1",
        title: "宁德时代量产节点调整至第四季度",
        summary: "公司公告与数据观测确认量产节点由三季度调整至第四季度。",
        occurredAt: "2026-08-03T02:31:00.000Z",
        knownAt: "2026-08-03T02:43:00.000Z",
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
            evidenceKeys: ["announcement", "observation-change"],
          },
        ],
        impacts: [
          {
            subjectType: "COMPANY",
            subjectKey: "300750.SZ",
            impactType: "DIRECT",
            materiality: "HIGH",
            path: ["量产节点", "收入确认节奏"],
          },
        ],
      },
    };

    const first = await runResearchProduction(db, productionInput, {
      assessmentLlm: new ContractAssessmentAdapter(),
      clock: () => new Date("2026-08-03T02:45:00.000Z"),
    });
    expect(first.status).toBe("COMPLETED");
    expect(first.eventRevisionId).toBeTruthy();
    const userDistribution = first.distributions.find(
      (item) => item.userId === userId,
    );
    expect(userDistribution?.highestChannel).toBe("URGENT_ALERT");

    const inbox = createProductionResearchInboxService(db);
    const entries = await inbox.list(userId, "PENDING");
    expect(entries.items).toHaveLength(1);
    expect(entries.items[0]?.references.eventRevisionId).toBe(
      first.eventRevisionId,
    );
    expect(entries.items[0]?.references.globalAssessmentId).toBeTruthy();
    expect(entries.items[0]?.references.relevanceAssessmentId).toBeTruthy();
    expect(entries.items[0]?.body.evidence.map((item) => item.id)).toEqual(
      expect.arrayContaining(["announcement", "observation-change"]),
    );
    const observations = await db.researchRuntimeObservation.findMany({
      where: {
        observationContextJson: { path: ["phase"], equals: "COMPLETED" },
        stage: {
          in: [
            "event-production",
            "global-assessment",
            "relevance-assessment",
            "in-app-distribution",
          ],
        },
      },
      orderBy: { stage: "asc" },
    });
    expect(observations.map((item) => item.stage).sort()).toEqual([
      "event-production",
      "global-assessment",
      "in-app-distribution",
      "relevance-assessment",
    ]);
    expect(
      observations.every((item) => {
        const context = item.observationContextJson as {
          inputContractVersion?: string;
          inputHash?: string;
          authoritativeObjectIds?: string[];
        };
        return (
          context.inputContractVersion === "research-production.v1" &&
          context.inputHash?.startsWith("sha256:") === true &&
          (context.authoritativeObjectIds?.length ?? 0) > 0
        );
      }),
    ).toBe(true);
    const persistedMaterial = await db.researchCandidateMaterial.findFirstOrThrow({
      where: { sourceAssertionId: materialSourceAssertionId },
    });
    expect(persistedMaterial.sourceAssertionId).toBe(materialSourceAssertionId);

    const replayed = await runResearchProduction(db, productionInput, {
      assessmentLlm: new ContractAssessmentAdapter(),
      clock: () => new Date("2026-08-03T03:00:00.000Z"),
    });
    expect(replayed.status).toBe("REPLAYED");
    expect(replayed.eventRevisionId).toBe(first.eventRevisionId);
    expect((await inbox.list(userId, "PENDING")).items).toHaveLength(1);
  });
});

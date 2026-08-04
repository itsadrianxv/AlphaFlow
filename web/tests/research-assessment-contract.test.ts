import { describe, expect, it } from "vitest";
import type { ResearchPreferenceSnapshot } from "~/contracts/research-preference";
import {
  InMemoryResearchAssessmentStore,
  type ResearchAssessmentLlmAdapter,
  type ResearchAssessmentLlmRequest,
  type ResearchAssessmentLlmResponse,
  ResearchAssessmentService,
  RESEARCH_ASSESSMENT_MODEL,
} from "~/server/application/research-assessment/research-assessment-service";

class ScriptedAssessmentAdapter implements ResearchAssessmentLlmAdapter {
  readonly requests: ResearchAssessmentLlmRequest[] = [];

  constructor(private readonly outputs: Array<string | Error>) {}

  async complete(
    request: ResearchAssessmentLlmRequest,
  ): Promise<ResearchAssessmentLlmResponse> {
    this.requests.push(request);
    const output = this.outputs.shift();
    if (output instanceof Error) throw output;
    if (output === undefined) throw new Error("测试替身缺少输出");
    return {
      rawOutput: output,
      usage: {
        credentialId: "deepseek:fixture",
        inputTokens: 100,
        cachedInputTokens: 40,
        outputTokens: 20,
      },
    };
  }
}

function eventRevision(index = 1) {
  return {
    revisionId: `revision-${index}`,
    eventKey: `event-${index}`,
    title: `研究事件 ${index}`,
    summary: "公司公告订单变化，影响后续收入验证。",
    claims: [
      {
        id: `claim-${index}`,
        text: "公司公告新增重大订单。",
        evidenceRefs: [`evidence-${index}`],
      },
    ],
    evidence: [
      {
        id: `evidence-${index}`,
        summary: "公告原文片段。",
      },
    ],
    impacts: [
      {
        id: `impact-company-${index}`,
        subjectType: "COMPANY" as const,
        subjectKey: "000001.SZ",
        relation: "DIRECT" as const,
        materiality: "HIGH" as const,
      },
      {
        id: `impact-industry-${index}`,
        subjectType: "INDUSTRY" as const,
        subjectKey: "电力设备",
        relation: "WEAK" as const,
        materiality: "MEDIUM" as const,
        path: ["电力设备", "000001.SZ"],
      },
    ],
    cognitiveBaseline: [
      {
        id: `baseline-${index}`,
        summary: "此前市场只知道订单意向，尚未公告正式合同。",
      },
    ],
  };
}

function preferenceSnapshot(
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
      { targetType: "INDUSTRY", targetKey: "电力设备", level: "FOCUS" },
    ],
    contentHash:
      "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    frozenAt: new Date("2026-08-03T01:00:00.000Z"),
    personalDataDeletedAt: null,
    ...overrides,
  };
}

function dimension(
  score: 0 | 1 | 2 | 3 | 4 | null,
  refId: string,
  refType:
    | "EVENT_REVISION"
    | "FACT_CLAIM"
    | "EVIDENCE"
    | "COGNITIVE_BASELINE"
    | "RESEARCH_PREFERENCE"
    | "IMPACT_OBJECT",
) {
  return {
    score,
    reasons: [
      {
        text: score === null ? "冻结输入不足，无法判断。" : "冻结输入支持该判断。",
        citations: [{ refId, refType }],
      },
    ],
    uncertainty: score === null ? "缺少必要证据。" : "仍需观察后续验证项。",
  };
}

function globalOutput(index: number, score: 0 | 1 | 2 | 3 | 4 | null = 3) {
  return JSON.stringify({
    importance: dimension(score, `claim-${index}`, "FACT_CLAIM"),
    confidence: dimension(score, `evidence-${index}`, "EVIDENCE"),
    informationNovelty: dimension(score, `baseline-${index}`, "COGNITIVE_BASELINE"),
  });
}

function relevanceOutput(
  index: number,
  score: 0 | 1 | 2 | 3 | 4 | null = 3,
  relation: "DIRECT" | "WEAK" = "DIRECT",
) {
  return JSON.stringify({
    relevance: dimension(
      score,
      relation === "DIRECT"
        ? "preference:COMPANY:000001.SZ"
        : `impact-industry-${index}`,
      relation === "DIRECT" ? "RESEARCH_PREFERENCE" : "IMPACT_OBJECT",
    ),
    matchedPreferences: [
      {
        targetType: relation === "DIRECT" ? "COMPANY" : "INDUSTRY",
        targetKey: relation === "DIRECT" ? "000001.SZ" : "电力设备",
        level: "FOCUS",
        relation,
        ...(relation === "WEAK" ? { path: ["电力设备", "000001.SZ"] } : {}),
      },
    ],
  });
}

describe("四维评估与个性化研究雷达应用契约", () => {
  it("20 个全局固定样例满足 schema、量表、引用闭合、null 与禁止字段契约", async () => {
    const adapter = new ScriptedAssessmentAdapter(
      Array.from({ length: 20 }, (_, index) =>
        globalOutput(index + 1, index % 5 === 0 ? null : ((index % 5) as 0 | 1 | 2 | 3 | 4)),
      ),
    );
    const service = new ResearchAssessmentService(adapter);

    for (let index = 1; index <= 20; index += 1) {
      const result = await service.assessGlobal(eventRevision(index));
      expect(result.status).toBe("CREATED");
      expect(result.assessment.output.importance.score).toSatisfy(
        (score: unknown) =>
          score === null ||
          (Number.isInteger(score) && Number(score) >= 0 && Number(score) <= 4),
      );
    }
    expect(adapter.requests).toHaveLength(20);
    expect(
      adapter.requests.every(
        (request) =>
          request.model === RESEARCH_ASSESSMENT_MODEL &&
          request.temperature === 0 &&
          request.maxInputTokens === 32_000 &&
          request.maxOutputTokens === 16_384 &&
          request.messages[0]?.content.includes('"importance"') &&
          request.messages[0]?.content.includes('"citations"') &&
          !request.repairOf,
      ),
    ).toBe(true);
  });

  it("20 个相关性固定样例满足 schema、量表、引用闭合、null 与禁止字段契约", async () => {
    const adapter = new ScriptedAssessmentAdapter(
      Array.from({ length: 20 }, (_, index) =>
        relevanceOutput(
          index + 1,
          index % 6 === 0 ? null : ((index % 5) as 0 | 1 | 2 | 3 | 4),
          index % 2 === 0 ? "WEAK" : "DIRECT",
        ),
      ),
    );
    const service = new ResearchAssessmentService(adapter);

    for (let index = 1; index <= 20; index += 1) {
      const result = await service.assessRelevance({
        userId: "user-1",
        eventRevision: eventRevision(index),
        preferenceSnapshot: preferenceSnapshot({ id: `snapshot-${index}` }),
      });
      expect(result.status).toBe("CREATED");
      expect(result.assessment.output.relevance.reasons[0]?.citations).toHaveLength(1);
    }
    expect(adapter.requests).toHaveLength(20);
    expect(
      adapter.requests.every(
        (request) =>
          request.model === RESEARCH_ASSESSMENT_MODEL &&
          request.temperature === 0 &&
          request.maxInputTokens === 8_000 &&
          request.maxOutputTokens === 16_384 &&
          request.messages[0]?.content.includes('"matchedPreferences"') &&
          request.messages[0]?.content.includes('"citations"') &&
          !request.repairOf,
      ),
    ).toBe(true);
  });

  it("结构修复最多一次，成功后按相同冻结输入和路由复用缓存", async () => {
    const adapter = new ScriptedAssessmentAdapter([
      "{broken",
      globalOutput(1, 4),
    ]);
    const service = new ResearchAssessmentService(adapter);
    const first = await service.assessGlobal(eventRevision(1));
    const second = await service.assessGlobal(eventRevision(1));

    expect(first.status).toBe("CREATED");
    expect(second.status).toBe("CACHED");
    expect(second.assessment.id).toBe(first.assessment.id);
    expect(adapter.requests).toHaveLength(2);
    expect(adapter.requests[1]?.repairOf?.validationErrors.length).toBeGreaterThan(0);
  });

  it("引用越界和禁止字段在最多一次修复后仍失败，且失败保留旧有效评估", async () => {
    const store = new InMemoryResearchAssessmentStore();
    const service = new ResearchAssessmentService(
      new ScriptedAssessmentAdapter([
        globalOutput(1, 3),
        JSON.stringify({
          importance: dimension(4, "missing-ref", "EVIDENCE"),
          confidence: dimension(4, "evidence-1", "EVIDENCE"),
          informationNovelty: dimension(4, "baseline-1", "COGNITIVE_BASELINE"),
        }),
        JSON.stringify({
          importance: {
            ...dimension(4, "claim-2", "FACT_CLAIM"),
            totalScore: 9,
          },
          confidence: dimension(4, "evidence-2", "EVIDENCE"),
          informationNovelty: dimension(4, "baseline-2", "COGNITIVE_BASELINE"),
        }),
      ]),
      store,
    );

    const old = await service.assessGlobal(eventRevision(1));
    const changedInputSameRevision = {
      ...eventRevision(2),
      revisionId: "revision-1",
    };
    const retained = await service.assessGlobal(changedInputSameRevision);

    expect(old.status).toBe("CREATED");
    expect(retained.status).toBe("STALE_RETAINED");
    expect(retained.assessment.id).toBe(old.assessment.id);
    expect(retained.validationErrors?.length).toBeGreaterThan(0);
  });

  it("个性化研究雷达独立展示相关变化，不改变专业市场基线集合和排序", async () => {
    const adapter = new ScriptedAssessmentAdapter([
      relevanceOutput(1, 4, "DIRECT"),
      relevanceOutput(2, 3, "WEAK"),
    ]);
    const service = new ResearchAssessmentService(adapter);
    const direct = await service.assessRelevance({
      userId: "user-1",
      eventRevision: eventRevision(1),
      preferenceSnapshot: preferenceSnapshot({ id: "snapshot-direct" }),
    });
    const weak = await service.assessRelevance({
      userId: "user-1",
      eventRevision: eventRevision(2),
      preferenceSnapshot: preferenceSnapshot({ id: "snapshot-weak" }),
    });
    const baselineEvents = [
      { eventRevisionId: "revision-2", title: "第二条基线事件", rank: 2 },
      { eventRevisionId: "revision-1", title: "第一条基线事件", rank: 1 },
      { eventRevisionId: "revision-3", title: "第三条基线事件", rank: 3 },
    ];

    const radar = service.buildPersonalizedRadar({
      baselineEvents,
      relevanceAssessments: [direct.assessment, weak.assessment],
    });
    const noPreferenceRadar = service.buildPersonalizedRadar({
      baselineEvents,
      relevanceAssessments: [],
    });

    expect(radar.baselineEvents.map((event) => event.eventRevisionId)).toEqual([
      "revision-1",
      "revision-2",
      "revision-3",
    ]);
    expect(radar.radarItems.map((item) => item.eventRevisionId)).toEqual([
      "revision-1",
      "revision-2",
    ]);
    expect(radar.radarItems[1]?.matchedPreferences[0]?.level).toBe("REGULAR");
    expect(radar.radarItems[1]?.directFocusMatch).toBe(false);
    expect(noPreferenceRadar.baselineEvents).toHaveLength(3);
    expect(noPreferenceRadar.radarItems).toEqual([]);
  });

  it("偏好变化只影响未来冻结结果，旧相关性评估继续绑定旧快照", async () => {
    const adapter = new ScriptedAssessmentAdapter([
      relevanceOutput(1, 4, "DIRECT"),
      JSON.stringify({
        relevance: dimension(1, "preference:COMPANY:000001.SZ", "RESEARCH_PREFERENCE"),
        matchedPreferences: [
          {
            targetType: "COMPANY",
            targetKey: "000001.SZ",
            level: "REGULAR",
            relation: "DIRECT",
          },
        ],
      }),
    ]);
    const service = new ResearchAssessmentService(adapter);
    const focused = await service.assessRelevance({
      userId: "user-1",
      eventRevision: eventRevision(1),
      preferenceSnapshot: preferenceSnapshot({ id: "snapshot-focus" }),
    });
    const regular = await service.assessRelevance({
      userId: "user-1",
      eventRevision: eventRevision(1),
      preferenceSnapshot: preferenceSnapshot({
        id: "snapshot-regular",
        contentHash:
          "sha256:2222222222222222222222222222222222222222222222222222222222222222",
        items: [
          { targetType: "COMPANY", targetKey: "000001.SZ", level: "REGULAR" },
        ],
      }),
    });

    expect(focused.assessment.preferenceSnapshotId).toBe("snapshot-focus");
    expect(regular.assessment.preferenceSnapshotId).toBe("snapshot-regular");
    expect(focused.assessment.directFocusMatch).toBe(true);
    expect(regular.assessment.directFocusMatch).toBe(false);
  });
});

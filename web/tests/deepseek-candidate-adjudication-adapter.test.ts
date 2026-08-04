import { describe, expect, it } from "vitest";
import type { CandidateAdjudicationOutput } from "~/server/application/research-production/candidate-production";
import type { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";
import { DeepSeekCandidateAdjudicationAdapter } from "~/server/infrastructure/research-production/deepseek-candidate-adjudication-adapter";

describe("DeepSeek 候选裁定适配器", () => {
  it("向模型提供足以生成合法晋级裁定的完整契约", async () => {
    const expected: CandidateAdjudicationOutput = {
      contractVersion: "candidate-adjudication-output.v1",
      candidate: { eventIdentityKey: "event-1", clusterKey: "cluster-1" },
      evidence: [
        {
          evidenceKey: "observation-revision:revision-1",
          evidenceRole: "CORE_FACT",
          sourceIdentityStatus: "VERIFIED",
          proofQualification: "QUALIFIED",
          independenceKey: "observation-revision:revision-1",
          citation: { source: "冻结观测", excerpt: "公司公告产能投产" },
        },
      ],
      adjudication: {
        outcome: "PROMOTE",
        title: "产能投产",
        summary: "公司公告新产能已经投产",
        occurredAt: "2026-08-04T00:00:00.000Z",
        knownAt: "2026-08-04T00:10:00.000Z",
        narrative: {
          impact: "供给能力发生变化",
          reasons: ["公司公告确认投产"],
          nextChecks: ["跟踪产能利用率"],
          risks: ["爬坡速度仍有不确定性"],
        },
        uncertainty: {},
        counterEvidence: {},
        claims: [
          {
            claimKey: "claim-1",
            claimType: "FACT",
            text: "新产能已经投产",
            isInference: false,
            evidenceKeys: ["observation-revision:revision-1"],
          },
        ],
        impacts: [
          {
            subjectType: "COMPANY",
            subjectKey: "300750",
            impactType: "DIRECT",
            materiality: "HIGH",
            path: ["新产能投产", "供给能力提升"],
          },
        ],
      },
    };
    let requestOptions:
      | { timeoutMs?: number; maxOutputTokens?: number }
      | undefined;
    const client = {
      completeContract: async (
        messages: Array<{ content: string }>,
        _fallback: unknown,
        _schema: unknown,
        options: { timeoutMs?: number; maxOutputTokens?: number },
      ) => {
        requestOptions = options;
        const prompt = messages.map((message) => message.content).join("\n");
        return prompt.includes('"eventIdentityKey"') &&
          prompt.includes('PROMOTE 必须提供') &&
          prompt.includes('FACT | RESEARCH_IMPLICATION') &&
          prompt.includes('evidenceKeys')
          ? expected
          : ({ adjudication: { outcome: "TECHNICAL_HOLD" } } as unknown);
      },
    } as unknown as DeepSeekClient;
    const adapter = new DeepSeekCandidateAdjudicationAdapter(client);

    const result = await adapter.adjudicate({
      contractVersion: "candidate-production-task.v1",
      triggerSource: "AUTHORITATIVE_OBSERVATION",
      candidateRuleVersion: "candidate-discovery.rules.v1",
      observationRevisionId: "revision-1",
      subject: { type: "COMPANY", key: "300750" },
      question: "是否构成实质研究事件",
      knownAt: "2026-08-04T00:10:00.000Z",
      evidence: [
        {
          evidenceKey: "observation-revision:revision-1",
          kind: "OBSERVATION_REVISION",
          observationRevisionId: "revision-1",
          summary: "公司公告产能投产",
        },
      ],
    });

    expect(result).toEqual(expected);
    expect(requestOptions?.timeoutMs).toBe(180_000);
    expect(requestOptions?.maxOutputTokens).toBe(32_768);
  });
});

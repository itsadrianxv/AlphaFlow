import type {
  CandidateAdjudicationAdapter,
  CandidateTaskInput,
} from "~/server/application/research-production/candidate-production";
import {
  candidateAdjudicationOutputSchema,
  type CandidateAdjudicationOutput,
} from "~/server/application/research-production/candidate-production";
import { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";

export class DeepSeekCandidateAdjudicationAdapter
  implements CandidateAdjudicationAdapter
{
  constructor(private readonly client = new DeepSeekClient()) {}

  async adjudicate(input: CandidateTaskInput) {
    return this.client.completeContract(
      [
        {
          role: "system",
          content: [
            "你负责研究事件候选发现与一次性三态裁定。",
            "只能依据冻结输入判断，不得新增证据、直接写库或选择分发渠道。",
            "输出必须满足 candidate-adjudication-output.v1；PROMOTE、DEFER、REJECT、TECHNICAL_HOLD 四态互斥。",
          ].join("\n"),
        },
        {
          role: "user",
          content: `冻结候选输入：${JSON.stringify(input)}`,
        },
      ],
      {
        contractVersion: "candidate-adjudication-output.v1",
        candidate: {
          eventIdentityKey: `technical-hold:${input.observationRevisionId ?? input.seedIdempotencyKey}`,
          clusterKey: `technical-hold:${input.subject.type}:${input.subject.key}`,
        },
        evidence: input.evidence.map((item) => ({
          evidenceKey: item.evidenceKey,
          evidenceRole: "CONTEXT" as const,
          sourceIdentityStatus: "UNKNOWN" as const,
          proofQualification: "NOT_QUALIFIED" as const,
          independenceKey: item.evidenceKey,
          citation: { source: "冻结候选输入", excerpt: item.summary },
        })),
        adjudication: {
          outcome: "TECHNICAL_HOLD",
          uncertainty: { reason: "模型未返回合法结构化裁定" },
          counterEvidence: {},
          claims: [],
          impacts: [],
        },
      } satisfies CandidateAdjudicationOutput,
      candidateAdjudicationOutputSchema,
      {
        model: "deepseek-v4-flash",
        maxOutputTokens: 4096,
        maxStructuredOutputRetries: 1,
      },
    );
  }
}

import type {
  CandidateAdjudicationAdapter,
  CandidateTaskInput,
} from "~/server/application/research-production/candidate-production";
import {
  type CandidateAdjudicationOutput,
  candidateAdjudicationOutputSchema,
} from "~/server/application/research-production/candidate-production";
import { DeepSeekClient } from "~/server/infrastructure/intelligence/deepseek-client";

const candidateAdjudicationContract = {
  contractVersion: "candidate-adjudication-output.v1",
  candidate: {
    eventIdentityKey: "用于同一现实变化去重的稳定身份",
    clusterKey: "候选簇稳定身份",
  },
  evidence: [
    {
      evidenceKey: "必须逐项原样引用冻结输入中的 evidenceKey",
      evidenceRole: "CORE_FACT | CONTEXT | COUNTER_EVIDENCE",
      sourceIdentityStatus: "VERIFIED | UNVERIFIED | UNKNOWN",
      proofQualification: "QUALIFIED | CORROBORATING_ONLY | NOT_QUALIFIED",
      independenceKey: "事实采集链身份",
      citation: { source: "来源说明", excerpt: "支持判断的原文或观测摘要" },
    },
  ],
  adjudication: {
    outcome: "PROMOTE | DEFER | REJECT | TECHNICAL_HOLD",
    title: "事件标题",
    summary: "事件摘要",
    occurredAt: "ISO 8601 时刻",
    knownAt: "ISO 8601 时刻",
    narrative: {
      impact: "研究影响",
      reasons: ["成立理由"],
      nextChecks: ["后续验证项"],
      risks: ["风险与反证"],
    },
    uncertainty: {},
    counterEvidence: {},
    claims: [
      {
        claimKey: "簇内唯一事实身份",
        claimType: "FACT | RESEARCH_IMPLICATION",
        text: "原子事实主张",
        isInference: false,
        evidenceKeys: ["至少一个冻结 evidenceKey"],
      },
    ],
    impacts: [
      {
        subjectType: "影响对象类型",
        subjectKey: "影响对象身份",
        impactType: "DIRECT | INDIRECT",
        materiality: "LOW | MEDIUM | HIGH",
        path: ["影响路径"],
      },
    ],
    observationWindowEndsAt: "DEFER 可使用的 ISO 8601 时刻",
    nextCheckAt: "DEFER 可使用的 ISO 8601 时刻",
  },
};

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
            "严格只返回一个 JSON 对象，不要 Markdown、解释文字或契约之外的字段。",
            `完整输出契约模板：${JSON.stringify(candidateAdjudicationContract)}`,
            "evidence 必须与冻结输入的 evidence 一一对应，不得遗漏、增加或改写 evidenceKey。",
            "PROMOTE 必须提供 title、summary、occurredAt、knownAt、narrative、至少一条 claims 和至少一个 impacts；每条 claim 的 evidenceKeys 必须引用冻结 evidence。",
            "DEFER 应说明 uncertainty，并在可判断时提供 observationWindowEndsAt 与 nextCheckAt。",
            "REJECT 应在 uncertainty 或 counterEvidence 中说明理由。只有模型或契约执行发生技术故障时才能使用 TECHNICAL_HOLD。",
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
        maxOutputTokens: 32_768,
        maxStructuredOutputRetries: 1,
        timeoutMs: 180_000,
      },
    );
  }
}

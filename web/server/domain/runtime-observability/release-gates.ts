import type { RuntimeReleaseCheck, RuntimeReleaseCheckStatus } from "./types";

/** Spec §16 的发布硬门槛。运行目标违约不属于这些硬门槛。 */
export const HARD_RELEASE_GATES = [
  "schema_and_types",
  "legacy_schema_migration",
  "provider_contract",
  "authoritative_history",
  "manifest_gating",
  "evidence_and_citations",
  "assessment_contract",
  "research_only",
  "agent_boundary",
  "inbox_before_external_delivery",
  "scheduler_and_resilience",
  "observability",
  "compliance_process",
] as const;

export type HardReleaseGate = (typeof HARD_RELEASE_GATES)[number];

export type RuntimeDegradationMode =
  | "NORMAL"
  | "RESEARCH_ONLY_DEGRADED"
  | "SERVE_PREVIOUS_SNAPSHOT"
  | "READY_WITH_LIMITATION"
  | "RETAIN_CANDIDATE"
  | "NO_NEW_DISTRIBUTION"
  | "BASELINE_ONLY"
  | "INBOX_ONLY"
  | "INBOX_ONLY_RETRY_EXTERNAL_COPY";

export type RuntimeDegradation = {
  mode: RuntimeDegradationMode;
  reason: string;
  preserveEvidence: true;
  preserveCitations: true;
  preserveDistributionGate: true;
  researchOnly: true;
};

const DEGRADATIONS = {
  NORMAL: {
    mode: "NORMAL",
    reason: "运行目标达标",
    preserveEvidence: true,
    preserveCitations: true,
    preserveDistributionGate: true,
    researchOnly: true,
  },
  HARD_GATE_FAILED: {
    mode: "RESEARCH_ONLY_DEGRADED",
    reason: "发布硬门槛失败，阻断发布并保持研究模式约束",
    preserveEvidence: true,
    preserveCitations: true,
    preserveDistributionGate: true,
    researchOnly: true,
  },
  RUNTIME_TARGET_BREACHED: {
    mode: "RESEARCH_ONLY_DEGRADED",
    reason: "运行目标失守，执行可观测确定性降级",
    preserveEvidence: true,
    preserveCitations: true,
    preserveDistributionGate: true,
    researchOnly: true,
  },
  REQUIRED_DATA_LATE: {
    mode: "SERVE_PREVIOUS_SNAPSHOT",
    reason: "必需数据未达目标截止点，继续服务旧当前快照",
    preserveEvidence: true,
    preserveCitations: true,
    preserveDistributionGate: true,
    researchOnly: true,
  },
  OPTIONAL_DATA_FAILED: {
    mode: "READY_WITH_LIMITATION",
    reason: "可选数据失败，生成带限制的新快照",
    preserveEvidence: true,
    preserveCitations: true,
    preserveDistributionGate: true,
    researchOnly: true,
  },
  EVENT_NORMALIZATION_FAILED: {
    mode: "RETAIN_CANDIDATE",
    reason: "事件规范化失败，只保留候选和技术记录",
    preserveEvidence: true,
    preserveCitations: true,
    preserveDistributionGate: true,
    researchOnly: true,
  },
  GLOBAL_ASSESSMENT_FAILED: {
    mode: "NO_NEW_DISTRIBUTION",
    reason: "全局评估失败，不创建新的简报或提醒",
    preserveEvidence: true,
    preserveCitations: true,
    preserveDistributionGate: true,
    researchOnly: true,
  },
  RELEVANCE_ASSESSMENT_FAILED: {
    mode: "BASELINE_ONLY",
    reason: "用户相关性评估失败，只保留专业市场基线",
    preserveEvidence: true,
    preserveCitations: true,
    preserveDistributionGate: true,
    researchOnly: true,
  },
  BRIEFING_FAILED: {
    mode: "INBOX_ONLY",
    reason: "简报生成失败，站内研究事件仍可读取",
    preserveEvidence: true,
    preserveCitations: true,
    preserveDistributionGate: true,
    researchOnly: true,
  },
  FEISHU_FAILED: {
    mode: "INBOX_ONLY_RETRY_EXTERNAL_COPY",
    reason: "Feishu 失败，只重试外部副本，不回滚站内记录",
    preserveEvidence: true,
    preserveCitations: true,
    preserveDistributionGate: true,
    researchOnly: true,
  },
} satisfies Record<string, RuntimeDegradation>;

export function resolveDeterministicDegradation(
  reason: keyof typeof DEGRADATIONS,
): RuntimeDegradation {
  const degradation = DEGRADATIONS[reason];
  if (!degradation) throw new Error(`不允许的运行降级原因: ${String(reason)}`);
  return { ...degradation };
}

export type ReleaseEvaluation = {
  allowed: boolean;
  hardGateFailures: HardReleaseGate[];
  manualChecks: HardReleaseGate[];
  runtimeBreaches: string[];
  runtimeDegradation: RuntimeDegradation;
};

function isFailure(status: RuntimeReleaseCheckStatus) {
  return (
    status === "FAIL" || status === "NOT_RUN" || status === "MANUAL_REQUIRED"
  );
}

export function evaluateRelease(input: {
  checks: readonly RuntimeReleaseCheck[];
  runtimeBreaches: readonly string[];
}): ReleaseEvaluation {
  const byId = new Map(input.checks.map((check) => [check.id, check]));
  const counts = new Map<string, number>();
  for (const check of input.checks) {
    counts.set(check.id, (counts.get(check.id) ?? 0) + 1);
  }
  const hardGateFailures: HardReleaseGate[] = [];
  const manualChecks: HardReleaseGate[] = [];

  for (const id of HARD_RELEASE_GATES) {
    const check = byId.get(id);
    if (
      !check ||
      counts.get(id) !== 1 ||
      isFailure(check.status) ||
      !check.evidence?.trim()
    ) {
      hardGateFailures.push(id);
    }
    if (check?.status === "MANUAL_REQUIRED") manualChecks.push(id);
  }

  const runtimeBreaches = [...new Set(input.runtimeBreaches)];
  const runtimeDegradation =
    hardGateFailures.length > 0 || runtimeBreaches.length > 0
      ? resolveDeterministicDegradation(
          hardGateFailures.length > 0
            ? "HARD_GATE_FAILED"
            : "RUNTIME_TARGET_BREACHED",
        )
      : resolveDeterministicDegradation("NORMAL");

  return {
    allowed: hardGateFailures.length === 0,
    hardGateFailures,
    manualChecks,
    runtimeBreaches,
    runtimeDegradation,
  };
}

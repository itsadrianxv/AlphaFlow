import type {
  TimingFeatureEvidence,
  TimingResearchRuleConfig,
  TimingResearchState,
  TimingRuleAudit,
  TimingRuleDefinition,
  TimingRuleEvaluation,
} from "~/server/domain/timing/types";

export const TIMING_RULE_ENGINE_VERSION = "timing-research-rule-engine-v3.0.0";
export const TIMING_FEATURE_VERSION = "timing-features-v2.0.0";

function compare(rule: TimingRuleDefinition, evidence: TimingFeatureEvidence) {
  const actual = evidence.value;
  const threshold = rule.threshold;
  if (actual === null || actual === undefined) return false;
  if (rule.operator === "==") return actual === threshold;
  if (typeof actual !== "number" || typeof threshold !== "number") return false;
  if (rule.operator === ">=") return actual >= threshold;
  if (rule.operator === ">") return actual > threshold;
  if (rule.operator === "<=") return actual <= threshold;
  if (rule.operator === "<") return actual < threshold;
  if (typeof evidence.previousValue !== "number") return false;
  return rule.operator === "crosses_above"
    ? evidence.previousValue <= threshold && actual > threshold
    : evidence.previousValue >= threshold && actual < threshold;
}

function evaluateRule(rule: TimingRuleDefinition, evidence?: TimingFeatureEvidence): TimingRuleEvaluation {
  const base = {
    ruleId: rule.id,
    ruleName: rule.name,
    role: rule.role,
    indicatorId: rule.indicatorId,
    timeframe: rule.timeframe,
    operator: rule.operator,
    threshold: rule.threshold,
    actual: evidence?.value ?? null,
    asOfDate: evidence?.asOfDate,
    source: evidence?.source,
    required: rule.required,
    severity: rule.severity,
    explanation: rule.explanation,
  };
  if (!evidence || evidence.status === "MISSING") return { ...base, status: "MISSING" as const };
  if (evidence.status === "STALE") return { ...base, status: "STALE" as const };
  if (evidence.status === "OBSERVATION_ONLY") return { ...base, status: "OBSERVATION_ONLY" as const };
  const confirmed = (evidence.consecutiveBars ?? 1) >= rule.confirmationBars;
  return { ...base, status: compare(rule, evidence) && confirmed ? "PASSED" as const : "FAILED" as const };
}

function featureKey(indicatorId: string, timeframe: string) {
  return `${indicatorId}:${timeframe}`;
}

export function evaluateTimingResearchRules(params: {
  config: TimingResearchRuleConfig;
  features: TimingFeatureEvidence[];
  strategyRevisionId?: string;
  configHash?: string;
}): TimingRuleAudit {
  const evidenceByKey = new Map(params.features.map((item) => [featureKey(item.indicatorId, item.timeframe), item]));
  const evaluations = params.config.ruleGroups.flatMap((group) =>
    group.rules
      .filter((rule) => rule.enabled)
      .map((rule) => evaluateRule(rule, evidenceByKey.get(featureKey(rule.indicatorId, rule.timeframe)))),
  );
  const groupResults = params.config.ruleGroups.map((group) => {
    const items = evaluations.filter((item) => item.role === group.role);
    const passed = items.filter((item) => item.status === "PASSED").length;
    const requiredItems = items.filter((item) => item.required);
    const missing = items.filter((item) => ["MISSING", "STALE", "OBSERVATION_ONLY"].includes(item.status)).length;
    return {
      role: group.role,
      passed,
      required: requiredItems.length,
      minSatisfied: group.minSatisfied,
      satisfied: requiredItems.every((item) => item.status === "PASSED") &&
        (group.role === "RISK_OBSERVATION" || passed >= group.minSatisfied),
      missing,
    };
  });

  const requiredMissing = evaluations.some(
    (item) => item.required && ["MISSING", "STALE", "OBSERVATION_ONLY"].includes(item.status),
  );
  const core = groupResults.find((item) => item.role === "CORE");
  const confirmation = groupResults.find((item) => item.role === "CONFIRMATION");
  const criticalRisk = evaluations.some(
    (item) => item.role === "RISK_OBSERVATION" && item.status === "PASSED" && item.severity === "CRITICAL",
  );
  let researchState: TimingResearchState;
  if (requiredMissing) researchState = "DATA_INCOMPLETE";
  else if (criticalRisk) researchState = "INVALIDATED";
  else if (!core?.satisfied) researchState = "NO_SETUP";
  else if (!confirmation?.satisfied) researchState = "FORMING";
  else researchState = "CONFIRMED";

  return {
    schemaVersion: 3,
    strategyRevisionId: params.strategyRevisionId,
    configHash: params.configHash,
    engineVersion: TIMING_RULE_ENGINE_VERSION,
    featureVersion: TIMING_FEATURE_VERSION,
    setup: params.config.setup,
    researchState,
    ruleEvaluations: evaluations,
    groupResults,
  };
}

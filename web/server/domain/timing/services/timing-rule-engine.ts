import type {
  TimingAction,
  TimingDecisionAudit,
  TimingFeatureEvidence,
  TimingMarketState,
  TimingPresetConfigV2,
  TimingRuleDefinition,
  TimingRuleEvaluation,
} from "~/server/domain/timing/types";

export const TIMING_RULE_ENGINE_VERSION = "timing-rule-engine-v2.0.0";
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
  if (rule.operator === "crosses_above") {
    return evidence.previousValue <= threshold && actual > threshold;
  }
  return evidence.previousValue >= threshold && actual < threshold;
}

function evaluateRule(
  rule: TimingRuleDefinition,
  evidence: TimingFeatureEvidence | undefined,
): TimingRuleEvaluation {
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
    vetoSeverity: rule.vetoSeverity,
    explanation: rule.explanation,
  } satisfies Omit<TimingRuleEvaluation, "status">;

  if (!evidence || evidence.status === "MISSING") return { ...base, status: "MISSING" };
  if (evidence.status === "STALE") return { ...base, status: "STALE" };
  if (evidence.status === "OBSERVATION_ONLY") {
    return { ...base, status: "OBSERVATION_ONLY" };
  }

  const passed = compare(rule, evidence);
  const confirmed = (evidence.consecutiveBars ?? 1) >= rule.confirmationBars;
  return { ...base, status: passed && confirmed ? "PASSED" : "FAILED" };
}

function featureKey(indicatorId: string, timeframe: string) {
  return `${indicatorId}:${timeframe}`;
}

function applyMarketGate(params: {
  action: TimingAction | null;
  marketState: TimingMarketState;
  config: TimingPresetConfigV2;
  trace: string[];
}) {
  if (!params.action) return null;
  if (
    params.marketState === "RISK_OFF" &&
    params.config.marketGate.riskOffBlockedActions.includes(
      params.action as "PROBE" | "ENTER" | "ADD",
    )
  ) {
    params.trace.push(`市场状态为RISK_OFF，${params.action}被执行门控阻止。`);
    return params.action === "ADD" ? "HOLD" : "WATCH";
  }
  if (params.marketState === "NEUTRAL" && params.action === "ENTER") {
    params.trace.push("市场状态为NEUTRAL，ENTER降级为PROBE。");
    return params.config.marketGate.neutralEntryAction;
  }
  if (params.marketState === "NEUTRAL" && params.action === "ADD") {
    params.trace.push("市场状态为NEUTRAL，ADD降级为HOLD。");
    return params.config.marketGate.neutralAddAction;
  }
  return params.action;
}

export function evaluateTimingRules(params: {
  config: TimingPresetConfigV2;
  features: TimingFeatureEvidence[];
  marketState: TimingMarketState;
  hasPosition: boolean;
  strategyRevisionId?: string;
  configHash?: string;
}): TimingDecisionAudit {
  const evidenceByKey = new Map(
    params.features.map((item) => [featureKey(item.indicatorId, item.timeframe), item]),
  );
  const evaluations = params.config.ruleGroups.flatMap((group) =>
    group.rules
      .filter((rule) => rule.enabled)
      .map((rule) => evaluateRule(rule, evidenceByKey.get(featureKey(rule.indicatorId, rule.timeframe)))),
  );
  const groupResults = params.config.ruleGroups.map((group) => {
    const items = evaluations.filter((item) => item.role === group.role);
    const passed = items.filter((item) => item.status === "PASSED").length;
    const requiredItems = items.filter((item) => item.required);
    const requiredPassed = requiredItems.every((item) => item.status === "PASSED");
    const missing = items.filter((item) => ["MISSING", "STALE", "OBSERVATION_ONLY"].includes(item.status)).length;
    return {
      role: group.role,
      passed,
      required: requiredItems.length,
      minSatisfied: group.minSatisfied,
      satisfied: requiredPassed && (group.role === "VETO" || passed >= group.minSatisfied),
      missing,
    };
  });

  const primary = groupResults.find((item) => item.role === "PRIMARY");
  const confirmation = groupResults.find((item) => item.role === "CONFIRMATION");
  const primaryMissing = evaluations.some(
    (item) => item.role === "PRIMARY" && ["MISSING", "STALE", "OBSERVATION_ONLY"].includes(item.status),
  );
  const vetoMissing = evaluations.some(
    (item) => item.role === "VETO" && ["MISSING", "STALE", "OBSERVATION_ONLY"].includes(item.status),
  );
  const triggeredVetos = evaluations.filter(
    (item) => item.role === "VETO" && item.status === "PASSED",
  );
  const criticalVeto = triggeredVetos.some((item) => item.vetoSeverity === "CRITICAL");
  const warningVeto = triggeredVetos.some((item) => item.vetoSeverity === "WARNING");

  let status: TimingDecisionAudit["status"];
  if (primaryMissing) status = "DATA_INCOMPLETE";
  else if (criticalVeto) status = "INVALIDATED";
  else if (!primary?.satisfied) status = "NOT_READY";
  else if (!confirmation?.satisfied) status = "FORMING";
  else status = "TRIGGERED";

  let potentialAction: TimingAction | null = null;
  if (status === "DATA_INCOMPLETE") potentialAction = null;
  else if (params.hasPosition) {
    if (status === "INVALIDATED") potentialAction = "EXIT";
    else if (warningVeto) potentialAction = "TRIM";
    else if (status === "TRIGGERED") potentialAction = "ADD";
    else potentialAction = "HOLD";
  } else if (status === "TRIGGERED") potentialAction = "ENTER";
  else potentialAction = "WATCH";

  const gateTrace: string[] = [];
  let finalAction = applyMarketGate({
    action: potentialAction,
    marketState: params.marketState,
    config: params.config,
    trace: gateTrace,
  });
  if (vetoMissing && finalAction && ["PROBE", "ENTER", "ADD"].includes(finalAction)) {
    gateTrace.push("否决项数据缺失，禁止增加风险暴露。");
    finalAction = params.hasPosition ? "HOLD" : "WATCH";
  }

  return {
    schemaVersion: 2,
    strategyRevisionId: params.strategyRevisionId,
    configHash: params.configHash,
    engineVersion: TIMING_RULE_ENGINE_VERSION,
    featureVersion: TIMING_FEATURE_VERSION,
    setup: params.config.setup,
    status,
    ruleEvaluations: evaluations,
    groupResults,
    riskUnresolved: vetoMissing,
    potentialAction,
    finalAction,
    gateTrace,
  };
}

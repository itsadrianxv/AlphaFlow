import type {
  TimingHorizonTemplate,
  TimingResearchRuleConfig,
  TimingRuleDefinition,
  TimingRuleGroupConfig,
  TimingRuleRole,
  TimingSetupType,
  TimingTimeframe,
} from "~/server/domain/timing/types";

export const TIMING_TIMEFRAME_TEMPLATES: Record<
  TimingHorizonTemplate,
  { contextTimeframes: TimingTimeframe[]; primaryTimeframe: TimingTimeframe }
> = {
  SHORT_SWING: { contextTimeframes: ["WEEKLY"], primaryTimeframe: "DAILY" },
  SWING: {
    contextTimeframes: ["MONTHLY", "WEEKLY"],
    primaryTimeframe: "DAILY",
  },
  MEDIUM_TERM: { contextTimeframes: ["MONTHLY"], primaryTimeframe: "WEEKLY" },
};

function rule(params: {
  id: string;
  name: string;
  indicatorId: string;
  role: TimingRuleRole;
  timeframe: TimingTimeframe;
  operator: TimingRuleDefinition["operator"];
  threshold: TimingRuleDefinition["threshold"];
  explanation: string;
  confirmationBars?: number;
  required?: boolean;
  severity?: TimingRuleDefinition["severity"];
}): TimingRuleDefinition {
  return {
    ...params,
    confirmationBars: params.confirmationBars ?? 1,
    required: params.required ?? false,
    enabled: true,
  };
}

function group(role: TimingRuleRole, minSatisfied: number, rules: TimingRuleDefinition[]): TimingRuleGroupConfig {
  return { role, minSatisfied, rules };
}

const tradabilityObservation = rule({
  id: "shared-tradability-observation",
  name: "可交易性异常",
  indicatorId: "market.tradable",
  role: "RISK_OBSERVATION",
  timeframe: "DAILY",
  operator: "==",
  threshold: false,
  required: true,
  severity: "CRITICAL",
  explanation: "停牌、无有效成交或价格限制会降低研究证据的可解释性。",
});

const SETUP_RULE_GROUPS: Record<TimingSetupType, TimingRuleGroupConfig[]> = {
  TREND_CONTINUATION: [
    group("CORE", 3, [
      rule({ id: "trend-weekly", name: "周线中期趋势", indicatorId: "trend.close_above_ema20", role: "CORE", timeframe: "WEEKLY", operator: "==", threshold: true, required: true, explanation: "完整周线位于 EMA20 上方。" }),
      rule({ id: "trend-daily", name: "日线趋势延续", indicatorId: "trend.close_above_ema20", role: "CORE", timeframe: "DAILY", operator: "==", threshold: true, confirmationBars: 2, required: true, explanation: "日线连续位于 EMA20 上方。" }),
      rule({ id: "trend-stack", name: "均线结构", indicatorId: "trend.ema20_above_ema60", role: "CORE", timeframe: "DAILY", operator: "==", threshold: true, required: true, explanation: "EMA20 位于 EMA60 上方。" }),
    ]),
    group("CONFIRMATION", 2, [
      rule({ id: "trend-adx", name: "趋势强度", indicatorId: "trend.adx", role: "CONFIRMATION", timeframe: "DAILY", operator: ">=", threshold: 20, explanation: "ADX 显示趋势具有一定持续性。" }),
      rule({ id: "trend-rs", name: "相对强弱", indicatorId: "relative_strength.return_20d", role: "CONFIRMATION", timeframe: "DAILY", operator: ">", threshold: 0, explanation: "20 日表现强于基准。" }),
      rule({ id: "trend-macd", name: "动量确认", indicatorId: "momentum.macd_histogram", role: "CONFIRMATION", timeframe: "DAILY", operator: ">", threshold: 0, explanation: "MACD 柱为正。" }),
    ]),
    group("RISK_OBSERVATION", 0, [
      rule({ id: "trend-break", name: "中期结构转弱", indicatorId: "trend.close_below_ema60", role: "RISK_OBSERVATION", timeframe: "DAILY", operator: "==", threshold: true, confirmationBars: 2, severity: "CRITICAL", explanation: "连续位于 EMA60 下方代表原趋势假设失效。" }),
      tradabilityObservation,
    ]),
  ],
  BREAKOUT: [
    group("CORE", 2, [
      rule({ id: "breakout-weekly", name: "周线趋势基础", indicatorId: "trend.close_above_ema20", role: "CORE", timeframe: "WEEKLY", operator: "==", threshold: true, required: true, explanation: "突破发生在完整周线趋势之上。" }),
      rule({ id: "breakout-high", name: "突破前高", indicatorId: "breakout.close_above_prior_high_20", role: "CORE", timeframe: "DAILY", operator: "==", threshold: true, required: true, explanation: "收盘价高于此前 20 日高点。" }),
    ]),
    group("CONFIRMATION", 2, [
      rule({ id: "breakout-volume", name: "成交确认", indicatorId: "liquidity.volume_ratio_20", role: "CONFIRMATION", timeframe: "DAILY", operator: ">=", threshold: 1.5, explanation: "量比达到 1.5。" }),
      rule({ id: "breakout-turnover", name: "换手确认", indicatorId: "liquidity.turnover_above_median_20", role: "CONFIRMATION", timeframe: "DAILY", operator: "==", threshold: true, explanation: "换手率高于近期中位数。" }),
      rule({ id: "breakout-rs", name: "相对强弱", indicatorId: "relative_strength.return_20d", role: "CONFIRMATION", timeframe: "DAILY", operator: ">", threshold: 0, explanation: "相对基准保持强势。" }),
    ]),
    group("RISK_OBSERVATION", 0, [
      rule({ id: "breakout-failure", name: "突破失败", indicatorId: "breakout.failed_within_2", role: "RISK_OBSERVATION", timeframe: "DAILY", operator: "==", threshold: true, severity: "CRITICAL", explanation: "突破后快速回落至原区间。" }),
      tradabilityObservation,
    ]),
  ],
  PULLBACK: [
    group("CORE", 2, [
      rule({ id: "pullback-weekly", name: "周线结构", indicatorId: "trend.close_above_ema20", role: "CORE", timeframe: "WEEKLY", operator: "==", threshold: true, required: true, explanation: "完整周线趋势仍在。" }),
      rule({ id: "pullback-recovery", name: "支撑恢复", indicatorId: "pullback.recovered_ema20_or_cost50", role: "CORE", timeframe: "DAILY", operator: "==", threshold: true, required: true, explanation: "价格回踩后重新回到参考结构上方。" }),
    ]),
    group("CONFIRMATION", 2, [
      rule({ id: "pullback-rsi", name: "动量恢复", indicatorId: "momentum.rsi12", role: "CONFIRMATION", timeframe: "DAILY", operator: ">=", threshold: 50, explanation: "RSI 回到中轴上方。" }),
      rule({ id: "pullback-volume", name: "量能恢复", indicatorId: "pullback.volume_recovery", role: "CONFIRMATION", timeframe: "DAILY", operator: "==", threshold: true, explanation: "回撤缩量后成交恢复。" }),
      rule({ id: "pullback-rs", name: "相对强弱", indicatorId: "relative_strength.return_20d", role: "CONFIRMATION", timeframe: "DAILY", operator: ">", threshold: 0, explanation: "相对基准结构未破坏。" }),
    ]),
    group("RISK_OBSERVATION", 0, [
      rule({ id: "pullback-break", name: "支撑结构失效", indicatorId: "trend.close_below_ema60", role: "RISK_OBSERVATION", timeframe: "DAILY", operator: "==", threshold: true, confirmationBars: 2, severity: "CRITICAL", explanation: "回撤已演变为中期结构破坏。" }),
      tradabilityObservation,
    ]),
  ],
  OVERSOLD_REVERSAL: [
    group("CORE", 2, [
      rule({ id: "reversal-sequence", name: "连续下行", indicatorId: "reversal.nine_down_count", role: "CORE", timeframe: "DAILY", operator: ">=", threshold: 8, explanation: "连续下行计数达到观察阈值。" }),
      rule({ id: "reversal-rsi", name: "动量超跌", indicatorId: "momentum.rsi12", role: "CORE", timeframe: "DAILY", operator: "<=", threshold: 30, explanation: "RSI 位于超跌区。" }),
      rule({ id: "reversal-chip", name: "低位结构", indicatorId: "chip.oversold_zone", role: "CORE", timeframe: "DAILY", operator: "==", threshold: true, explanation: "价格接近低分位成本区域。" }),
    ]),
    group("CONFIRMATION", 2, [
      rule({ id: "reversal-ema5", name: "短期结构改善", indicatorId: "trend.close_above_ema5", role: "CONFIRMATION", timeframe: "DAILY", operator: "==", threshold: true, explanation: "价格回到 EMA5 上方。" }),
      rule({ id: "reversal-macd", name: "动量改善", indicatorId: "momentum.macd_histogram_rising", role: "CONFIRMATION", timeframe: "DAILY", operator: "==", threshold: true, confirmationBars: 2, explanation: "MACD 柱连续改善。" }),
    ]),
    group("RISK_OBSERVATION", 0, [
      rule({ id: "reversal-new-low", name: "结构再度走弱", indicatorId: "reversal.new_low_after_confirmation", role: "RISK_OBSERVATION", timeframe: "DAILY", operator: "==", threshold: true, severity: "CRITICAL", explanation: "改善后再次创出阶段新低。" }),
      tradabilityObservation,
    ]),
  ],
};

export function createTimingResearchRuleConfig(
  setup: TimingSetupType,
  template: TimingHorizonTemplate = "SWING",
): TimingResearchRuleConfig {
  const timeframe = TIMING_TIMEFRAME_TEMPLATES[template];
  return structuredClone({
    schemaVersion: 3,
    setup,
    timeframePlan: { template, ...timeframe },
    ruleGroups: SETUP_RULE_GROUPS[setup],
    signalEngineWeights: {
      multiTimeframeAlignment: 0.24,
      relativeStrength: 0.2,
      volatilityPercentile: 0.14,
      liquidityStructure: 0.14,
      breakoutFailure: 0.14,
      gapVolumeQuality: 0.14,
    },
    dataPolicy: {
      asOfMode: "LATEST_COMPLETE",
      requiredMissing: "DATA_INCOMPLETE",
      unfinishedHigherTimeframe: "OBSERVATION_ONLY",
    },
  });
}

export function validateTimingResearchRuleConfig(config: TimingResearchRuleConfig) {
  const errors: string[] = [];
  if (config.schemaVersion !== 3) errors.push("研究规则配置版本必须为 3。");
  for (const role of ["CORE", "CONFIRMATION", "RISK_OBSERVATION"] as const) {
    if (!config.ruleGroups.some((item) => item.role === role)) errors.push(`缺少 ${role} 规则组。`);
  }
  for (const groupConfig of config.ruleGroups) {
    const enabled = groupConfig.rules.filter((item) => item.enabled);
    if (groupConfig.role !== "RISK_OBSERVATION" && (groupConfig.minSatisfied < 1 || groupConfig.minSatisfied > enabled.length)) {
      errors.push(`${groupConfig.role} 规则组的满足数量无效。`);
    }
    for (const item of enabled) {
      if (item.role !== groupConfig.role) errors.push(`规则 ${item.name} 的角色与规则组不一致。`);
      if (item.confirmationBars < 1 || item.confirmationBars > 20) errors.push(`规则 ${item.name} 的连续确认根数必须位于 1 到 20 之间。`);
    }
  }
  return errors;
}

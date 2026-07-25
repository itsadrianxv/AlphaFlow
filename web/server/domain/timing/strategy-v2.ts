import type {
  TimingHorizonTemplate,
  TimingPresetConfigV2,
  TimingRuleDefinition,
  TimingRuleGroupConfig,
  TimingRuleRole,
  TimingSetupType,
  TimingTimeframe,
  TimingTimeframePlan,
} from "~/server/domain/timing/types";

const BALANCED_MARKET_GATE: TimingPresetConfigV2["marketGate"] = {
  neutralEntryAction: "PROBE",
  neutralAddAction: "HOLD",
  riskOffBlockedActions: ["PROBE", "ENTER", "ADD"],
};

const DEFAULT_DATA_POLICY: TimingPresetConfigV2["dataPolicy"] = {
  asOfMode: "LATEST_COMPLETE",
  primaryMissing: "NO_DECISION",
  confirmationMissing: "KEEP_FORMING",
  vetoMissing: "BLOCK_NEW_EXPOSURE",
  unfinishedHigherTimeframe: "OBSERVATION_ONLY",
};

const DEFAULT_BACKTEST_POLICY: TimingPresetConfigV2["backtestPolicy"] = {
  minimumMonths: 24,
  minimumStocks: 5,
  minimumTriggeredEvents: 30,
  minimumPrimaryCompletenessPct: 95,
  slippageBps: 10,
  commissionBps: 3,
  sellTaxBps: 5,
};

export const TIMING_RISK_PROFILE_DEFAULTS = {
  STEADY: {
    maxSingleNamePct: 10,
    maxThemeExposurePct: 25,
    defaultProbePct: 2,
    maxPortfolioRiskBudgetPct: 15,
  },
  BALANCED: {
    maxSingleNamePct: 12,
    maxThemeExposurePct: 28,
    defaultProbePct: 3,
    maxPortfolioRiskBudgetPct: 20,
  },
  AGGRESSIVE: {
    maxSingleNamePct: 15,
    maxThemeExposurePct: 35,
    defaultProbePct: 5,
    maxPortfolioRiskBudgetPct: 30,
  },
} as const;

export const TIMING_TIMEFRAME_TEMPLATES: Record<
  TimingHorizonTemplate,
  TimingTimeframePlan & { reviewTradingDays: number[] }
> = {
  SHORT_SWING: {
    template: "SHORT_SWING",
    contextTimeframes: ["WEEKLY"],
    decisionTimeframe: "DAILY",
    executionTimeframe: "MINUTE_60",
    reviewTradingDays: [3, 5, 10],
  },
  SWING: {
    template: "SWING",
    contextTimeframes: ["MONTHLY", "WEEKLY"],
    decisionTimeframe: "DAILY",
    executionTimeframe: "MINUTE_60",
    fallbackExecutionTimeframe: "DAILY",
    reviewTradingDays: [5, 10, 20, 30],
  },
  MEDIUM_TERM: {
    template: "MEDIUM_TERM",
    contextTimeframes: ["MONTHLY"],
    decisionTimeframe: "WEEKLY",
    executionTimeframe: "DAILY",
    reviewTradingDays: [20, 40, 60],
  },
};

function rule(params: {
  id: string;
  name: string;
  indicatorId: string;
  role: TimingRuleRole;
  timeframe: TimingTimeframe;
  operator: TimingRuleDefinition["operator"];
  threshold: TimingRuleDefinition["threshold"];
  confirmationBars?: number;
  required?: boolean;
  vetoSeverity?: TimingRuleDefinition["vetoSeverity"];
  explanation: string;
}): TimingRuleDefinition {
  return {
    ...params,
    confirmationBars: params.confirmationBars ?? 1,
    required: params.required ?? false,
    enabled: true,
  };
}

const sharedLiquidityVeto = rule({
  id: "shared-tradable-veto",
  name: "可交易性检查",
  indicatorId: "market.tradable",
  role: "VETO",
  timeframe: "DAILY",
  operator: "==",
  threshold: false,
  required: true,
  vetoSeverity: "CRITICAL",
  explanation: "停牌、连续跌停或无有效成交时，不允许生成进攻动作。",
});

const SETUP_RULE_GROUPS: Record<TimingSetupType, TimingRuleGroupConfig[]> = {
  TREND_CONTINUATION: [
    {
      role: "PRIMARY",
      minSatisfied: 3,
      rules: [
        rule({
          id: "trend-weekly-close-ema20",
          name: "周线保持中期趋势",
          indicatorId: "trend.close_above_ema20",
          role: "PRIMARY",
          timeframe: "WEEKLY",
          operator: "==",
          threshold: true,
          required: true,
          explanation: "最后一根完整周线收盘价位于EMA20上方。",
        }),
        rule({
          id: "trend-daily-close-ema20",
          name: "日线站稳EMA20",
          indicatorId: "trend.close_above_ema20",
          role: "PRIMARY",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          confirmationBars: 2,
          required: true,
          explanation: "日线连续两个交易日收在EMA20上方。",
        }),
        rule({
          id: "trend-daily-ema-stack",
          name: "EMA20高于EMA60",
          indicatorId: "trend.ema20_above_ema60",
          role: "PRIMARY",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          confirmationBars: 2,
          required: true,
          explanation: "中短期均线维持多头排列。",
        }),
      ],
    },
    {
      role: "CONFIRMATION",
      minSatisfied: 2,
      rules: [
        rule({
          id: "trend-adx",
          name: "趋势强度确认",
          indicatorId: "trend.adx",
          role: "CONFIRMATION",
          timeframe: "DAILY",
          operator: ">=",
          threshold: 20,
          explanation: "ADX达到20并由方向指标确认趋势具备延续性。",
        }),
        rule({
          id: "trend-relative-strength",
          name: "20日相对强弱为正",
          indicatorId: "relative_strength.return_20d",
          role: "CONFIRMATION",
          timeframe: "DAILY",
          operator: ">",
          threshold: 0,
          explanation: "相对基准的20日超额收益为正。",
        }),
        rule({
          id: "trend-macd",
          name: "MACD动能确认",
          indicatorId: "momentum.macd_histogram",
          role: "CONFIRMATION",
          timeframe: "DAILY",
          operator: ">",
          threshold: 0,
          explanation: "MACD柱位于零轴上方。",
        }),
      ],
    },
    {
      role: "VETO",
      minSatisfied: 0,
      rules: [
        rule({
          id: "trend-ema60-veto",
          name: "连续跌破EMA60",
          indicatorId: "trend.close_below_ema60",
          role: "VETO",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          confirmationBars: 2,
          required: true,
          vetoSeverity: "CRITICAL",
          explanation: "连续两个交易日跌破EMA60意味着中期趋势失效。",
        }),
        sharedLiquidityVeto,
      ],
    },
  ],
  BREAKOUT: [
    {
      role: "PRIMARY",
      minSatisfied: 2,
      rules: [
        rule({
          id: "breakout-weekly-trend",
          name: "周线趋势向上",
          indicatorId: "trend.close_above_ema20",
          role: "PRIMARY",
          timeframe: "WEEKLY",
          operator: "==",
          threshold: true,
          required: true,
          explanation: "突破只在完整周线位于EMA20上方时有效。",
        }),
        rule({
          id: "breakout-donchian20",
          name: "突破前20日高点",
          indicatorId: "breakout.close_above_prior_high_20",
          role: "PRIMARY",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          required: true,
          explanation: "日线收盘价突破不含当日的前20日最高价。",
        }),
      ],
    },
    {
      role: "CONFIRMATION",
      minSatisfied: 2,
      rules: [
        rule({
          id: "breakout-volume",
          name: "突破量能",
          indicatorId: "liquidity.volume_ratio_20",
          role: "CONFIRMATION",
          timeframe: "DAILY",
          operator: ">=",
          threshold: 1.5,
          explanation: "成交量达到20日均量的1.5倍。",
        }),
        rule({
          id: "breakout-turnover",
          name: "换手活跃",
          indicatorId: "liquidity.turnover_above_median_20",
          role: "CONFIRMATION",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          explanation: "换手率高于过去20日中位数。",
        }),
        rule({
          id: "breakout-rs",
          name: "相对强弱确认",
          indicatorId: "relative_strength.return_20d",
          role: "CONFIRMATION",
          timeframe: "DAILY",
          operator: ">",
          threshold: 0,
          explanation: "20日超额收益为正。",
        }),
        rule({
          id: "breakout-auction",
          name: "开盘竞价质量",
          indicatorId: "auction.close_above_vwap",
          role: "CONFIRMATION",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          explanation: "盘后竞价证据显示集合竞价收盘价不弱于VWAP。",
        }),
      ],
    },
    {
      role: "VETO",
      minSatisfied: 0,
      rules: [
        rule({
          id: "breakout-failure",
          name: "突破快速失败",
          indicatorId: "breakout.failed_within_2",
          role: "VETO",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          required: true,
          vetoSeverity: "CRITICAL",
          explanation: "突破后两个交易日内收盘跌回突破位下方。",
        }),
        sharedLiquidityVeto,
      ],
    },
  ],
  PULLBACK: [
    {
      role: "PRIMARY",
      minSatisfied: 2,
      rules: [
        rule({
          id: "pullback-weekly-trend",
          name: "周线趋势完整",
          indicatorId: "trend.close_above_ema20",
          role: "PRIMARY",
          timeframe: "WEEKLY",
          operator: "==",
          threshold: true,
          required: true,
          explanation: "完整周线仍处于EMA20上方。",
        }),
        rule({
          id: "pullback-support-recovery",
          name: "回踩支撑后收复",
          indicatorId: "pullback.recovered_ema20_or_cost50",
          role: "PRIMARY",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          required: true,
          explanation: "价格触及EMA20或筹码中位成本后重新收复。",
        }),
      ],
    },
    {
      role: "CONFIRMATION",
      minSatisfied: 2,
      rules: [
        rule({
          id: "pullback-rsi",
          name: "RSI恢复",
          indicatorId: "momentum.rsi12",
          role: "CONFIRMATION",
          timeframe: "DAILY",
          operator: ">=",
          threshold: 50,
          explanation: "RSI12恢复到50及以上。",
        }),
        rule({
          id: "pullback-volume",
          name: "缩量后恢复成交",
          indicatorId: "pullback.volume_recovery",
          role: "CONFIRMATION",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          explanation: "回撤阶段缩量，收复支撑时成交恢复。",
        }),
        rule({
          id: "pullback-cost",
          name: "站上加权成本",
          indicatorId: "chip.close_above_weighted_cost",
          role: "CONFIRMATION",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          explanation: "标准化价格重新站上筹码加权平均成本。",
        }),
        rule({
          id: "pullback-rs",
          name: "相对强弱未破坏",
          indicatorId: "relative_strength.return_20d",
          role: "CONFIRMATION",
          timeframe: "DAILY",
          operator: ">",
          threshold: 0,
          explanation: "20日相对强弱保持为正。",
        }),
      ],
    },
    {
      role: "VETO",
      minSatisfied: 0,
      rules: [
        rule({
          id: "pullback-ema60-veto",
          name: "跌破EMA60",
          indicatorId: "trend.close_below_ema60",
          role: "VETO",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          confirmationBars: 2,
          required: true,
          vetoSeverity: "CRITICAL",
          explanation: "连续跌破EMA60表明回撤已演变为结构破坏。",
        }),
        rule({
          id: "pullback-cost15-veto",
          name: "跌破15分位成本",
          indicatorId: "chip.close_below_cost15",
          role: "VETO",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          confirmationBars: 2,
          vetoSeverity: "WARNING",
          explanation: "连续跌破低分位成本带表示筹码承接失败。",
        }),
        sharedLiquidityVeto,
      ],
    },
  ],
  OVERSOLD_REVERSAL: [
    {
      role: "PRIMARY",
      minSatisfied: 2,
      rules: [
        rule({
          id: "reversal-nine-turn",
          name: "九转下行序列",
          indicatorId: "reversal.nine_down_count",
          role: "PRIMARY",
          timeframe: "DAILY",
          operator: ">=",
          threshold: 8,
          explanation: "下九转计数达到8或9。",
        }),
        rule({
          id: "reversal-rsi",
          name: "RSI超跌",
          indicatorId: "momentum.rsi12",
          role: "PRIMARY",
          timeframe: "DAILY",
          operator: "<=",
          threshold: 30,
          explanation: "RSI12处于超跌区。",
        }),
        rule({
          id: "reversal-chip",
          name: "低胜率或低成本区",
          indicatorId: "chip.oversold_zone",
          role: "PRIMARY",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          explanation: "胜率不高于10%或价格接近15分位成本。",
        }),
      ],
    },
    {
      role: "CONFIRMATION",
      minSatisfied: 2,
      rules: [
        rule({
          id: "reversal-ema5",
          name: "收复EMA5",
          indicatorId: "trend.close_above_ema5",
          role: "CONFIRMATION",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          explanation: "价格重新站上短期均线。",
        }),
        rule({
          id: "reversal-macd",
          name: "MACD柱改善",
          indicatorId: "momentum.macd_histogram_rising",
          role: "CONFIRMATION",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          confirmationBars: 2,
          explanation: "MACD柱连续两日改善。",
        }),
        rule({
          id: "reversal-auction",
          name: "竞价转强",
          indicatorId: "auction.close_above_vwap",
          role: "CONFIRMATION",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          explanation: "集合竞价收盘价不弱于VWAP。",
        }),
      ],
    },
    {
      role: "VETO",
      minSatisfied: 0,
      rules: [
        rule({
          id: "reversal-new-low",
          name: "确认后再创新低",
          indicatorId: "reversal.new_low_after_confirmation",
          role: "VETO",
          timeframe: "DAILY",
          operator: "==",
          threshold: true,
          required: true,
          vetoSeverity: "CRITICAL",
          explanation: "反转确认后再创新低表示假设失效。",
        }),
        sharedLiquidityVeto,
      ],
    },
  ],
};

export function createTimingPresetConfigV2(
  setup: TimingSetupType,
  template: TimingHorizonTemplate = "SWING",
  riskProfile: TimingPresetConfigV2["riskProfile"] = "BALANCED",
): TimingPresetConfigV2 {
  const timeframe = TIMING_TIMEFRAME_TEMPLATES[template];
  const ruleGroups = structuredClone(SETUP_RULE_GROUPS[setup]);
  if (riskProfile === "STEADY") {
    for (const group of ruleGroups) {
      if (group.role === "CONFIRMATION") {
        group.minSatisfied = Math.min(
          group.rules.length,
          group.minSatisfied + 1,
        );
      }
      if (group.role !== "VETO") {
        for (const item of group.rules) {
          item.confirmationBars = Math.min(3, item.confirmationBars + 1);
        }
      }
    }
  } else if (riskProfile === "AGGRESSIVE") {
    for (const group of ruleGroups) {
      if (group.role === "CONFIRMATION") {
        group.minSatisfied = Math.max(1, group.minSatisfied - 1);
      }
      if (group.role !== "VETO") {
        for (const item of group.rules) item.confirmationBars = 1;
      }
    }
  }
  const marketGate =
    riskProfile === "STEADY"
      ? { ...BALANCED_MARKET_GATE, neutralEntryAction: "WATCH" as const }
      : riskProfile === "AGGRESSIVE"
        ? {
            ...BALANCED_MARKET_GATE,
            neutralEntryAction: "ENTER" as const,
            neutralAddAction: "ADD" as const,
          }
        : BALANCED_MARKET_GATE;
  return structuredClone({
    schemaVersion: 2,
    setup,
    riskProfile,
    timeframePlan: {
      template: timeframe.template,
      contextTimeframes: timeframe.contextTimeframes,
      decisionTimeframe: timeframe.decisionTimeframe,
      executionTimeframe: timeframe.executionTimeframe,
      fallbackExecutionTimeframe: timeframe.fallbackExecutionTimeframe,
    },
    ruleGroups,
    marketGate,
    dataPolicy: DEFAULT_DATA_POLICY,
    reviewTradingDays: timeframe.reviewTradingDays,
    backtestPolicy: DEFAULT_BACKTEST_POLICY,
  });
}

export function validateTimingPresetConfigV2(config: TimingPresetConfigV2) {
  const errors: string[] = [];
  if (config.schemaVersion !== 2) errors.push("策略配置版本必须为2。");
  if (config.reviewTradingDays.some((item) => item < 1 || item > 120)) {
    errors.push("复盘周期必须位于1到120个交易日之间。");
  }
  for (const group of config.ruleGroups) {
    const enabled = group.rules.filter((item) => item.enabled);
    if (
      group.role !== "VETO" &&
      (group.minSatisfied < 1 || group.minSatisfied > enabled.length)
    ) {
      errors.push(`${group.role}规则组的法定数无效。`);
    }
    for (const item of enabled) {
      if (item.role !== group.role)
        errors.push(`规则${item.name}的角色与规则组不一致。`);
      if (item.confirmationBars < 1 || item.confirmationBars > 20) {
        errors.push(`规则${item.name}的连续确认根数必须位于1到20之间。`);
      }
    }
  }
  return errors;
}

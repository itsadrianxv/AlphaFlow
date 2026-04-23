import type {
  TimingAction,
  TimingDirection,
  TimingMarketBreadthTrend,
  TimingMarketState,
  TimingMarketTransition,
  TimingMarketVolatilityTrend,
  TimingReviewHorizon,
  TimingReviewVerdict,
  TimingRiskFlag,
  TimingSignalEngineKey,
  TimingSignalMetricValue,
} from "~/modules/timing/server/domain/types";

const timingActionLabelMap: Record<TimingAction, string> = {
  WATCH: "观察",
  PROBE: "试仓",
  ADD: "加仓",
  HOLD: "持有",
  TRIM: "减仓",
  EXIT: "退出",
};

const timingDirectionLabelMap: Record<TimingDirection, string> = {
  bullish: "看多",
  neutral: "中性",
  bearish: "看空",
};

const timingSignalKeyLabelMap: Record<TimingSignalEngineKey, string> = {
  multiTimeframeAlignment: "多周期一致性",
  relativeStrength: "相对强弱",
  volatilityPercentile: "波动分位",
  liquidityStructure: "流动性结构",
  breakoutFailure: "突破有效性",
  gapVolumeQuality: "缺口与放量质量",
};

const timingMetricLabelMap: Record<string, string> = {
  bullishChecks: "看多信号数",
  bearishChecks: "看空信号数",
  return20d: "20日涨幅",
  excess20d: "20日超额收益",
  excess60d: "60日超额收益",
  stockReturn20d: "个股20日涨幅",
  stockReturn60d: "个股60日涨幅",
  volatilityPercentile: "波动分位",
  atrPercentile: "ATR 分位",
  atrRatio: "ATR 比率",
  volumeRatio20: "20日量比",
  amountPercentile: "成交额分位",
  turnoverRate: "换手率",
  turnoverPercentile: "换手率分位",
  failureRate: "失败率",
  distanceTo60dHighPct: "距60日高点",
  recentGapCount: "近期缺口数",
  latestVolumeRatio20: "最新 20 日量比",
  sampleSize: "样本数",
  positiveSampleSize: "正向样本数",
  negativeSampleSize: "负向样本数",
  indexAtrRatio: "指数 ATR 比率",
};

const timingMarketStateLabelMap: Record<TimingMarketState, string> = {
  RISK_ON: "风险偏好",
  NEUTRAL: "中性环境",
  RISK_OFF: "风险收缩",
};

const timingMarketTransitionLabelMap: Record<TimingMarketTransition, string> = {
  IMPROVING: "持续改善",
  STABLE: "维持稳定",
  DETERIORATING: "持续走弱",
  PIVOT_UP: "向上拐点",
  PIVOT_DOWN: "向下拐点",
};

const timingRiskFlagLabelMap: Record<TimingRiskFlag, string> = {
  HIGH_VOLATILITY: "高波动",
  OVERBOUGHT: "短线过热",
  OVERSOLD: "短线超跌",
  TREND_WEAKENING: "趋势转弱",
  HIGH_CORRELATION: "高相关性",
  CROWDING_RISK: "拥挤风险",
  EVENT_UNCERTAINTY: "事件不确定性",
  WEAK_RELATIVE_STRENGTH: "相对强度偏弱",
  THIN_LIQUIDITY: "流动性偏弱",
  FAILED_BREAKOUT: "突破失败",
  NEAR_INVALIDATION: "接近失效位",
};

const timingReviewHorizonLabelMap: Record<TimingReviewHorizon, string> = {
  T5: "T+5",
  T10: "T+10",
  T20: "T+20",
};

const timingReviewVerdictLabelMap: Record<TimingReviewVerdict, string> = {
  SUCCESS: "验证成功",
  MIXED: "结果分化",
  FAILURE: "验证失败",
};

const timingBreadthTrendLabelMap: Record<TimingMarketBreadthTrend, string> = {
  EXPANDING: "广度扩张",
  STALLING: "广度停滞",
  CONTRACTING: "广度收缩",
};

const timingVolatilityTrendLabelMap: Record<
  TimingMarketVolatilityTrend,
  string
> = {
  RISING: "波动抬升",
  STABLE: "波动稳定",
  FALLING: "波动回落",
};

const timingNodeLabelMap: Record<string, string> = {
  load_targets: "载入分析标的",
  fetch_signal_snapshots: "抓取信号快照",
  fetch_signal_snapshots_batch: "批量抓取信号快照",
  technical_signal_agent: "技术信号研判",
  timing_synthesis_agent: "综合择时结论",
  persist_cards: "写入择时卡片",
  load_watchlist_context: "载入自选股上下文",
  market_regime_agent: "市场环境判断",
  watchlist_risk_manager: "组合风险约束",
  watchlist_portfolio_manager: "组合动作建议",
  persist_recommendations: "写入组合建议",
  load_due_reviews: "载入待复盘任务",
  evaluate_outcomes: "评估实际结果",
  review_agent: "生成复盘结论",
  persist_reviews: "写入复盘记录",
  schedule_next_review: "安排下一次复盘",
};

function formatNumber(value: number, digits = 2) {
  return value.toFixed(digits).replace(/\.00$/, "");
}

export function formatTimingActionLabel(value: TimingAction | string) {
  return timingActionLabelMap[value as TimingAction] ?? value;
}

export function formatTimingDirectionLabel(value: TimingDirection | string) {
  return timingDirectionLabelMap[value as TimingDirection] ?? value;
}

export function formatTimingEngineLabel(value: TimingSignalEngineKey | string) {
  return timingSignalKeyLabelMap[value as TimingSignalEngineKey] ?? value;
}

export const formatTimingSignalKeyLabel = formatTimingEngineLabel;

export function formatTimingMetricLabel(value: string) {
  return timingMetricLabelMap[value] ?? value;
}

export function formatTimingMarketStateLabel(
  value: TimingMarketState | string,
) {
  return timingMarketStateLabelMap[value as TimingMarketState] ?? value;
}

export function formatTimingMarketTransitionLabel(
  value: TimingMarketTransition | string,
) {
  return (
    timingMarketTransitionLabelMap[value as TimingMarketTransition] ?? value
  );
}

export function formatTimingRiskFlagLabel(value: TimingRiskFlag | string) {
  return timingRiskFlagLabelMap[value as TimingRiskFlag] ?? value;
}

export function formatTimingReviewHorizonLabel(
  value: TimingReviewHorizon | string,
) {
  return timingReviewHorizonLabelMap[value as TimingReviewHorizon] ?? value;
}

export function formatTimingReviewVerdictLabel(
  value: TimingReviewVerdict | string,
) {
  return timingReviewVerdictLabelMap[value as TimingReviewVerdict] ?? value;
}

export function formatTimingBreadthTrendLabel(
  value: TimingMarketBreadthTrend | string,
) {
  return timingBreadthTrendLabelMap[value as TimingMarketBreadthTrend] ?? value;
}

export function formatTimingVolatilityTrendLabel(
  value: TimingMarketVolatilityTrend | string,
) {
  return (
    timingVolatilityTrendLabelMap[value as TimingMarketVolatilityTrend] ?? value
  );
}

export function formatTimingNodeLabel(value: string) {
  return timingNodeLabelMap[value] ?? value;
}

export function formatTimingMetricValue(
  metricKey: string,
  value: TimingSignalMetricValue,
) {
  if (value === null || value === undefined) {
    return "-";
  }

  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }

  if (typeof value !== "number") {
    return String(value);
  }

  if (
    metricKey.endsWith("Pct") ||
    metricKey.endsWith("Percentile") ||
    metricKey === "turnoverRate" ||
    metricKey === "failureRate" ||
    metricKey === "return20d" ||
    metricKey === "excess20d" ||
    metricKey === "excess60d" ||
    metricKey === "stockReturn20d" ||
    metricKey === "stockReturn60d"
  ) {
    return `${formatNumber(value)}%`;
  }

  return formatNumber(value);
}

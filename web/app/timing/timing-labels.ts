import type {
  TimingDimensionKey,
  TimingDimensionStatus,
  TimingDirection,
  TimingMarketBreadthTrend,
  TimingMarketState,
  TimingMarketTransition,
  TimingMarketVolatilityTrend,
  TimingResearchState,
  TimingRiskFlag,
  TimingSignalEngineKey,
  TimingTrendState,
} from "~/server/domain/timing/types";

const labels = {
  DATA_INCOMPLETE: "数据不完整",
  NO_SETUP: "暂无结构",
  FORMING: "结构形成中",
  CONFIRMED: "结构已确认",
  INVALIDATED: "结构已失效",
  UP_TREND: "上行趋势",
  RANGE: "区间整理",
  DOWN_TREND: "下行趋势",
  TRANSITION: "结构转换",
  POSITIVE: "积极",
  MIXED: "混合",
  NEGATIVE: "偏弱",
  UNAVAILABLE: "不可用",
  multiTimeframe: "多周期一致性",
  momentumTrend: "动量与趋势",
  priceVolume: "量价结构",
  relativeStrength: "相对强弱",
  volatility: "波动",
  liquidity: "流动性",
  RISK_ON: "RISK_ON",
  NEUTRAL: "NEUTRAL",
  RISK_OFF: "RISK_OFF",
  IMPROVING: "改善",
  STABLE: "稳定",
  DETERIORATING: "走弱",
  PIVOT_UP: "向上转折",
  PIVOT_DOWN: "向下转折",
  EXPANDING: "扩张",
  STALLING: "停滞",
  CONTRACTING: "收缩",
  RISING: "上升",
  FALLING: "下降",
  bullish: "偏强",
  neutral: "中性",
  bearish: "偏弱",
  HIGH_VOLATILITY: "高波动",
  OVERBOUGHT: "动量偏热",
  OVERSOLD: "动量偏弱",
  TREND_WEAKENING: "趋势走弱",
  HIGH_CORRELATION: "高相关",
  CROWDING_RISK: "暴露集中",
  EVENT_UNCERTAINTY: "事件不确定性",
  WEAK_RELATIVE_STRENGTH: "相对强度偏弱",
  THIN_LIQUIDITY: "流动性偏弱",
  FAILED_BREAKOUT: "突破结构失效",
  NEAR_STRUCTURE_CHANGE: "接近结构变化",
  multiTimeframeAlignment: "多周期一致性",
  volatilityPercentile: "波动分位",
  liquidityStructure: "流动性结构",
  breakoutFailure: "突破失效",
  gapVolumeQuality: "缺口与量能",
  kronosForecast: "模型预测",
} as const;

function formatLabel(value: string) {
  return labels[value as keyof typeof labels] ?? value;
}

export const formatTimingResearchStateLabel = (value: TimingResearchState | string) => formatLabel(value);
export const formatTimingTrendStateLabel = (value: TimingTrendState | string) => formatLabel(value);
export const formatTimingDimensionStatusLabel = (value: TimingDimensionStatus | string) => formatLabel(value);
export const formatTimingDimensionLabel = (value: TimingDimensionKey | string) => formatLabel(value);
export const formatTimingDirectionLabel = (value: TimingDirection | string) => formatLabel(value);
export const formatTimingEngineLabel = (value: TimingSignalEngineKey | string) => formatLabel(value);
export const formatTimingSignalKeyLabel = formatTimingEngineLabel;
export const formatTimingMarketStateLabel = (value: TimingMarketState | string) => formatLabel(value);
export const formatTimingMarketTransitionLabel = (value: TimingMarketTransition | string) => formatLabel(value);
export const formatTimingBreadthTrendLabel = (value: TimingMarketBreadthTrend | string) => formatLabel(value);
export const formatTimingVolatilityTrendLabel = (value: TimingMarketVolatilityTrend | string) => formatLabel(value);
export const formatTimingRiskFlagLabel = (value: TimingRiskFlag | string) => formatLabel(value);
export const formatTimingMetricLabel = formatLabel;

export function formatTimingNarrative(value?: string | null) {
  if (!value) return "";
  return value.replace(/Kronos/gi, "模型");
}

export function formatTimingMetricValue(value: unknown) {
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === "boolean") return value ? "是" : "否";
  return value == null ? "暂无" : String(value);
}

import type {
  TechnicalAssessment,
  TimingDimensionKey,
  TimingDimensionStatus,
  TimingEngineBreakdownItem,
  TimingIndicators,
  TimingObservationCondition,
  TimingResearchDimension,
  TimingRiskFlag,
  TimingSignalData,
  TimingSignalEngineKey,
  TimingTrendState,
} from "~/server/domain/timing/types";

const ENGINE_LABELS: Record<TimingSignalEngineKey, string> = {
  multiTimeframeAlignment: "多周期一致性",
  relativeStrength: "相对强弱",
  volatilityPercentile: "波动状态",
  liquidityStructure: "流动性结构",
  breakoutFailure: "突破结构",
  gapVolumeQuality: "量价结构",
};

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function dimensionStatus(score: number | null): TimingDimensionStatus {
  if (score === null) return "UNAVAILABLE";
  if (score >= 20) return "POSITIVE";
  if (score <= -20) return "NEGATIVE";
  return "MIXED";
}

function trendState(indicators: TimingIndicators): TimingTrendState {
  if (indicators.close > indicators.ema20 && indicators.ema20 > indicators.ema60) return "UP_TREND";
  if (indicators.close < indicators.ema20 && indicators.ema20 < indicators.ema60) return "DOWN_TREND";
  const distancePct = Math.abs(indicators.close / Math.max(indicators.ema20, 0.0001) - 1) * 100;
  return distancePct <= 2 ? "TRANSITION" : "RANGE";
}

function engineMap(snapshot: TimingSignalData) {
  return new Map(snapshot.signalContext.engines.map((item) => [item.key, item]));
}

function scoreOf(engines: Map<TimingSignalEngineKey, TimingSignalData["signalContext"]["engines"][number]>, keys: TimingSignalEngineKey[]) {
  const values = keys.map((key) => engines.get(key)?.score).filter((value): value is number => typeof value === "number");
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function buildDimension(params: {
  key: TimingDimensionKey;
  label: string;
  score: number | null;
  engines: Map<TimingSignalEngineKey, TimingSignalData["signalContext"]["engines"][number]>;
  engineKeys: TimingSignalEngineKey[];
  asOfDate: string;
}): TimingResearchDimension {
  const evidence = params.engineKeys.flatMap((key) => {
    const engine = params.engines.get(key);
    return engine ? [`${ENGINE_LABELS[key]}：${engine.detail}`] : [];
  });
  const limitations = params.engineKeys.flatMap((key) => params.engines.get(key)?.warnings ?? []);
  if (!evidence.length) limitations.push("当前数据未生成该维度的有效证据。");
  return {
    key: params.key,
    label: params.label,
    status: dimensionStatus(params.score),
    score: params.score,
    evidence,
    limitations: [...new Set(limitations)],
    dataAsOf: evidence.length ? params.asOfDate : null,
  };
}

function buildObservationConditions(indicators: TimingIndicators): TimingObservationCondition[] {
  const ema20Distance = round((indicators.close / Math.max(indicators.ema20, 0.0001) - 1) * 100);
  return [
    {
      id: "trend-above-ema20",
      kind: "CONFIRMATION",
      category: "TREND",
      label: "中期趋势结构",
      metric: "close_vs_ema20",
      operator: ">=",
      threshold: Number(indicators.ema20.toFixed(4)),
      actual: Number(indicators.close.toFixed(4)),
      status: indicators.close >= indicators.ema20 ? "MET" : ema20Distance >= -2 ? "NEAR" : "PENDING",
      severity: "INFO",
      explanation: "价格与 EMA20 的关系用于观察中期趋势结构是否保持。",
    },
    {
      id: "momentum-macd",
      kind: "CHANGE",
      category: "MOMENTUM",
      label: "动量方向变化",
      metric: "macd_histogram",
      operator: ">",
      threshold: 0,
      actual: indicators.macd.histogram,
      status: indicators.macd.histogram > 0 ? "MET" : Math.abs(indicators.macd.histogram) <= 0.05 ? "NEAR" : "PENDING",
      severity: "INFO",
      explanation: "MACD 柱跨越零轴代表动量结构发生变化，需要结合趋势证据复核。",
    },
    {
      id: "liquidity-volume",
      kind: "CONFIRMATION",
      category: "LIQUIDITY",
      label: "成交活跃度",
      metric: "volume_ratio_20",
      operator: ">=",
      threshold: 1.1,
      actual: indicators.volumeRatio20,
      status: indicators.volumeRatio20 >= 1.1 ? "MET" : indicators.volumeRatio20 >= 0.9 ? "NEAR" : "PENDING",
      severity: "INFO",
      explanation: "成交量相对近期均值的变化用于判断当前结构是否得到成交支持。",
    },
    {
      id: "volatility-expansion",
      kind: "RISK",
      category: "VOLATILITY",
      label: "短期波动扩张",
      metric: "realized_vol_20_vs_120",
      operator: ">=",
      threshold: 1.5,
      actual: round(indicators.realizedVol20 / Math.max(indicators.realizedVol120, 0.0001)),
      status: indicators.realizedVol20 >= indicators.realizedVol120 * 1.5 ? "MET" : "PENDING",
      severity: "WARNING",
      explanation: "短期波动显著高于长期波动时，技术证据的不确定性上升。",
    },
  ];
}

function riskFlags(snapshot: TimingSignalData): TimingRiskFlag[] {
  const flags: TimingRiskFlag[] = [];
  const indicators = snapshot.indicators;
  if (indicators.rsi.value >= 72) flags.push("OVERBOUGHT");
  if (indicators.rsi.value <= 28) flags.push("OVERSOLD");
  if (indicators.close < indicators.ema20) flags.push("TREND_WEAKENING");
  if (indicators.realizedVol20 > indicators.realizedVol120 * 1.5) flags.push("HIGH_VOLATILITY");
  for (const engine of snapshot.signalContext.engines) {
    for (const warning of engine.warnings) {
      if (warning.includes("liquid")) flags.push("THIN_LIQUIDITY");
      if (warning.includes("breakout")) flags.push("FAILED_BREAKOUT");
    }
  }
  return [...new Set(flags)];
}

export class TimingAnalysisService {
  buildTechnicalAssessments(signalSnapshots: TimingSignalData[]): TechnicalAssessment[] {
    return signalSnapshots.map((snapshot) => {
      const engines = engineMap(snapshot);
      const breakdown: TimingEngineBreakdownItem[] = snapshot.signalContext.engines.map((engine) => ({
        key: engine.key,
        label: engine.label,
        status: engine.score >= 20 ? "positive" : engine.score <= -20 ? "negative" : "neutral",
        score: round(engine.score),
        confidence: round(engine.confidence),
        weight: round(engine.weight),
        detail: engine.detail,
      }));
      const dimensions = [
        buildDimension({ key: "multiTimeframe", label: "多周期一致性", score: scoreOf(engines, ["multiTimeframeAlignment"]), engines, engineKeys: ["multiTimeframeAlignment"], asOfDate: snapshot.asOfDate }),
        buildDimension({ key: "momentumTrend", label: "动量与趋势", score: round((snapshot.signalContext.composite.score + (snapshot.indicators.macd.histogram > 0 ? 20 : -20)) / 2), engines, engineKeys: ["multiTimeframeAlignment"], asOfDate: snapshot.asOfDate }),
        buildDimension({ key: "priceVolume", label: "量价结构", score: scoreOf(engines, ["gapVolumeQuality", "breakoutFailure"]), engines, engineKeys: ["gapVolumeQuality", "breakoutFailure"], asOfDate: snapshot.asOfDate }),
        buildDimension({ key: "relativeStrength", label: "相对强弱", score: scoreOf(engines, ["relativeStrength"]), engines, engineKeys: ["relativeStrength"], asOfDate: snapshot.asOfDate }),
        buildDimension({ key: "volatility", label: "波动", score: scoreOf(engines, ["volatilityPercentile"]), engines, engineKeys: ["volatilityPercentile"], asOfDate: snapshot.asOfDate }),
        buildDimension({ key: "liquidity", label: "流动性", score: scoreOf(engines, ["liquidityStructure"]), engines, engineKeys: ["liquidityStructure"], asOfDate: snapshot.asOfDate }),
      ];
      const compositeScore = round(snapshot.signalContext.composite.score);
      const availableDimensions = dimensions.filter((item) => item.status !== "UNAVAILABLE").length;
      return {
        stockCode: snapshot.stockCode,
        stockName: snapshot.stockName,
        asOfDate: snapshot.asOfDate,
        researchState: availableDimensions < 4 ? "DATA_INCOMPLETE" : compositeScore >= 20 ? "CONFIRMED" : compositeScore > 0 ? "FORMING" : "NO_SETUP",
        trendState: trendState(snapshot.indicators),
        compositeScore,
        confidence: round(snapshot.signalContext.composite.confidence),
        dimensions,
        observationConditions: buildObservationConditions(snapshot.indicators),
        riskFlags: riskFlags(snapshot),
        summary: `综合技术结构得分 ${compositeScore.toFixed(1)}，${availableDimensions} 个研究维度具备有效证据。`,
        explanation: "研究状态仅描述当前技术结构，不构成交易动作或仓位建议。",
        engineBreakdown: breakdown,
      };
    });
  }
}

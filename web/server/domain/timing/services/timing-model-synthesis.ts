import type {
  TimingDirection,
  TimingForecastSet,
  TimingModelEvidence,
  TimingResearchDimension,
  TimingResearchState,
} from "~/server/domain/timing/types";

const CONFIRMING_CONFIDENCE_BONUS = 0.08;
const CONFLICTING_CONFIDENCE_PENALTY = 0.15;
const MATERIAL_MODEL_CONFIDENCE = 0.65;

function clampConfidence(value: number) {
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100));
}

export function synthesizeTimingResearchWithModel(params: {
  technicalState: TimingResearchState;
  technicalConfidence: number;
  technicalDirection: TimingDirection;
  forecasts: TimingForecastSet;
}): {
  researchState: TimingResearchState;
  confidence: number;
  evidence: TimingModelEvidence;
  dimension: TimingResearchDimension;
} {
  const daily = params.forecasts.DAILY?.forecast;
  const availableTimeframes = Object.keys(params.forecasts) as Array<
    keyof TimingForecastSet
  >;
  if (!daily) {
    return {
      researchState: params.technicalState,
      confidence: params.technicalConfidence,
      evidence: {
        status: "PREDICTION_FAILED",
        inputBars: 0,
        requestedTimeframes: ["DAILY"],
        availableTimeframes: [],
        message: "Kronos 日线预测不可用，研究状态仅依据技术证据。",
        retryable: true,
        alignment: "UNAVAILABLE",
        timeframeConsistency: "UNAVAILABLE",
        confidenceAdjustment: 0,
        timeframeResults: {},
      } satisfies TimingModelEvidence,
      dimension: {
        key: "modelForecast",
        label: "模型预测",
        status: "UNAVAILABLE",
        score: null,
        evidence: [] as string[],
        limitations: ["Kronos 日线预测不可用，研究状态仅依据技术证据。"],
        dataAsOf: null,
      },
    };
  }

  const summary = daily.summary;
  const mediumTerm =
    params.forecasts.WEEKLY?.forecast ?? params.forecasts.MONTHLY?.forecast;
  const timeframeConsistency = mediumTerm
    ? mediumTerm.summary.direction === summary.direction
      ? "CONSISTENT"
      : "DIVERGENT"
    : "SINGLE_TIMEFRAME";
  const material = summary.confidence >= MATERIAL_MODEL_CONFIDENCE;
  const confirming =
    material &&
    summary.direction !== "neutral" &&
    summary.direction === params.technicalDirection;
  const conflicting =
    material &&
    ((params.technicalDirection === "bullish" &&
      (summary.direction === "bearish" ||
        summary.expectedReturnPct <= -3 ||
        summary.maxDrawdownPct <= -10)) ||
      (params.technicalDirection === "bearish" &&
        (summary.direction === "bullish" || summary.expectedReturnPct >= 3)));
  const confidenceAdjustment = conflicting
    ? -CONFLICTING_CONFIDENCE_PENALTY
    : confirming
      ? CONFIRMING_CONFIDENCE_BONUS
      : 0;
  const researchState =
    conflicting && params.technicalState === "CONFIRMED"
      ? "FORMING"
      : params.technicalState;
  const alignment = conflicting
    ? "CONFLICTING"
    : confirming
      ? "CONFIRMING"
      : "NEUTRAL";

  return {
    researchState,
    confidence: clampConfidence(
      params.technicalConfidence + confidenceAdjustment,
    ),
    evidence: {
      status: "AVAILABLE",
      inputBars: daily.lookbackBars,
      requestedTimeframes: ["DAILY"],
      availableTimeframes,
      message: `${
        conflicting
          ? "模型预测与技术结构明显冲突，研究状态和置信度已按集中策略降级。"
          : confirming
            ? "模型预测与技术结构同向，置信度已按集中策略提高。"
            : "模型预测未形成足以调整技术结论的明确方向。"
      } ${timeframeConsistency === "CONSISTENT" ? "日线与中期模型方向一致。" : timeframeConsistency === "DIVERGENT" ? "日线与中期模型方向存在分歧。" : "当前仅有日线模型预测。"}`,
      retryable: false,
      alignment,
      timeframeConsistency,
      confidenceAdjustment,
      timeframeResults: {},
    } satisfies TimingModelEvidence,
    dimension: {
      key: "modelForecast",
      label: "模型预测",
      status:
        alignment === "CONFIRMING"
          ? "POSITIVE"
          : alignment === "CONFLICTING"
            ? "NEGATIVE"
            : "MIXED",
      score: summary.confidence * 100,
      evidence: [
        `方向：${summary.direction}`,
        `预期变化：${summary.expectedReturnPct.toFixed(2)}%`,
        `最大预测回撤：${summary.maxDrawdownPct.toFixed(2)}%`,
      ],
      limitations: [
        timeframeConsistency === "DIVERGENT"
          ? "日线与中期模型方向存在分歧。"
          : "模型预测不能脱离技术证据单独确认研究状态。",
      ],
      dataAsOf: daily.asOfDate,
    },
  };
}

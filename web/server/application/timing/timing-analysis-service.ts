import { resolveTimingPresetConfig } from "~/server/domain/timing/preset";
import { TimingActionPolicy } from "~/server/domain/timing/services/timing-action-policy";
import { TimingConfidencePolicy } from "~/server/domain/timing/services/timing-confidence-policy";
import type {
  TechnicalAssessment,
  TimingCardDraft,
  TimingEngineBreakdownItem,
  TimingExecutionCondition,
  TimingIndicators,
  TimingPresetConfig,
  TimingRiskFlag,
  TimingSignalData,
  TimingSignalEngineResult,
  TimingSourceType,
} from "~/server/domain/timing/types";
import { TechnicalSignalSet } from "~/server/domain/timing/value-objects/technical-signal-set";

const actionLabelMap = {
  WATCH: "观望",
  PROBE: "试仓",
  ADD: "加仓",
  HOLD: "持有",
  TRIM: "减仓",
  EXIT: "卖出",
} as const;

function formatActionLabel(action: keyof typeof actionLabelMap) {
  return actionLabelMap[action] ?? action;
}

function uniqueFlags(flags: string[]): TimingRiskFlag[] {
  return [...new Set(flags)].filter((flag): flag is TimingRiskFlag =>
    [
      "HIGH_VOLATILITY",
      "OVERBOUGHT",
      "OVERSOLD",
      "TREND_WEAKENING",
      "HIGH_CORRELATION",
      "CROWDING_RISK",
      "EVENT_UNCERTAINTY",
      "WEAK_RELATIVE_STRENGTH",
      "THIN_LIQUIDITY",
      "FAILED_BREAKOUT",
      "NEAR_INVALIDATION",
    ].includes(flag),
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function summarizeBreakdownLabel(item: TimingEngineBreakdownItem) {
  return `${item.label}: ${item.detail}`;
}

function formatConditionNote(condition: TimingExecutionCondition) {
  const actual =
    condition.actual === undefined || condition.actual === null
      ? ""
      : `当前 ${condition.actual}${condition.unit ?? ""}，`;
  return `${condition.label}: ${actual}${condition.explanation}`;
}

function categoryForEngine(
  key: TimingEngineBreakdownItem["key"],
): TimingExecutionCondition["category"] {
  switch (key) {
    case "multiTimeframeAlignment":
      return "TREND";
    case "relativeStrength":
      return "RELATIVE_STRENGTH";
    case "liquidityStructure":
    case "gapVolumeQuality":
      return "LIQUIDITY";
    case "breakoutFailure":
      return "BREAKOUT";
    case "volatilityPercentile":
      return "VOLATILITY";
    default:
      return "TREND";
  }
}

function conditionSeverity(
  score: number,
): TimingExecutionCondition["severity"] {
  if (Math.abs(score) >= 55) {
    return "CRITICAL";
  }
  if (Math.abs(score) >= 30) {
    return "WARNING";
  }
  return "INFO";
}

function buildTriggerConditions(
  breakdown: TimingEngineBreakdownItem[],
  indicators: TimingIndicators,
) {
  const positive = breakdown
    .filter((item) => item.status === "positive")
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)
    .map(
      (item): TimingExecutionCondition => ({
        id: `trigger:${item.key}`,
        kind: "TRIGGER",
        category: categoryForEngine(item.key),
        label: item.label,
        metric: item.key,
        operator: ">=",
        threshold: 20,
        actual: item.score,
        lookbackDays: 20,
        status: "TRIGGERED",
        severity: conditionSeverity(item.score),
        explanation: item.detail,
      }),
    );

  if (
    indicators.close >= indicators.ema20 &&
    indicators.ema20 >= indicators.ema60
  ) {
    positive.unshift({
      id: "trigger:price-above-ema20-ema60",
      kind: "TRIGGER",
      category: "TREND",
      label: "价格站上中期均线",
      metric: "close_vs_ema20_ema60",
      operator: ">=",
      threshold: "ema20 >= ema60",
      actual: `${indicators.close}/${indicators.ema20}/${indicators.ema60}`,
      status: "TRIGGERED",
      severity: "INFO",
      explanation:
        "收盘价位于 EMA20 上方，且 EMA20 不弱于 EMA60，趋势结构具备继续观察价值。",
    });
  }

  if (indicators.volumeRatio20 >= 1.1) {
    positive.push({
      id: "trigger:volume-ratio20",
      kind: "TRIGGER",
      category: "LIQUIDITY",
      label: "成交量能确认",
      metric: "volumeRatio20",
      operator: ">=",
      threshold: 1.1,
      actual: indicators.volumeRatio20,
      status: "TRIGGERED",
      severity: "INFO",
      explanation: "20 日量比高于 1.1，说明当前信号有一定成交配合。",
    });
  }

  return positive.slice(0, 4);
}

function buildInvalidationConditions(
  breakdown: TimingEngineBreakdownItem[],
  indicators: TimingIndicators,
) {
  const negative = breakdown
    .filter((item) => item.status === "negative")
    .sort((left, right) => left.score - right.score)
    .slice(0, 3)
    .map(
      (item): TimingExecutionCondition => ({
        id: `invalidation:${item.key}`,
        kind: "INVALIDATION",
        category: categoryForEngine(item.key),
        label: item.label,
        metric: item.key,
        operator: "<=",
        threshold: -20,
        actual: item.score,
        lookbackDays: 20,
        status: "TRIGGERED",
        severity: conditionSeverity(item.score),
        explanation: item.detail,
      }),
    );

  const ema20BufferPct =
    (indicators.close / Math.max(indicators.ema20, 0.0001) - 1) * 100;
  negative.unshift({
    id: "invalidation:close-below-ema20",
    kind: "INVALIDATION",
    category: "PRICE_LEVEL",
    label: "跌破 EMA20",
    metric: "close_vs_ema20",
    operator: "<",
    threshold: Number(indicators.ema20.toFixed(4)),
    actual: Number(indicators.close.toFixed(4)),
    unit: "",
    lookbackDays: 2,
    status:
      indicators.close < indicators.ema20
        ? "TRIGGERED"
        : ema20BufferPct <= 2
          ? "NEAR"
          : "PENDING",
    severity: indicators.close < indicators.ema20 ? "CRITICAL" : "WARNING",
    explanation:
      indicators.close < indicators.ema20
        ? "收盘价已经跌破 EMA20，本次择时假设需要重评。"
        : "若连续收盘跌破 EMA20，趋势假设需要重评。",
  });

  if (indicators.close <= indicators.ema60 || indicators.rsi.value <= 35) {
    negative.push({
      id: "invalidation:trend-or-momentum-break",
      kind: "INVALIDATION",
      category: "TREND",
      label: "趋势或动能破坏",
      metric: "close_vs_ema60_or_rsi",
      operator: "<=",
      threshold: "close<=ema60 或 RSI<=35",
      actual: `close ${indicators.close} / ema60 ${indicators.ema60} / RSI ${indicators.rsi.value}`,
      status: "TRIGGERED",
      severity: "CRITICAL",
      explanation:
        "中期均线或动能指标已经进入防守区，继续执行进攻动作需要降级。",
    });
  }

  return negative.slice(0, 4);
}

function toStatus(score: number): TimingEngineBreakdownItem["status"] {
  if (score >= 20) {
    return "positive";
  }
  if (score <= -20) {
    return "negative";
  }
  return "neutral";
}

function scaleEngineScore(
  engine: TimingSignalEngineResult,
  nextWeight: number,
) {
  if (engine.weight <= 0) {
    return engine.score;
  }

  return clamp((engine.score * nextWeight) / engine.weight, -100, 100);
}

export class TimingAnalysisService {
  constructor(
    private readonly deps: {
      confidencePolicy?: TimingConfidencePolicy;
      actionPolicy?: TimingActionPolicy;
    } = {},
  ) {}

  private get confidencePolicy() {
    return this.deps.confidencePolicy ?? new TimingConfidencePolicy();
  }

  private get actionPolicy() {
    return this.deps.actionPolicy ?? new TimingActionPolicy();
  }

  buildTechnicalAssessments(
    signalSnapshots: TimingSignalData[],
    presetConfig?: TimingPresetConfig,
  ) {
    return signalSnapshots.map((snapshot) =>
      this.buildAssessment(snapshot, presetConfig),
    );
  }

  buildCards(params: {
    userId: string;
    workflowRunId?: string;
    sourceType: TimingSourceType;
    sourceId: string;
    watchListId?: string;
    presetId?: string;
    presetConfig?: TimingPresetConfig;
    signalSnapshots: TimingSignalData[];
    technicalAssessments: TechnicalAssessment[];
    hasPortfolioContext?: boolean;
  }): TimingCardDraft[] {
    const snapshotByCode = new Map(
      params.signalSnapshots.map((snapshot) => [snapshot.stockCode, snapshot]),
    );

    return params.technicalAssessments.map((assessment) => {
      const snapshot = snapshotByCode.get(assessment.stockCode);

      if (!snapshot) {
        throw new Error(`Missing timing snapshot for ${assessment.stockCode}`);
      }

      const actionBias = this.actionPolicy.decide(
        {
          direction: assessment.direction,
          confidence: assessment.confidence,
          signalStrength: assessment.signalStrength,
          hasPortfolioContext: params.hasPortfolioContext,
        },
        params.presetConfig,
      );

      const actionRationale =
        actionBias === "ADD"
          ? "多周期、相对强弱与结构质量同步支持进攻型动作。"
          : actionBias === "PROBE"
            ? "信号已具备试仓条件，但仍需观察市场与位置上下文的确认。"
            : actionBias === "WATCH"
              ? "当前更适合维持观察，等待结构或环境进一步改善。"
              : actionBias === "TRIM"
                ? "信号与风险提示开始偏向防守，适合先收缩风险暴露。"
                : actionBias === "EXIT"
                  ? "负向结构已超过容错区间，应优先退出。"
                  : "当前信号更偏向持有与等待。";

      return {
        userId: params.userId,
        workflowRunId: params.workflowRunId,
        watchListId: params.watchListId,
        presetId: params.presetId,
        stockCode: assessment.stockCode,
        stockName: assessment.stockName,
        asOfDate: assessment.asOfDate,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        actionBias,
        confidence: assessment.confidence,
        summary: `${assessment.stockName} 当前偏向 ${formatActionLabel(actionBias)}，核心依据是 ${assessment.signalContext.summary}`,
        triggerNotes: assessment.triggerNotes,
        invalidationNotes: assessment.invalidationNotes,
        riskFlags: assessment.riskFlags,
        reasoning: {
          signalContext: assessment.signalContext,
          actionRationale,
          indicators: snapshot.indicators,
        },
      };
    });
  }

  private buildAssessment(
    snapshot: TimingSignalData,
    presetConfig?: TimingPresetConfig,
  ): TechnicalAssessment {
    const resolvedPresetConfig = resolveTimingPresetConfig(presetConfig);
    const indicators = TechnicalSignalSet.create(
      snapshot.indicators,
    ).toObject();

    const engineBreakdown = snapshot.signalContext.engines.map((engine) => {
      const nextWeight =
        resolvedPresetConfig.signalEngineWeights?.[engine.key] ?? engine.weight;
      const nextScore = scaleEngineScore(engine, nextWeight);

      return {
        key: engine.key,
        label: engine.label,
        status: toStatus(nextScore),
        score: Math.round(nextScore),
        confidence: Math.round(engine.confidence * 100) / 100,
        weight: Math.round(nextWeight * 100) / 100,
        detail: engine.detail,
      } satisfies TimingEngineBreakdownItem;
    });

    const weightedScoreNumerator = engineBreakdown.reduce(
      (sum, item) => sum + item.score * item.weight * item.confidence,
      0,
    );
    const weightedScoreDenominator = engineBreakdown.reduce(
      (sum, item) => sum + item.weight * item.confidence,
      0,
    );
    const compositeScore =
      weightedScoreDenominator > 0
        ? weightedScoreNumerator / weightedScoreDenominator
        : snapshot.signalContext.composite.score;
    const direction =
      compositeScore > 20
        ? "bullish"
        : compositeScore < -20
          ? "bearish"
          : "neutral";
    const signalStrength = Math.round(Math.abs(compositeScore));

    const riskFlags = uniqueFlags(
      snapshot.signalContext.engines.flatMap((engine) => engine.warnings),
    );
    if (indicators.rsi.value >= 72) {
      riskFlags.push("OVERBOUGHT");
    }
    if (indicators.rsi.value <= 28) {
      riskFlags.push("OVERSOLD");
    }
    if (
      indicators.close < indicators.ema20 ||
      snapshot.signalContext.composite.score <= -20
    ) {
      riskFlags.push("TREND_WEAKENING");
    }

    const confidence = this.confidencePolicy.calculate(
      {
        direction,
        signalStrength,
        factorBreakdown: engineBreakdown,
        riskFlags: uniqueFlags(riskFlags),
      },
      resolvedPresetConfig,
    );

    const positiveFactors = engineBreakdown
      .filter((item) => item.status === "positive")
      .sort((left, right) => right.score - left.score);
    const negativeFactors = engineBreakdown
      .filter((item) => item.status === "negative")
      .sort((left, right) => left.score - right.score);

    const triggerConditions = buildTriggerConditions(
      engineBreakdown,
      indicators,
    );
    const invalidationConditions = buildInvalidationConditions(
      engineBreakdown,
      indicators,
    );
    const triggerNotes = triggerConditions.length
      ? triggerConditions.map((item) => formatConditionNote(item))
      : positiveFactors
          .slice(0, 3)
          .map((item) => summarizeBreakdownLabel(item));
    const invalidationNotes = invalidationConditions.length
      ? invalidationConditions.map((item) => formatConditionNote(item))
      : negativeFactors.length
        ? negativeFactors
            .slice(0, 3)
            .map((item) => summarizeBreakdownLabel(item))
        : ["若多周期结构破坏且相对强弱继续下滑，本次择时假设需要重评。"];

    const topPositive = positiveFactors[0]?.label ?? "暂无明显优势";
    const topNegative = negativeFactors[0]?.label ?? "暂无显著拖累";
    const explanation =
      direction === "bullish"
        ? `优势集中在 ${topPositive}，且负面拖累主要来自 ${topNegative}。`
        : direction === "bearish"
          ? `负面集中在 ${topNegative}，当前需要等待结构修复。`
          : `正负因子拉扯，最强优势是 ${topPositive}，主要拖累是 ${topNegative}。`;
    const summary =
      direction === "bullish"
        ? `综合择时评分 ${compositeScore.toFixed(1)}，多个择时模型整体偏多。`
        : direction === "bearish"
          ? `综合择时评分 ${compositeScore.toFixed(1)}，多个择时模型整体偏空。`
          : `综合择时评分 ${compositeScore.toFixed(1)}，当前多空分歧较大。`;

    return {
      stockCode: snapshot.stockCode,
      stockName: snapshot.stockName,
      asOfDate: snapshot.asOfDate,
      direction,
      compositeScore: Math.round(compositeScore * 100) / 100,
      signalStrength,
      confidence,
      engineBreakdown,
      triggerNotes,
      invalidationNotes,
      riskFlags: uniqueFlags(riskFlags),
      explanation,
      signalContext: {
        direction,
        compositeScore: Math.round(compositeScore * 100) / 100,
        signalStrength,
        confidence,
        engineBreakdown,
        triggerNotes,
        invalidationNotes,
        triggerConditions,
        invalidationConditions,
        riskFlags: uniqueFlags(riskFlags),
        explanation,
        summary,
      },
    };
  }
}

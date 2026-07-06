import { resolveTimingPresetConfig } from "~/server/domain/timing/preset";
import { TimingActionPolicy } from "~/server/domain/timing/services/timing-action-policy";
import { TimingConfidencePolicy } from "~/server/domain/timing/services/timing-confidence-policy";
import type {
  TechnicalAssessment,
  TimingCardDraft,
  TimingEngineBreakdownItem,
  TimingPresetConfig,
  TimingRiskFlag,
  TimingSignalData,
  TimingSignalEngineResult,
  TimingSourceType,
} from "~/server/domain/timing/types";
import { TechnicalSignalSet } from "~/server/domain/timing/value-objects/technical-signal-set";

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
        summary: `${assessment.stockName} 当前偏向 ${actionBias}，核心依据是 ${assessment.signalContext.summary}`,
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

    const triggerNotes = positiveFactors
      .slice(0, 3)
      .map((item) => summarizeBreakdownLabel(item));
    const invalidationNotes = negativeFactors.length
      ? negativeFactors.slice(0, 3).map((item) => summarizeBreakdownLabel(item))
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
        ? `Composite ${compositeScore.toFixed(1)}，多子引擎整体偏多。`
        : direction === "bearish"
          ? `Composite ${compositeScore.toFixed(1)}，多子引擎整体偏空。`
          : `Composite ${compositeScore.toFixed(1)}，当前多空分歧较大。`;

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
        riskFlags: uniqueFlags(riskFlags),
        explanation,
        summary,
      },
    };
  }
}

import type {
  MarketContextAnalysis,
  TimingAction,
  TimingAnalysisCardRecord,
  TimingBar,
  TimingChartLevels,
  TimingExecutionCondition,
  TimingExecutionPlan,
  TimingRecommendationRecord,
  TimingRiskFlag,
} from "~/server/domain/timing/types";

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function roundPrice(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 10_000) / 10_000;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function hasTriggeredCriticalInvalidation(card: TimingAnalysisCardRecord) {
  return (card.reasoning.signalContext.invalidationConditions ?? []).some(
    (condition) =>
      condition.status === "TRIGGERED" && condition.severity === "CRITICAL",
  );
}

function collectRequiredConfirmations(card: TimingAnalysisCardRecord) {
  const triggerConfirmations = (
    card.reasoning.signalContext.triggerConditions ?? []
  )
    .filter((condition) => condition.status !== "TRIGGERED")
    .map((condition) => `${condition.label}尚未触发`);

  const invalidationConfirmations = (
    card.reasoning.signalContext.invalidationConditions ?? []
  )
    .filter((condition) => condition.status === "NEAR")
    .map((condition) => `${condition.label}接近失效，需要收盘确认`);

  return unique([...triggerConfirmations, ...invalidationConfirmations]);
}

function fallbackFinalAction(card: TimingAnalysisCardRecord): TimingAction {
  if (
    hasTriggeredCriticalInvalidation(card) &&
    (card.actionBias === "ADD" || card.actionBias === "PROBE")
  ) {
    return "WATCH";
  }

  return card.actionBias;
}

function collectDowngradeReasons(params: {
  card: TimingAnalysisCardRecord;
  finalAction: TimingAction;
  recommendation?: TimingRecommendationRecord | null;
  marketContext: MarketContextAnalysis;
}) {
  const reasons: string[] = [];
  const riskPlan = params.recommendation?.reasoning.riskPlan;
  const positionContext = params.recommendation?.reasoning.positionContext;

  if (params.card.actionBias !== params.finalAction) {
    reasons.push(
      `原始动作 ${params.card.actionBias} 被风控调整为 ${params.finalAction}`,
    );
  }
  if (hasTriggeredCriticalInvalidation(params.card)) {
    reasons.push("关键失效条件已经触发，禁止继续进攻");
  }
  if (params.marketContext.state === "RISK_OFF") {
    reasons.push("市场状态为风险收缩，限制新增风险暴露");
  }
  if (riskPlan?.blockedActions.includes(params.card.actionBias)) {
    reasons.push(`组合风控已阻断 ${params.card.actionBias}`);
  }
  if (positionContext?.invalidationRisk === "AT_RISK") {
    reasons.push("持仓距离失效位过近");
  }
  if (!params.recommendation) {
    reasons.push("缺少同轮组合推荐记录，仓位预算降级展示");
  }

  return unique(reasons);
}

function getReferencePrice(params: {
  bars: TimingBar[];
  card: TimingAnalysisCardRecord;
}) {
  return params.bars.at(-1)?.close ?? params.card.reasoning.indicators.close;
}

function getStopPrice(params: {
  card: TimingAnalysisCardRecord;
  chartLevels: TimingChartLevels;
  referencePrice: number | null;
}) {
  const priceLevelCondition = (
    params.card.reasoning.signalContext.invalidationConditions ?? []
  ).find(
    (
      condition,
    ): condition is TimingExecutionCondition & { threshold: number } =>
      condition.category === "PRICE_LEVEL" &&
      typeof condition.threshold === "number",
  );

  if (priceLevelCondition) {
    return priceLevelCondition.threshold;
  }

  const ema20 = params.card.reasoning.indicators.ema20;
  const recentLow20d = params.chartLevels.recentLow20d;
  if (ema20 > 0 && recentLow20d > 0) {
    return Math.min(ema20, recentLow20d);
  }

  const atr14 = params.card.reasoning.indicators.atr14;
  if (params.referencePrice !== null && atr14 > 0) {
    return params.referencePrice - atr14;
  }

  return null;
}

function buildSplitPlan(params: {
  action: TimingAction;
  suggestedMinPct: number | null;
  suggestedMaxPct: number | null;
}) {
  const minPct =
    params.suggestedMinPct === null
      ? null
      : `${round(params.suggestedMinPct)}%`;
  const maxPct =
    params.suggestedMaxPct === null
      ? null
      : `${round(params.suggestedMaxPct)}%`;

  switch (params.action) {
    case "PROBE":
      return [
        maxPct
          ? `仅执行试仓，目标不超过 ${maxPct}`
          : "仅执行试仓，不追求一次打满仓位",
      ];
    case "ADD":
      return [
        minPct ? `第一笔加至 ${minPct}` : "第一笔使用小额确认仓位",
        maxPct ? `确认后再补至 ${maxPct}` : "确认后再补第二笔",
      ];
    case "TRIM":
      return [maxPct ? `先降至不高于 ${maxPct}` : "先执行减仓，降低风险暴露"];
    case "EXIT":
      return ["按退出动作处理，不新增风险暴露"];
    case "HOLD":
      return ["维持当前仓位，不主动加仓"];
    default:
      return ["保持观察，等待条件重新满足"];
  }
}

export class TimingExecutionPlanService {
  build(params: {
    card: TimingAnalysisCardRecord;
    bars: TimingBar[];
    chartLevels: TimingChartLevels;
    marketContext: MarketContextAnalysis;
    recommendation?: TimingRecommendationRecord | null;
  }): TimingExecutionPlan {
    const recommendation = params.recommendation ?? null;
    const finalAction =
      recommendation?.action ?? fallbackFinalAction(params.card);
    const referencePrice = getReferencePrice({
      bars: params.bars,
      card: params.card,
    });
    const atr14 = params.card.reasoning.indicators.atr14;
    const stopPrice = getStopPrice({
      card: params.card,
      chartLevels: params.chartLevels,
      referencePrice,
    });
    const suggestedMinPct = recommendation?.suggestedMinPct ?? null;
    const suggestedMaxPct = recommendation?.suggestedMaxPct ?? null;
    const positionContext = recommendation?.reasoning.positionContext;
    const riskPlan = recommendation?.reasoning.riskPlan;
    const riskFlags = unique([
      ...params.card.riskFlags,
      ...(recommendation?.riskFlags ?? []),
    ] as TimingRiskFlag[]);

    return {
      decision: {
        rawAction: params.card.actionBias,
        finalAction,
        allowed: finalAction !== "WATCH",
        downgradeReasons: collectDowngradeReasons({
          card: params.card,
          finalAction,
          recommendation,
          marketContext: params.marketContext,
        }),
        requiredConfirmations: collectRequiredConfirmations(params.card),
      },
      budget: {
        currentWeightPct: positionContext?.currentWeightPct ?? null,
        suggestedMinPct,
        suggestedMaxPct,
        targetDeltaPct: positionContext?.targetDeltaPct ?? null,
        availableCashPct: positionContext?.availableCashPct ?? null,
        maxSingleNamePct: riskPlan?.maxSingleNamePct ?? null,
        portfolioRiskBudgetPct:
          riskPlan?.portfolioRiskBudgetPct ??
          recommendation?.riskBudgetPct ??
          null,
        dataStatus: recommendation ? "COMPLETE" : "FALLBACK",
      },
      orderPlan: {
        referencePrice: roundPrice(referencePrice),
        entryZoneLow: roundPrice(
          referencePrice === null
            ? null
            : Math.min(referencePrice, params.card.reasoning.indicators.ema20),
        ),
        entryZoneHigh: roundPrice(
          referencePrice === null ? null : referencePrice + atr14 * 0.5,
        ),
        chaseLimitPrice: roundPrice(
          referencePrice === null ? null : referencePrice + atr14,
        ),
        stopPrice: roundPrice(stopPrice),
        splitPlan: buildSplitPlan({
          action: finalAction,
          suggestedMinPct,
          suggestedMaxPct,
        }),
        notes: [
          finalAction === "WATCH"
            ? "当前不生成买入指令"
            : "执行价位仅使用确定性行情和风控规则生成",
          stopPrice === null ? "缺少可用失效价，止损位降级为空" : "",
        ].filter(Boolean),
      },
      constraints: {
        marketState: params.marketContext.state,
        marketTransition: params.marketContext.transition,
        blockedActions: riskPlan?.blockedActions ?? [],
        portfolioWarnings: unique([
          ...(riskPlan?.correlationWarnings ?? []),
          ...(params.marketContext.constraints ?? []),
        ]),
        riskFlags,
        dataStatus: recommendation ? "COMPLETE" : "FALLBACK",
        missingContext: recommendation ? [] : ["同轮组合推荐记录"],
      },
    };
  }
}

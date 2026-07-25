import { PositionContextService } from "~/server/application/timing/position-context-service";
import type {
  MarketContextAnalysis,
  PortfolioPosition,
  PortfolioRiskPlan,
  PortfolioSnapshotRecord,
  TimingAction,
  TimingCardDraft,
  TimingFeatureEvidence,
  TimingRecommendationDraft,
} from "~/server/domain/timing/types";

const ACTION_PRIORITY: Record<TimingAction, number> = {
  EXIT: 0,
  TRIM: 1,
  ADD: 2,
  ENTER: 3,
  PROBE: 4,
  HOLD: 5,
  WATCH: 6,
};

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function currentPrice(features: TimingFeatureEvidence[]) {
  const price = features.find(
    (item) =>
      item.timeframe === "DAILY" && typeof item.inputValues?.close === "number",
  )?.inputValues?.close;
  return typeof price === "number" ? price : 0;
}

function suggestedRange(params: {
  action: TimingAction;
  position?: PortfolioPosition;
  riskPlan: PortfolioRiskPlan;
}) {
  const current = params.position?.currentWeightPct ?? 0;
  const cap = params.riskPlan.maxSingleNamePct;
  const probe = params.riskPlan.defaultProbePct;

  switch (params.action) {
    case "EXIT":
      return { min: 0, max: 0 };
    case "TRIM":
      return { min: round(current * 0.35), max: round(current * 0.7) };
    case "HOLD":
      return { min: round(current), max: round(current) };
    case "ADD":
      return {
        min: round(Math.min(cap, current + probe * 0.75)),
        max: round(Math.min(cap, current + probe * 2)),
      };
    case "ENTER":
      return { min: round(Math.min(probe, cap)), max: round(cap) };
    case "PROBE":
      return {
        min: round(current),
        max: round(Math.min(cap, current + probe)),
      };
    default:
      return { min: round(current), max: round(current) };
  }
}

export class WatchlistPortfolioManagerV2Service {
  constructor(
    private readonly positionContextService = new PositionContextService(),
  ) {}

  buildRecommendations(params: {
    userId: string;
    workflowRunId: string;
    watchListId?: string | null;
    portfolioSnapshot: PortfolioSnapshotRecord;
    timingCards: TimingCardDraft[];
    riskPlan: PortfolioRiskPlan;
    marketContextAnalysis: MarketContextAnalysis;
  }): TimingRecommendationDraft[] {
    const positions = new Map(
      params.portfolioSnapshot.positions.map((position) => [
        position.stockCode,
        position,
      ]),
    );
    const availableCashPct =
      params.portfolioSnapshot.totalCapital > 0
        ? round(
            (params.portfolioSnapshot.cash /
              params.portfolioSnapshot.totalCapital) *
              100,
          )
        : 0;

    return [...params.timingCards]
      .sort(
        (left, right) =>
          ACTION_PRIORITY[left.actionBias] -
            ACTION_PRIORITY[right.actionBias] ||
          left.stockCode.localeCompare(right.stockCode),
      )
      .map((card, index) => {
        const position = positions.get(card.stockCode);
        const range = suggestedRange({
          action: card.actionBias,
          position,
          riskPlan: params.riskPlan,
        });
        const positionContext = this.positionContextService.build({
          position,
          currentPrice: currentPrice(card.reasoning.featureEvidence ?? []),
          asOfDate: card.asOfDate,
          availableCashPct,
          targetDeltaPct: round(range.max - (position?.currentWeightPct ?? 0)),
        });

        return {
          userId: params.userId,
          workflowRunId: params.workflowRunId,
          portfolioSnapshotId: params.portfolioSnapshot.id,
          watchListId: params.watchListId,
          presetRevisionId: card.presetRevisionId,
          stockCode: card.stockCode,
          stockName: card.stockName,
          action: card.actionBias,
          priority: index + 1,
          confidence: 0,
          suggestedMinPct: range.min,
          suggestedMaxPct: range.max,
          riskBudgetPct: params.riskPlan.portfolioRiskBudgetPct,
          marketState: params.marketContextAnalysis.state,
          marketTransition: params.marketContextAnalysis.transition,
          riskFlags: card.riskFlags,
          decisionStatus: card.decisionStatus,
          decisionAudit: card.decisionAudit,
          reasoning: {
            signalContext: card.reasoning.signalContext,
            marketContext: {
              state: params.marketContextAnalysis.state,
              transition: params.marketContextAnalysis.transition,
              summary: params.marketContextAnalysis.summary,
              constraints: params.marketContextAnalysis.constraints,
              breadthTrend: params.marketContextAnalysis.breadthTrend,
              volatilityTrend: params.marketContextAnalysis.volatilityTrend,
              persistenceDays: params.marketContextAnalysis.persistenceDays,
              leadership: params.marketContextAnalysis.leadership,
            },
            positionContext,
            feedbackContext: {
              learningSummary: "v2 优化仅生成新草稿，不参与当前动作推导。",
              pendingSuggestionCount: 0,
              adoptedSuggestionCount: 0,
              highlights: [],
            },
            riskPlan: params.riskPlan,
            actionRationale:
              "最终动作完全来自确定性规则、数据门控和市场门控；仓位区间仅用于执行预算。",
            decisionAudit: card.decisionAudit,
            dataManifest: card.reasoning.dataManifest,
            featureEvidence: card.reasoning.featureEvidence,
            inputHash: card.reasoning.inputHash,
          },
        };
      });
  }
}

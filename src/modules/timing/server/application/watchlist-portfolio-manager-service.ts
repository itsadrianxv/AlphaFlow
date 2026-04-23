import { PositionContextService } from "~/modules/timing/server/application/position-context-service";
import { resolveTimingPresetConfig } from "~/modules/timing/server/domain/preset";
import type {
  MarketContextAnalysis,
  PortfolioPosition,
  PortfolioRiskPlan,
  PortfolioSnapshotRecord,
  TimingAction,
  TimingCardDraft,
  TimingFeedbackContext,
  TimingPositionContext,
  TimingPresetConfig,
  TimingRecommendationDraft,
  TimingRiskFlag,
} from "~/modules/timing/server/domain/types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

type Candidate = {
  card: TimingCardDraft;
  action: TimingAction;
  confidence: number;
  minPct: number;
  maxPct: number;
  heldPosition?: PortfolioPosition;
  score: number;
  riskFlags: TimingRiskFlag[];
  positionContext: TimingPositionContext;
};

export class WatchlistPortfolioManagerService {
  constructor(
    private readonly deps: {
      positionContextService?: PositionContextService;
    } = {},
  ) {}

  private get positionContextService() {
    return this.deps.positionContextService ?? new PositionContextService();
  }

  buildRecommendations(params: {
    userId: string;
    workflowRunId: string;
    watchListId: string;
    portfolioSnapshot: PortfolioSnapshotRecord;
    timingCards: TimingCardDraft[];
    riskPlan: PortfolioRiskPlan;
    marketContextAnalysis: MarketContextAnalysis;
    presetConfig?: TimingPresetConfig;
    feedbackContext?: TimingFeedbackContext;
  }): TimingRecommendationDraft[] {
    const resolvedPresetConfig = resolveTimingPresetConfig(params.presetConfig);
    const positionsByCode = new Map(
      params.portfolioSnapshot.positions.map((position) => [
        position.stockCode,
        position,
      ]),
    );

    let remainingRiskBudget = params.riskPlan.portfolioRiskBudgetPct;
    const availableCashPct =
      params.portfolioSnapshot.totalCapital > 0
        ? round(
            (params.portfolioSnapshot.cash /
              params.portfolioSnapshot.totalCapital) *
              100,
          )
        : 0;

    const candidates = params.timingCards
      .map((card) => {
        const heldPosition = positionsByCode.get(card.stockCode);
        const marketNormalizedAction = this.normalizeForMarket({
          action: card.actionBias,
          hasPosition: Boolean(heldPosition),
          blockedActions: params.riskPlan.blockedActions,
          marketContextAnalysis: params.marketContextAnalysis,
          confidence: card.confidence,
        });

        const positionContext = this.positionContextService.build({
          position: heldPosition,
          currentPrice: card.reasoning.indicators.close,
          asOfDate: card.asOfDate,
          availableCashPct,
        });
        const positionNormalizedAction = this.normalizeForPosition({
          action: marketNormalizedAction,
          positionContext,
          marketContextAnalysis: params.marketContextAnalysis,
        });

        const range = this.getSuggestedRange(
          positionNormalizedAction,
          heldPosition,
          params.riskPlan,
        );

        const riskFlags = [...card.riskFlags];
        if (params.riskPlan.correlationWarnings.length > 0 && heldPosition) {
          riskFlags.push("HIGH_CORRELATION");
        }
        if (positionContext.invalidationRisk === "AT_RISK") {
          riskFlags.push("NEAR_INVALIDATION");
        }
        if (
          params.marketContextAnalysis.state === "RISK_OFF" &&
          (positionNormalizedAction === "ADD" ||
            positionNormalizedAction === "PROBE")
        ) {
          riskFlags.push("CROWDING_RISK");
        }

        return {
          card,
          action: positionNormalizedAction,
          confidence: this.adjustConfidence(
            card.confidence,
            card.actionBias,
            positionNormalizedAction,
            params.marketContextAnalysis,
            positionContext,
          ),
          minPct: range.minPct,
          maxPct: range.maxPct,
          heldPosition,
          positionContext,
          score: this.computeScore(
            card,
            positionNormalizedAction,
            params.marketContextAnalysis,
            positionContext,
            params.feedbackContext,
            resolvedPresetConfig,
          ),
          riskFlags: unique(riskFlags),
        } satisfies Candidate;
      })
      .sort((left, right) => right.score - left.score);

    const budgeted = candidates.map((candidate) => {
      const currentWeight = candidate.heldPosition?.currentWeightPct ?? 0;
      const incrementalRisk = Math.max(0, candidate.maxPct - currentWeight);

      if (incrementalRisk > 0) {
        const allowedIncrementalRisk = Math.min(
          incrementalRisk,
          remainingRiskBudget,
        );

        if (allowedIncrementalRisk <= 0.25) {
          return this.downgradeForBudget(candidate);
        }

        remainingRiskBudget = round(
          Math.max(0, remainingRiskBudget - allowedIncrementalRisk),
        );

        candidate.maxPct = round(currentWeight + allowedIncrementalRisk);
        candidate.minPct = round(Math.min(candidate.minPct, candidate.maxPct));
      }

      return candidate;
    });

    return budgeted.map((candidate, index) => {
      const currentWeight = candidate.heldPosition?.currentWeightPct ?? 0;
      const targetDeltaPct = round(candidate.maxPct - currentWeight);
      const positionContext = this.positionContextService.build({
        position: candidate.heldPosition,
        currentPrice: candidate.card.reasoning.indicators.close,
        asOfDate: candidate.card.asOfDate,
        availableCashPct,
        targetDeltaPct,
      });

      return {
        userId: params.userId,
        workflowRunId: params.workflowRunId,
        portfolioSnapshotId: params.portfolioSnapshot.id,
        watchListId: params.watchListId,
        presetId: candidate.card.presetId,
        stockCode: candidate.card.stockCode,
        stockName: candidate.card.stockName,
        action: candidate.action,
        priority: index + 1,
        confidence: candidate.confidence,
        suggestedMinPct: round(candidate.minPct),
        suggestedMaxPct: round(candidate.maxPct),
        riskBudgetPct: params.riskPlan.portfolioRiskBudgetPct,
        marketState: params.marketContextAnalysis.state,
        marketTransition: params.marketContextAnalysis.transition,
        riskFlags: candidate.riskFlags,
        reasoning: {
          signalContext: candidate.card.reasoning.signalContext,
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
          feedbackContext: params.feedbackContext ?? {
            presetId: candidate.card.presetId,
            learningSummary: "尚未沉淀足够复盘样本。",
            pendingSuggestionCount: 0,
            adoptedSuggestionCount: 0,
            highlights: [],
          },
          riskPlan: params.riskPlan,
          actionRationale: this.buildActionRationale(
            candidate,
            params.marketContextAnalysis,
            positionContext,
          ),
        },
      };
    });
  }

  private normalizeForMarket(params: {
    action: TimingAction;
    hasPosition: boolean;
    blockedActions: TimingAction[];
    marketContextAnalysis: MarketContextAnalysis;
    confidence: number;
  }): TimingAction {
    if (
      !params.hasPosition &&
      ["HOLD", "TRIM", "EXIT"].includes(params.action)
    ) {
      return "WATCH";
    }

    let action = params.action;
    if (params.blockedActions.includes(action)) {
      if (action === "ADD") {
        action = params.blockedActions.includes("PROBE") ? "WATCH" : "PROBE";
      } else if (action === "PROBE") {
        action = "WATCH";
      }
    }

    if (params.marketContextAnalysis.state === "RISK_OFF" && action === "ADD") {
      action = params.confidence >= 82 ? "PROBE" : "WATCH";
    }

    if (
      params.marketContextAnalysis.state === "RISK_OFF" &&
      action === "PROBE" &&
      params.confidence < 70
    ) {
      action = "WATCH";
    }

    if (
      params.marketContextAnalysis.transition === "PIVOT_DOWN" &&
      !params.hasPosition &&
      action === "PROBE"
    ) {
      action = "WATCH";
    }

    return action;
  }

  private normalizeForPosition(params: {
    action: TimingAction;
    positionContext: TimingPositionContext;
    marketContextAnalysis: MarketContextAnalysis;
  }): TimingAction {
    const { positionContext } = params;
    if (!positionContext.held) {
      return params.action;
    }

    if (positionContext.invalidationRisk === "AT_RISK") {
      if (params.action === "ADD") {
        return positionContext.pnlZone === "LOSS" ? "EXIT" : "TRIM";
      }
      if (params.action === "PROBE") {
        return "HOLD";
      }
    }

    if (
      ["MATURE_GAIN", "OVEREXTENDED_GAIN"].includes(positionContext.pnlZone) &&
      ["DETERIORATING", "PIVOT_DOWN"].includes(
        params.marketContextAnalysis.transition,
      ) &&
      (params.action === "HOLD" ||
        params.action === "ADD" ||
        params.action === "PROBE")
    ) {
      return "TRIM";
    }

    if (
      positionContext.costZone === "BELOW_COST" &&
      positionContext.distanceToInvalidationPct !== undefined &&
      positionContext.distanceToInvalidationPct !== null &&
      positionContext.distanceToInvalidationPct <= 3 &&
      params.action === "ADD"
    ) {
      return "HOLD";
    }

    return params.action;
  }

  private getSuggestedRange(
    action: TimingAction,
    heldPosition: PortfolioPosition | undefined,
    riskPlan: PortfolioRiskPlan,
  ) {
    const currentWeight = heldPosition?.currentWeightPct ?? 0;
    const maxSingleNamePct = riskPlan.maxSingleNamePct;
    const defaultProbePct = riskPlan.defaultProbePct;

    if (!heldPosition) {
      switch (action) {
        case "PROBE":
          return {
            minPct: round(Math.max(0.5, defaultProbePct * 0.5)),
            maxPct: round(defaultProbePct),
          };
        case "ADD":
          return {
            minPct: round(Math.max(defaultProbePct, maxSingleNamePct * 0.45)),
            maxPct: round(maxSingleNamePct),
          };
        default:
          return { minPct: 0, maxPct: 0 };
      }
    }

    switch (action) {
      case "EXIT":
        return { minPct: 0, maxPct: round(Math.min(currentWeight * 0.1, 1)) };
      case "TRIM":
        return {
          minPct: round(Math.max(0, currentWeight * 0.35)),
          maxPct: round(Math.max(0, currentWeight - defaultProbePct)),
        };
      case "HOLD":
        return {
          minPct: round(Math.max(0, currentWeight - 1)),
          maxPct: round(Math.min(maxSingleNamePct, currentWeight + 1)),
        };
      case "PROBE":
        return {
          minPct: round(currentWeight),
          maxPct: round(
            Math.min(maxSingleNamePct, currentWeight + defaultProbePct),
          ),
        };
      case "ADD":
        return {
          minPct: round(
            Math.min(maxSingleNamePct, currentWeight + defaultProbePct * 0.75),
          ),
          maxPct: round(
            Math.min(maxSingleNamePct, currentWeight + defaultProbePct * 2),
          ),
        };
      default:
        return { minPct: round(currentWeight), maxPct: round(currentWeight) };
    }
  }

  private adjustConfidence(
    confidence: number,
    originalAction: TimingAction,
    normalizedAction: TimingAction,
    marketContextAnalysis: MarketContextAnalysis,
    positionContext: TimingPositionContext,
  ) {
    let next = confidence;
    if (
      marketContextAnalysis.state === "RISK_OFF" &&
      normalizedAction !== originalAction
    ) {
      next -= 8;
    }
    if (normalizedAction === "WATCH") {
      next -= 4;
    }
    if (positionContext.invalidationRisk === "AT_RISK") {
      next -= 10;
    }
    if (
      normalizedAction === "TRIM" &&
      ["MATURE_GAIN", "OVEREXTENDED_GAIN"].includes(positionContext.pnlZone)
    ) {
      next += 4;
    }
    return clamp(Math.round(next), 25, 95);
  }

  private computeScore(
    card: TimingCardDraft,
    action: TimingAction,
    marketContextAnalysis: MarketContextAnalysis,
    positionContext: TimingPositionContext,
    feedbackContext: TimingFeedbackContext | undefined,
    presetConfig: TimingPresetConfig,
  ) {
    const contextWeights = presetConfig.contextWeights ?? {};
    const positionAdjustment =
      this.positionContextService.scoreAdjustment(positionContext);
    const marketScore =
      marketContextAnalysis.state === "RISK_ON"
        ? 16
        : marketContextAnalysis.state === "RISK_OFF"
          ? -10
          : 4;
    const transitionScore =
      marketContextAnalysis.transition === "PIVOT_UP"
        ? 10
        : marketContextAnalysis.transition === "PIVOT_DOWN"
          ? -12
          : marketContextAnalysis.transition === "IMPROVING"
            ? 6
            : marketContextAnalysis.transition === "DETERIORATING"
              ? -6
              : 0;
    const feedbackScore = feedbackContext?.adoptedSuggestionCount
      ? Math.min(feedbackContext.adoptedSuggestionCount * 2, 8)
      : 0;
    const actionScore: Record<TimingAction, number> = {
      WATCH: 20,
      PROBE: 55,
      ADD: 72,
      HOLD: 46,
      TRIM: 78,
      EXIT: 90,
    };

    return (
      actionScore[action] +
      card.confidence * (contextWeights.signalContext ?? 1) +
      (marketScore + transitionScore) * (contextWeights.marketContext ?? 0.9) +
      positionAdjustment * (contextWeights.positionContext ?? 0.8) +
      feedbackScore * (contextWeights.feedbackContext ?? 0.6) +
      card.reasoning.signalContext.signalStrength * 0.35
    );
  }

  private downgradeForBudget(candidate: Candidate): Candidate {
    if (candidate.heldPosition) {
      return {
        ...candidate,
        action:
          candidate.action === "ADD" || candidate.action === "PROBE"
            ? "HOLD"
            : candidate.action,
        minPct: round(candidate.heldPosition.currentWeightPct),
        maxPct: round(candidate.heldPosition.currentWeightPct),
      };
    }

    return {
      ...candidate,
      action: "WATCH",
      minPct: 0,
      maxPct: 0,
    };
  }

  private buildActionRationale(
    candidate: Candidate,
    marketContextAnalysis: MarketContextAnalysis,
    positionContext: TimingPositionContext,
  ) {
    const heldText = candidate.heldPosition
      ? `当前持仓 ${round(candidate.heldPosition.currentWeightPct)}%。`
      : "当前未持仓。";
    const invalidationText =
      positionContext.invalidationRisk === "UNKNOWN"
        ? "失效位未设置。"
        : `失效风险 ${positionContext.invalidationRisk}，距失效位 ${positionContext.distanceToInvalidationPct ?? "-"}%。`;

    return `${candidate.card.reasoning.actionRationale} ${heldText} ${invalidationText} ${marketContextAnalysis.summary}`;
  }
}

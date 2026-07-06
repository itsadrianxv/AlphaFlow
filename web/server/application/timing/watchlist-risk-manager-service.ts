import type {
  MarketContextAnalysis,
  PortfolioRiskPlan,
  PortfolioRiskPreferences,
  PortfolioSnapshotRecord,
  TimingAction,
  TimingCardDraft,
} from "~/server/domain/timing/types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function withDefaults(
  value: PortfolioSnapshotRecord["riskPreferences"],
): PortfolioRiskPreferences {
  return {
    maxSingleNamePct: clamp(value.maxSingleNamePct ?? 12, 2, 100),
    maxThemeExposurePct: clamp(value.maxThemeExposurePct ?? 30, 5, 100),
    defaultProbePct: clamp(value.defaultProbePct ?? 3, 0.5, 100),
    maxPortfolioRiskBudgetPct: clamp(
      value.maxPortfolioRiskBudgetPct ?? 20,
      1,
      100,
    ),
  };
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

export class WatchlistRiskManagerService {
  buildRiskPlan(params: {
    portfolioSnapshot: PortfolioSnapshotRecord;
    timingCards: TimingCardDraft[];
    marketContextAnalysis: MarketContextAnalysis;
  }): PortfolioRiskPlan {
    const preferences = withDefaults(params.portfolioSnapshot.riskPreferences);
    const availableCashPct =
      params.portfolioSnapshot.totalCapital > 0
        ? (params.portfolioSnapshot.cash /
            params.portfolioSnapshot.totalCapital) *
          100
        : 0;

    const concentration = params.portfolioSnapshot.positions.reduce(
      (maxWeight, position) => Math.max(maxWeight, position.currentWeightPct),
      0,
    );

    const sectorExposure = new Map<string, number>();
    for (const position of params.portfolioSnapshot.positions) {
      if (!position.sector) {
        continue;
      }

      sectorExposure.set(
        position.sector,
        (sectorExposure.get(position.sector) ?? 0) + position.currentWeightPct,
      );
    }

    const correlationWarnings = [...sectorExposure.entries()]
      .filter(([, exposure]) => exposure >= preferences.maxThemeExposurePct)
      .map(
        ([sector, exposure]) =>
          `${sector} exposure already reaches ${round(exposure)}%. Avoid crowding similar names.`,
      );

    if (concentration >= preferences.maxSingleNamePct * 0.85) {
      correlationWarnings.push(
        `Top position concentration is already ${round(concentration)}%, close to the single-name cap.`,
      );
    }

    const regimeMultiplier =
      params.marketContextAnalysis.state === "RISK_OFF"
        ? 0.5
        : params.marketContextAnalysis.state === "RISK_ON"
          ? 1
          : 0.75;

    const portfolioRiskBudgetPct = round(
      clamp(
        Math.min(preferences.maxPortfolioRiskBudgetPct, availableCashPct) *
          regimeMultiplier,
        0,
        preferences.maxPortfolioRiskBudgetPct,
      ),
    );

    const maxSingleNamePct = round(
      clamp(
        preferences.maxSingleNamePct * regimeMultiplier,
        Math.min(preferences.maxSingleNamePct, 2),
        preferences.maxSingleNamePct,
      ),
    );

    const defaultProbePct = round(
      clamp(
        preferences.defaultProbePct *
          (params.marketContextAnalysis.state === "RISK_OFF" ? 0.65 : 1),
        0.5,
        maxSingleNamePct,
      ),
    );

    const blockedActions: TimingAction[] = [];
    if (params.marketContextAnalysis.state === "RISK_OFF") {
      blockedActions.push("ADD");
      if (portfolioRiskBudgetPct <= defaultProbePct) {
        blockedActions.push("PROBE");
      }
    }

    if (availableCashPct < defaultProbePct) {
      blockedActions.push("ADD");
    }

    if (
      params.timingCards.every(
        (card) => card.actionBias !== "ADD" && card.actionBias !== "PROBE",
      )
    ) {
      blockedActions.push("ADD");
    }

    const notes = [
      `Available cash is ${round(availableCashPct)}% of total capital.`,
      `Market state confidence is ${params.marketContextAnalysis.regimeConfidence}.`,
      `Transition is ${params.marketContextAnalysis.transition}.`,
      ...params.marketContextAnalysis.constraints,
    ];

    return {
      portfolioRiskBudgetPct,
      maxSingleNamePct,
      defaultProbePct,
      blockedActions: unique(blockedActions),
      correlationWarnings: unique(correlationWarnings),
      notes,
    };
  }
}

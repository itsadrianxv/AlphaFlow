import type {
  PortfolioPosition,
  TimingPositionContext,
} from "~/server/domain/timing/types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function diffDays(start?: string, end?: string) {
  if (!start || !end) {
    return null;
  }

  const startDate = new Date(`${start}T00:00:00.000Z`);
  const endDate = new Date(`${end}T00:00:00.000Z`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return null;
  }

  return Math.max(
    0,
    Math.floor(
      (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000),
    ),
  );
}

export class PositionContextService {
  build(params: {
    position?: PortfolioPosition;
    currentPrice: number;
    asOfDate: string;
    availableCashPct: number;
    targetDeltaPct?: number;
  }): TimingPositionContext {
    const held = Boolean(params.position);
    if (!params.position) {
      return {
        held: false,
        currentWeightPct: 0,
        targetDeltaPct: round(params.targetDeltaPct ?? 0),
        availableCashPct: round(params.availableCashPct),
        costZone: "NEAR_COST",
        pnlZone: "SMALL_GAIN",
        holdingStage: "UNSPECIFIED",
        invalidationRisk: "UNKNOWN",
      };
    }

    const { position } = params;
    const costBasis = position.costBasis;
    const unrealizedPnlPct =
      costBasis > 0 ? round((params.currentPrice / costBasis - 1) * 100) : null;
    const daysHeld = diffDays(position.openedAt, params.asOfDate);
    const distanceToInvalidationPct =
      position.invalidationPrice && params.currentPrice > 0
        ? round(
            ((params.currentPrice - position.invalidationPrice) /
              params.currentPrice) *
              100,
          )
        : null;

    const costZone =
      unrealizedPnlPct === null
        ? "NEAR_COST"
        : unrealizedPnlPct < -2
          ? "BELOW_COST"
          : unrealizedPnlPct <= 3
            ? "NEAR_COST"
            : unrealizedPnlPct <= 15
              ? "ABOVE_COST"
              : "EXTENDED_FROM_COST";

    const pnlZone =
      unrealizedPnlPct === null
        ? "SMALL_GAIN"
        : unrealizedPnlPct <= 0
          ? "LOSS"
          : unrealizedPnlPct <= 8
            ? "SMALL_GAIN"
            : unrealizedPnlPct <= 20
              ? "MATURE_GAIN"
              : "OVEREXTENDED_GAIN";

    const holdingStage =
      daysHeld === null || !position.plannedHoldingDays
        ? "UNSPECIFIED"
        : daysHeld <= position.plannedHoldingDays * 0.33
          ? "EARLY"
          : daysHeld <= position.plannedHoldingDays * 0.8
            ? "MATURE"
            : "LATE";

    const invalidationRisk =
      distanceToInvalidationPct === null
        ? "UNKNOWN"
        : distanceToInvalidationPct <= 1.5
          ? "AT_RISK"
          : distanceToInvalidationPct <= 4
            ? "TIGHT"
            : "SAFE";

    return {
      held,
      currentWeightPct: round(position.currentWeightPct),
      targetDeltaPct: round(params.targetDeltaPct ?? 0),
      availableCashPct: round(params.availableCashPct),
      costBasis: round(position.costBasis),
      currentPrice: round(params.currentPrice),
      daysHeld,
      unrealizedPnlPct,
      costZone,
      pnlZone,
      holdingStage,
      distanceToInvalidationPct,
      invalidationRisk,
    };
  }

  scoreAdjustment(context: TimingPositionContext) {
    if (!context.held) {
      return 0;
    }

    let score = 0;
    if (context.invalidationRisk === "AT_RISK") {
      score -= 18;
    } else if (context.invalidationRisk === "TIGHT") {
      score -= 8;
    }

    if (context.pnlZone === "MATURE_GAIN") {
      score += 6;
    } else if (context.pnlZone === "OVEREXTENDED_GAIN") {
      score += 10;
    } else if (context.pnlZone === "LOSS") {
      score -= 6;
    }

    if (context.holdingStage === "EARLY") {
      score += 4;
    } else if (context.holdingStage === "LATE") {
      score -= 4;
    }

    return clamp(score, -25, 20);
  }
}

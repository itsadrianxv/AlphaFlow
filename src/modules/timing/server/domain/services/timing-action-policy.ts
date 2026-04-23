import type {
  StageOneTimingAction,
  TimingAction,
  TimingDirection,
  TimingPresetConfig,
} from "~/modules/timing/server/domain/types";

export class TimingActionPolicy {
  decide(
    params: {
      direction: TimingDirection;
      confidence: number;
      signalStrength: number;
      hasPortfolioContext?: boolean;
    },
    presetConfig?: TimingPresetConfig,
  ): TimingAction {
    if (!params.hasPortfolioContext) {
      return this.decideStageOneAction(params, presetConfig);
    }

    const thresholds = presetConfig?.actionThresholds;

    if (
      params.direction === "bearish" &&
      params.confidence >= (thresholds?.exitConfidence ?? 82)
    ) {
      return "EXIT";
    }

    if (
      params.direction === "bearish" &&
      params.confidence >= (thresholds?.trimConfidence ?? 68)
    ) {
      return "TRIM";
    }

    if (
      params.direction === "neutral" &&
      params.confidence >= (thresholds?.holdConfidence ?? 60)
    ) {
      return "HOLD";
    }

    return this.decideStageOneAction(params, presetConfig);
  }

  private decideStageOneAction(
    params: {
      direction: TimingDirection;
      confidence: number;
      signalStrength: number;
    },
    presetConfig?: TimingPresetConfig,
  ): StageOneTimingAction {
    const thresholds = presetConfig?.actionThresholds;

    if (
      params.direction === "bullish" &&
      params.confidence >= (thresholds?.addConfidence ?? 74) &&
      params.signalStrength >= (thresholds?.addSignalStrength ?? 68)
    ) {
      return "ADD";
    }

    if (
      params.direction === "bullish" &&
      params.confidence >= (thresholds?.probeConfidence ?? 56) &&
      params.signalStrength >= (thresholds?.probeSignalStrength ?? 52)
    ) {
      return "PROBE";
    }

    return "WATCH";
  }
}

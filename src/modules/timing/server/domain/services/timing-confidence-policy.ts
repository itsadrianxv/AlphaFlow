import type {
  TimingDirection,
  TimingFactorBreakdownItem,
  TimingPresetConfig,
  TimingRiskFlag,
} from "~/modules/timing/server/domain/types";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export class TimingConfidencePolicy {
  calculate(
    params: {
      direction: TimingDirection;
      signalStrength: number;
      factorBreakdown: TimingFactorBreakdownItem[];
      riskFlags: TimingRiskFlag[];
    },
    presetConfig?: TimingPresetConfig,
  ) {
    const total = params.factorBreakdown.length || 1;
    const aligned = params.factorBreakdown.filter((factor) => {
      if (params.direction === "bullish") {
        return factor.status === "positive";
      }
      if (params.direction === "bearish") {
        return factor.status === "negative";
      }
      return factor.status === "neutral";
    }).length;

    const thresholds = presetConfig?.confidenceThresholds;
    const alignmentScore =
      (aligned / total) * (thresholds?.alignmentWeight ?? 35);
    const riskPenalty =
      params.riskFlags.length * (thresholds?.riskPenaltyPerFlag ?? 4);
    const neutralPenalty =
      params.direction === "neutral" ? (thresholds?.neutralPenalty ?? 8) : 0;
    const signalStrengthWeight = thresholds?.signalStrengthWeight ?? 0.55;
    const minConfidence = thresholds?.minConfidence ?? 25;
    const maxConfidence = thresholds?.maxConfidence ?? 95;

    return clamp(
      Math.round(
        params.signalStrength * signalStrengthWeight +
          alignmentScore -
          riskPenalty -
          neutralPenalty,
      ),
      minConfidence,
      maxConfidence,
    );
  }
}

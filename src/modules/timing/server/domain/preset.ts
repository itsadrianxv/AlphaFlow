import type {
  TimingPresetConfig,
  TimingReviewHorizon,
  TimingSignalEngineKey,
} from "~/modules/timing/server/domain/types";

export const DEFAULT_TIMING_REVIEW_HORIZONS: TimingReviewHorizon[] = [
  "T5",
  "T10",
  "T20",
];

const DEFAULT_SIGNAL_ENGINE_WEIGHTS: Record<TimingSignalEngineKey, number> = {
  multiTimeframeAlignment: 0.24,
  relativeStrength: 0.2,
  volatilityPercentile: 0.14,
  liquidityStructure: 0.14,
  breakoutFailure: 0.14,
  gapVolumeQuality: 0.14,
};

export const DEFAULT_TIMING_PRESET_CONFIG: TimingPresetConfig = {
  contextWeights: {
    signalContext: 1,
    marketContext: 0.9,
    positionContext: 0.8,
    feedbackContext: 0.6,
  },
  signalEngineWeights: DEFAULT_SIGNAL_ENGINE_WEIGHTS,
  positionWeights: {
    invalidationRiskPenalty: 12,
    matureGainTrimBoost: 10,
    lossNearInvalidationPenalty: 14,
    earlyEntryBonus: 4,
  },
  feedbackPolicy: {
    lookbackDays: 180,
    minimumSamples: 12,
    weightStep: 0.15,
    actionThresholdStep: 3,
    successRateDeltaThreshold: 8,
    averageReturnDeltaThreshold: 2,
  },
  confidenceThresholds: {
    signalStrengthWeight: 0.55,
    alignmentWeight: 35,
    riskPenaltyPerFlag: 4,
    neutralPenalty: 8,
    minConfidence: 25,
    maxConfidence: 95,
  },
  actionThresholds: {
    addConfidence: 74,
    addSignalStrength: 68,
    probeConfidence: 56,
    probeSignalStrength: 52,
    holdConfidence: 60,
    trimConfidence: 68,
    exitConfidence: 82,
  },
  reviewSchedule: {
    horizons: DEFAULT_TIMING_REVIEW_HORIZONS,
  },
};

export function resolveTimingPresetConfig(
  value?: TimingPresetConfig | null,
): TimingPresetConfig {
  return {
    contextWeights: {
      ...DEFAULT_TIMING_PRESET_CONFIG.contextWeights,
      ...value?.contextWeights,
    },
    signalEngineWeights: {
      ...DEFAULT_TIMING_PRESET_CONFIG.signalEngineWeights,
      ...value?.signalEngineWeights,
    },
    positionWeights: {
      ...DEFAULT_TIMING_PRESET_CONFIG.positionWeights,
      ...value?.positionWeights,
    },
    feedbackPolicy: {
      ...DEFAULT_TIMING_PRESET_CONFIG.feedbackPolicy,
      ...value?.feedbackPolicy,
    },
    confidenceThresholds: {
      ...DEFAULT_TIMING_PRESET_CONFIG.confidenceThresholds,
      ...value?.confidenceThresholds,
    },
    actionThresholds: {
      ...DEFAULT_TIMING_PRESET_CONFIG.actionThresholds,
      ...value?.actionThresholds,
    },
    reviewSchedule: {
      horizons: value?.reviewSchedule?.horizons?.length
        ? value.reviewSchedule.horizons
        : DEFAULT_TIMING_REVIEW_HORIZONS,
    },
  };
}

import { resolveTimingPresetConfig } from "~/modules/timing/server/domain/preset";
import type {
  TimingFeedbackContext,
  TimingFeedbackObservationRecord,
  TimingPresetAdjustmentPatch,
  TimingPresetAdjustmentSuggestionDraft,
  TimingPresetConfig,
  TimingSignalEngineKey,
} from "~/modules/timing/server/domain/types";
import type { PrismaTimingFeedbackObservationRepository } from "~/modules/timing/server/infrastructure/prisma-timing-feedback-observation-repository";
import type { PrismaTimingPresetAdjustmentSuggestionRepository } from "~/modules/timing/server/infrastructure/prisma-timing-preset-adjustment-suggestion-repository";

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function average(values: number[]) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

type BucketStats = {
  successRate: number;
  avgReturnPct: number;
  avgMfe: number;
  avgMae: number;
  sampleSize: number;
};

function buildStats(records: TimingFeedbackObservationRecord[]): BucketStats {
  return {
    successRate:
      records.length > 0
        ? (records.filter((item) => item.verdict === "SUCCESS").length /
            records.length) *
          100
        : 0,
    avgReturnPct: average(records.map((item) => item.actualReturnPct)),
    avgMfe: average(records.map((item) => item.maxFavorableExcursionPct)),
    avgMae: average(records.map((item) => item.maxAdverseExcursionPct)),
    sampleSize: records.length,
  };
}

export function applyTimingPresetPatch(
  base: TimingPresetConfig,
  patch: TimingPresetAdjustmentPatch,
): TimingPresetConfig {
  return resolveTimingPresetConfig({
    ...base,
    signalEngineWeights: {
      ...base.signalEngineWeights,
      ...patch.signalEngineWeights,
    },
    contextWeights: {
      ...base.contextWeights,
      ...patch.contextWeights,
    },
    actionThresholds: {
      ...base.actionThresholds,
      ...patch.actionThresholds,
    },
  });
}

export class TimingFeedbackService {
  constructor(
    private readonly deps: {
      observationRepository: PrismaTimingFeedbackObservationRepository;
      suggestionRepository: PrismaTimingPresetAdjustmentSuggestionRepository;
    },
  ) {}

  applyPatch(
    presetConfig: TimingPresetConfig,
    patch: TimingPresetAdjustmentPatch,
  ) {
    return applyTimingPresetPatch(
      resolveTimingPresetConfig(presetConfig),
      patch,
    );
  }

  async buildContext(params: {
    userId: string;
    presetId?: string | null;
  }): Promise<TimingFeedbackContext> {
    const [pending, applied] = await Promise.all([
      this.deps.suggestionRepository.listForUser({
        userId: params.userId,
        presetId: params.presetId ?? undefined,
        status: "PENDING",
        limit: 50,
      }),
      this.deps.suggestionRepository.listForUser({
        userId: params.userId,
        presetId: params.presetId ?? undefined,
        status: "APPLIED",
        limit: 5,
      }),
    ]);

    return {
      presetId: params.presetId,
      learningSummary: applied.length
        ? `已采纳 ${applied.length} 条反馈调整，最近一次为「${applied[0]?.title}」。`
        : "尚未采纳反馈调整建议。",
      pendingSuggestionCount: pending.length,
      adoptedSuggestionCount: applied.length,
      highlights: applied.map((item) => item.title).slice(0, 3),
    };
  }

  async refreshSuggestions(params: {
    userId: string;
    presetId?: string | null;
    presetConfig?: TimingPresetConfig | null;
  }) {
    const presetConfig = resolveTimingPresetConfig(params.presetConfig);
    const feedbackPolicy = presetConfig.feedbackPolicy ?? {};
    const lookbackDays = feedbackPolicy.lookbackDays ?? 180;
    const minimumSamples = feedbackPolicy.minimumSamples ?? 12;
    const weightStep = feedbackPolicy.weightStep ?? 0.15;
    const actionThresholdStep = feedbackPolicy.actionThresholdStep ?? 3;
    const successRateDeltaThreshold =
      feedbackPolicy.successRateDeltaThreshold ?? 8;
    const averageReturnDeltaThreshold =
      feedbackPolicy.averageReturnDeltaThreshold ?? 2;

    const observations = await this.deps.observationRepository.listForPreset({
      userId: params.userId,
      presetId: params.presetId,
      lookbackDays,
    });

    if (observations.length < minimumSamples) {
      return this.deps.suggestionRepository.replacePendingForPreset({
        userId: params.userId,
        presetId: params.presetId,
        items: [],
      });
    }

    const suggestions: TimingPresetAdjustmentSuggestionDraft[] = [];
    const baseline = buildStats(observations);

    for (const engineKey of Object.keys(
      presetConfig.signalEngineWeights ?? {},
    ) as TimingSignalEngineKey[]) {
      const positiveBucket = observations.filter((item) => {
        const engine = item.signalContext.engineBreakdown.find(
          (entry) => entry.key === engineKey,
        );
        return engine ? engine.score >= 20 : false;
      });
      const negativeBucket = observations.filter((item) => {
        const engine = item.signalContext.engineBreakdown.find(
          (entry) => entry.key === engineKey,
        );
        return engine ? engine.score <= -20 : false;
      });

      if (positiveBucket.length < 4 || negativeBucket.length < 4) {
        continue;
      }

      const positiveStats = buildStats(positiveBucket);
      const negativeStats = buildStats(negativeBucket);
      const successRateDiff =
        positiveStats.successRate - negativeStats.successRate;
      const avgReturnDiff =
        positiveStats.avgReturnPct - negativeStats.avgReturnPct;

      if (
        Math.abs(successRateDiff) < successRateDeltaThreshold ||
        Math.abs(avgReturnDiff) < averageReturnDeltaThreshold
      ) {
        continue;
      }

      const direction = successRateDiff > 0 && avgReturnDiff > 0 ? 1 : -1;
      const currentWeight = presetConfig.signalEngineWeights?.[engineKey] ?? 1;
      const nextWeight = clamp(currentWeight + weightStep * direction, 0.2, 2);

      suggestions.push({
        userId: params.userId,
        presetId: params.presetId,
        kind: "SIGNAL_ENGINE_WEIGHT",
        status: "PENDING",
        title: `${engineKey} 权重${direction > 0 ? "上调" : "下调"}建议`,
        summary: `${engineKey} 在最近样本中的成功率差值 ${round(successRateDiff)}pct，平均收益差值 ${round(avgReturnDiff)}pct。`,
        patch: {
          signalEngineWeights: {
            [engineKey]: round(nextWeight),
          },
        },
        metrics: {
          successRateDiff: round(successRateDiff),
          avgReturnDiff: round(avgReturnDiff),
          positiveSampleSize: positiveStats.sampleSize,
          negativeSampleSize: negativeStats.sampleSize,
        },
        appliedAt: null,
        dismissedAt: null,
      });
    }

    const states = ["RISK_ON", "NEUTRAL", "RISK_OFF"] as const;
    let bestStateDelta = 0;
    let bestState: (typeof states)[number] | null = null;
    let bestStateStats: BucketStats | null = null;
    for (const state of states) {
      const bucket = observations.filter(
        (item) => item.marketContext?.state === state,
      );
      if (bucket.length < 4) {
        continue;
      }

      const stats = buildStats(bucket);
      const successRateDiff = stats.successRate - baseline.successRate;
      const avgReturnDiff = stats.avgReturnPct - baseline.avgReturnPct;
      const score = Math.abs(successRateDiff) + Math.abs(avgReturnDiff);
      if (
        Math.abs(successRateDiff) >= successRateDeltaThreshold &&
        Math.abs(avgReturnDiff) >= averageReturnDeltaThreshold &&
        score > bestStateDelta
      ) {
        bestStateDelta = score;
        bestState = state;
        bestStateStats = stats;
      }
    }

    if (bestState && bestStateStats) {
      const currentWeight = presetConfig.contextWeights?.marketContext ?? 0.9;
      const direction =
        bestStateStats.successRate >= baseline.successRate &&
        bestStateStats.avgReturnPct >= baseline.avgReturnPct
          ? 1
          : -1;
      suggestions.push({
        userId: params.userId,
        presetId: params.presetId,
        kind: "CONTEXT_WEIGHT",
        status: "PENDING",
        title: "市场上下文权重调整建议",
        summary: `${bestState} 环境样本相对全样本更${direction > 0 ? "有效" : "失效"}，建议调整 marketContext 权重。`,
        patch: {
          contextWeights: {
            marketContext: round(
              clamp(currentWeight + weightStep * direction, 0.2, 2),
            ),
          },
        },
        metrics: {
          state: bestState,
          successRate: round(bestStateStats.successRate),
          avgReturnPct: round(bestStateStats.avgReturnPct),
          sampleSize: bestStateStats.sampleSize,
        },
        appliedAt: null,
        dismissedAt: null,
      });
    }

    const bullishActions = observations.filter((item) =>
      ["ADD", "PROBE"].includes(item.expectedAction),
    );
    if (bullishActions.length >= 4) {
      const bullishStats = buildStats(bullishActions);
      const successRateDiff = bullishStats.successRate - baseline.successRate;
      const avgReturnDiff = bullishStats.avgReturnPct - baseline.avgReturnPct;

      if (
        Math.abs(successRateDiff) >= successRateDeltaThreshold &&
        Math.abs(avgReturnDiff) >= averageReturnDeltaThreshold
      ) {
        const direction = successRateDiff > 0 && avgReturnDiff > 0 ? -1 : 1;
        const currentAdd = presetConfig.actionThresholds?.addConfidence ?? 74;
        const currentProbe =
          presetConfig.actionThresholds?.probeConfidence ?? 56;
        suggestions.push({
          userId: params.userId,
          presetId: params.presetId,
          kind: "ACTION_THRESHOLD",
          status: "PENDING",
          title: "进攻动作阈值调整建议",
          summary: `ADD/PROBE 样本相对全样本成功率差值 ${round(successRateDiff)}pct，平均收益差值 ${round(avgReturnDiff)}pct。`,
          patch: {
            actionThresholds: {
              addConfidence: clamp(
                currentAdd + actionThresholdStep * direction,
                0,
                100,
              ),
              probeConfidence: clamp(
                currentProbe + actionThresholdStep * direction,
                0,
                100,
              ),
            },
          },
          metrics: {
            successRateDiff: round(successRateDiff),
            avgReturnDiff: round(avgReturnDiff),
            sampleSize: bullishStats.sampleSize,
          },
          appliedAt: null,
          dismissedAt: null,
        });
      }
    }

    return this.deps.suggestionRepository.replacePendingForPreset({
      userId: params.userId,
      presetId: params.presetId,
      items: suggestions,
    });
  }
}

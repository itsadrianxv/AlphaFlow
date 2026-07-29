import type { TimingTimeframe } from "~/server/domain/timing/types";

export const KRONOS_MIN_LOOKBACK_BARS = 120;

export const KRONOS_PREDICTION_LENGTHS: Record<TimingTimeframe, number> = {
  DAILY: 60,
  WEEKLY: 12,
  MONTHLY: 6,
  MINUTE_60: 60,
  MINUTE_30: 60,
  MINUTE_15: 60,
  MINUTE_1: 60,
};

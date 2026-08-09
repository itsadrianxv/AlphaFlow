import type { SchedulingTier } from "./types";

export const TIER_WEIGHTS: Record<SchedulingTier, number> = {
  INTERACTIVE: 5,
  TIME_CRITICAL: 3,
  BACKGROUND: 1,
};

export const BACKLOG_FACTORS: Record<SchedulingTier, number> = {
  INTERACTIVE: 4,
  TIME_CRITICAL: 20,
  BACKGROUND: 50,
};

export const RETRY_BUDGET_MS: Record<SchedulingTier, number> = {
  INTERACTIVE: 120_000,
  TIME_CRITICAL: 20 * 60_000,
  BACKGROUND: 24 * 60 * 60_000,
};

export const MAX_ATTEMPTS: Record<SchedulingTier, number> = {
  INTERACTIVE: 3,
  TIME_CRITICAL: 5,
  BACKGROUND: 6,
};

export const DELIVERY_MAX_ATTEMPTS = 5;
export const DELIVERY_RETRY_BUDGET_MS = 30 * 60_000;
export const FEISHU_DELIVERY_MAX_ATTEMPTS = 5;

export const CIRCUIT_RETRY_DELAYS_MS = [
  60_000,
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  30 * 60_000,
] as const;

export const DEFAULT_RETRY_DELAYS_MS = [
  60_000,
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  30 * 60_000,
] as const;

export function backlogLimit(
  tier: SchedulingTier,
  concurrency: number,
): number {
  return BACKLOG_FACTORS[tier] * Math.max(1, concurrency);
}

export function defaultMaxAttempts(tier: SchedulingTier): number {
  return MAX_ATTEMPTS[tier];
}

export function defaultRetryDeadline(tier: SchedulingTier, now: Date): Date {
  return new Date(now.getTime() + RETRY_BUDGET_MS[tier]);
}

export function retryDelayMs(
  attempt: number,
  delays: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
): number {
  const index = Math.max(0, Math.min(delays.length - 1, attempt - 1));
  return delays[index] ?? delays[delays.length - 1] ?? 60_000;
}

export function weightedTierOrder(
  available: ReadonlySet<SchedulingTier>,
  cursor: bigint,
): SchedulingTier[] {
  const sequence: SchedulingTier[] = [
    "INTERACTIVE",
    "INTERACTIVE",
    "INTERACTIVE",
    "INTERACTIVE",
    "INTERACTIVE",
    "TIME_CRITICAL",
    "TIME_CRITICAL",
    "TIME_CRITICAL",
    "BACKGROUND",
  ];
  const start = Number(cursor % BigInt(sequence.length));
  const result: SchedulingTier[] = [];
  for (let offset = 0; offset < sequence.length; offset += 1) {
    const tier = sequence[(start + offset) % sequence.length];
    if (tier && available.has(tier) && !result.includes(tier))
      result.push(tier);
  }
  for (const tier of ["INTERACTIVE", "TIME_CRITICAL", "BACKGROUND"] as const) {
    if (available.has(tier) && !result.includes(tier)) result.push(tier);
  }
  return result;
}

export function urgencyBucket(taskTarget: Date | null, now: Date): number {
  if (!taskTarget) return 3;
  const remaining = taskTarget.getTime() - now.getTime();
  if (remaining <= 5 * 60_000) return 0;
  if (remaining <= 30 * 60_000) return 1;
  return 2;
}

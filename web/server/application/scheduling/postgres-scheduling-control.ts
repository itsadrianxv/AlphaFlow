import { Prisma, type PrismaClient } from "@prisma/client";
import {
  type AdaptiveConcurrencyResult,
  type BacklogSnapshot,
  type CircuitBreaker,
  type ResourceOutcome,
  type ResourcePool,
  SchedulingInvariantError,
} from "~/server/domain/scheduling/types";
import {
  backlogInTransactionById,
  type CircuitRow,
  circuitFromRow,
  ensureCircuit,
  type PoolRow,
  poolFromRow,
  recordCircuitOutcomeInTransaction,
} from "./postgres-scheduling-storage";

export interface PostgresSchedulingControlOptions {
  now?: () => Date;
}

/** 资源池健康、熔断与并发校准 module。 */
export class PostgresSchedulingControl {
  private readonly now: () => Date;

  constructor(
    private readonly db: PrismaClient,
    options: PostgresSchedulingControlOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async getBacklog(poolId: string): Promise<BacklogSnapshot> {
    return this.db.$transaction((tx) =>
      backlogInTransactionById(tx, poolId, this.now()),
    );
  }

  async getPool(poolId: string): Promise<ResourcePool | null> {
    const rows = await this.db.$queryRaw<PoolRow[]>(Prisma.sql`
      SELECT "id", "poolKey", "resourceKind", "hardConcurrency", "currentConcurrency",
             "controlVersion", "lastHealthyAt", "healthySince", "successStreak", "latencyBaselineMs", "cooldownUntil"
        FROM "ResearchResourcePool" WHERE "id" = ${poolId}
    `);
    return rows[0] ? poolFromRow(rows[0]) : null;
  }

  async restartPool(poolId: string): Promise<ResourcePool> {
    const now = this.now();
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<PoolRow[]>(Prisma.sql`
        UPDATE "ResearchResourcePool"
           SET "currentConcurrency" = 1, "successStreak" = 0,
               "healthySince" = NULL, "cooldownUntil" = NULL,
               "controlVersion" = "controlVersion" + 1, "updatedAt" = ${now}
         WHERE "id" = ${poolId}
        RETURNING "id", "poolKey", "resourceKind", "hardConcurrency", "currentConcurrency",
          "controlVersion", "lastHealthyAt", "healthySince", "successStreak", "latencyBaselineMs", "cooldownUntil"
      `);
      if (!rows[0]) throw new SchedulingInvariantError("资源池不存在");
      return poolFromRow(rows[0]);
    });
  }

  async getCircuit(poolId: string): Promise<CircuitBreaker | null> {
    const rows = await this.db.$queryRaw<CircuitRow[]>(Prisma.sql`
      SELECT "resourcePoolId", "state", "version", "consecutiveFailures", "windowAttempts",
             "windowFailures", "openCount", "retryAfter", "halfOpenProbeTaskId", "blockedReason", "updatedAt"
        FROM "ResearchCircuitBreaker" WHERE "resourcePoolId" = ${poolId}
    `);
    return rows[0] ? circuitFromRow(rows[0]) : null;
  }

  async recordOutcome(
    poolId: string,
    outcome: ResourceOutcome,
  ): Promise<CircuitBreaker> {
    const now = outcome.at ?? this.now();
    return this.db.$transaction((tx) =>
      recordCircuitOutcomeInTransaction(tx, poolId, outcome, now),
    );
  }

  async blockConfiguration(
    poolId: string,
    reason: string,
  ): Promise<CircuitBreaker> {
    const now = this.now();
    return this.db.$transaction(async (tx) => {
      const circuits = await ensureCircuit(tx, poolId, now);
      if (!circuits[0])
        throw new SchedulingInvariantError("资源池熔断器不存在");
      const rows = await tx.$queryRaw<CircuitRow[]>(Prisma.sql`
        UPDATE "ResearchCircuitBreaker" SET "state" = 'CONFIG_BLOCKED', "blockedReason" = ${reason},
               "retryAfter" = NULL, "halfOpenProbeTaskId" = NULL, "version" = "version" + 1,
               "updatedAt" = ${now}
         WHERE "resourcePoolId" = ${poolId}
        RETURNING "resourcePoolId", "state", "version", "consecutiveFailures", "windowAttempts",
          "windowFailures", "openCount", "retryAfter", "halfOpenProbeTaskId", "blockedReason", "updatedAt"
      `);
      if (!rows[0]) throw new SchedulingInvariantError("资源池熔断器不存在");
      return circuitFromRow(rows[0]);
    });
  }

  async allowConfiguration(poolId: string): Promise<CircuitBreaker> {
    const now = this.now();
    return this.db.$transaction(async (tx) => {
      const circuits = await ensureCircuit(tx, poolId, now);
      if (!circuits[0])
        throw new SchedulingInvariantError("资源池熔断器不存在");
      const rows = await tx.$queryRaw<CircuitRow[]>(Prisma.sql`
        UPDATE "ResearchCircuitBreaker"
           SET "state" = 'CLOSED', "blockedReason" = NULL, "retryAfter" = NULL,
               "halfOpenProbeTaskId" = NULL, "consecutiveFailures" = 0,
               "windowAttempts" = 0, "windowFailures" = 0, "version" = "version" + 1,
               "updatedAt" = ${now}
         WHERE "resourcePoolId" = ${poolId}
        RETURNING "resourcePoolId", "state", "version", "consecutiveFailures", "windowAttempts",
          "windowFailures", "openCount", "retryAfter", "halfOpenProbeTaskId", "blockedReason", "updatedAt"
      `);
      if (!rows[0]) throw new SchedulingInvariantError("资源池熔断器不存在");
      return circuitFromRow(rows[0]);
    });
  }

  async recordAdaptiveOutcome(
    poolId: string,
    outcome: ResourceOutcome,
  ): Promise<AdaptiveConcurrencyResult> {
    const now = outcome.at ?? this.now();
    return this.db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<PoolRow[]>(Prisma.sql`
        SELECT "id", "poolKey", "resourceKind", "hardConcurrency", "currentConcurrency",
               "controlVersion", "lastHealthyAt", "healthySince", "successStreak", "latencyBaselineMs", "cooldownUntil"
          FROM "ResearchResourcePool" WHERE "id" = ${poolId} FOR UPDATE
      `);
      const pool = rows[0];
      if (!pool) throw new SchedulingInvariantError("资源池不存在");
      const previous = pool.currentConcurrency;
      let current = previous;
      let successStreak = pool.successStreak;
      let healthySince = pool.healthySince;
      let latencyBaselineMs = pool.latencyBaselineMs;
      let cooldownUntil = pool.cooldownUntil;
      let reason = "NO_CHANGE";
      if (outcome.kind === "RATE_LIMITED") {
        current = Math.max(1, Math.floor(previous / 2));
        successStreak = 0;
        healthySince = null;
        cooldownUntil = new Date(now.getTime() + 5 * 60_000);
        reason = "RATE_LIMITED_HALVED";
      } else if (
        outcome.kind === "TIMEOUT" ||
        outcome.kind === "LATENCY_HIGH"
      ) {
        current = Math.max(1, previous - 1);
        successStreak = 0;
        healthySince = null;
        cooldownUntil = new Date(now.getTime() + 5 * 60_000);
        reason = `${outcome.kind}_DECREASED`;
      } else if (outcome.kind === "SUCCESS") {
        successStreak += 1;
        healthySince ??= now;
        if (outcome.latencyMs !== undefined) {
          latencyBaselineMs =
            latencyBaselineMs === null
              ? outcome.latencyMs
              : Math.min(latencyBaselineMs, outcome.latencyMs);
        }
        const healthyLongEnough =
          now.getTime() - healthySince.getTime() >= 5 * 60_000;
        const latencyHealthy =
          outcome.latencyMs === undefined ||
          latencyBaselineMs === null ||
          outcome.latencyMs <= latencyBaselineMs * 2;
        if (
          successStreak >= 20 &&
          healthyLongEnough &&
          (!cooldownUntil || cooldownUntil <= now) &&
          current < pool.hardConcurrency &&
          latencyHealthy
        ) {
          current += 1;
          successStreak = 0;
          reason = "HEALTHY_STREAK_INCREASED";
        }
      }
      const updated = await tx.$queryRaw<PoolRow[]>(Prisma.sql`
        UPDATE "ResearchResourcePool"
           SET "currentConcurrency" = ${Math.min(pool.hardConcurrency, current)},
               "cooldownUntil" = ${cooldownUntil}, "healthySince" = ${healthySince},
               "successStreak" = ${successStreak}, "latencyBaselineMs" = ${latencyBaselineMs},
               "lastHealthyAt" = CASE WHEN ${outcome.kind === "SUCCESS"} THEN ${now} ELSE "lastHealthyAt" END,
               "controlVersion" = "controlVersion" + 1, "updatedAt" = ${now}
         WHERE "id" = ${poolId}
        RETURNING "id", "poolKey", "resourceKind", "hardConcurrency", "currentConcurrency",
          "controlVersion", "lastHealthyAt", "healthySince", "successStreak", "latencyBaselineMs", "cooldownUntil"
      `);
      const result = updated[0];
      if (!result) throw new SchedulingInvariantError("资源池更新失败");
      return {
        previous,
        current: result.currentConcurrency,
        changed: previous !== result.currentConcurrency,
        reason,
        cooldownUntil: result.cooldownUntil,
      };
    });
  }
}

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  backlogLimit,
  CIRCUIT_RETRY_DELAYS_MS,
} from "~/server/domain/scheduling/policies";
import {
  type BacklogSnapshot,
  type CircuitBreaker,
  type ResearchTask,
  type ResourceOutcome,
  type ResourcePermit,
  type ResourcePool,
  SchedulingInvariantError,
  type SchedulingTier,
} from "~/server/domain/scheduling/types";

export interface TaskRow {
  id: string;
  taskType: string;
  idempotencyKey: string;
  inputHash: string;
  inputContractVersion: string;
  inputJson: unknown;
  schedulingTier: SchedulingTier;
  resourcePoolId: string;
  fairnessKey: string;
  userId: string | null;
  parentTaskId: string | null;
  externalCopyId: string | null;
  targetCompletionAt: Date | null;
  status: ResearchTask["status"];
  attempts: number;
  maxAttempts: number;
  retryDeadline: Date;
  nextAttemptAt: Date | null;
  workerId: string | null;
  fencingToken: bigint;
  leaseExpiresAt: Date | null;
  heartbeatAt: Date | null;
  resultContractVersion: string | null;
  resultHash: string | null;
  resultJson: unknown | null;
  errorClass: string | null;
  retryability: ResearchTask["retryability"];
  terminalReason: string | null;
  oldestBacklogAgeMs: bigint | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PermitRow {
  id: string;
  resourcePoolId: string;
  taskId: string;
  permitKey: string;
  holderId: string;
  fencingToken: bigint;
  status: ResourcePermit["status"];
  acquiredAt: Date;
  leaseExpiresAt: Date;
  releasedAt: Date | null;
  releaseReason: string | null;
}

export interface PoolRow {
  id: string;
  poolKey: string;
  resourceKind: string;
  hardConcurrency: number;
  currentConcurrency: number;
  controlVersion: bigint;
  lastHealthyAt: Date | null;
  healthySince: Date | null;
  successStreak: number;
  latencyBaselineMs: number | null;
  cooldownUntil: Date | null;
}

export interface CircuitRow {
  resourcePoolId: string;
  state: CircuitBreaker["state"];
  version: bigint;
  consecutiveFailures: number;
  windowAttempts: number;
  windowFailures: number;
  openCount: number;
  retryAfter: Date | null;
  halfOpenProbeTaskId: string | null;
  blockedReason: string | null;
  updatedAt: Date;
}

export function taskFromRow(row: TaskRow): ResearchTask {
  return {
    id: row.id,
    taskType: row.taskType,
    idempotencyKey: row.idempotencyKey,
    inputHash: row.inputHash,
    inputContractVersion: row.inputContractVersion,
    input: row.inputJson,
    schedulingTier: row.schedulingTier,
    resourcePoolId: row.resourcePoolId,
    fairnessKey: row.fairnessKey,
    userId: row.userId,
    parentTaskId: row.parentTaskId,
    externalCopyId: row.externalCopyId,
    targetCompletionAt: row.targetCompletionAt,
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    retryDeadline: row.retryDeadline,
    nextAttemptAt: row.nextAttemptAt,
    workerId: row.workerId,
    fencingToken: BigInt(row.fencingToken),
    leaseExpiresAt: row.leaseExpiresAt,
    heartbeatAt: row.heartbeatAt,
    resultContractVersion: row.resultContractVersion,
    resultHash: row.resultHash,
    result: row.resultJson,
    errorClass: row.errorClass,
    retryability: row.retryability,
    terminalReason: row.terminalReason,
    oldestBacklogAgeMs:
      row.oldestBacklogAgeMs === null ? null : BigInt(row.oldestBacklogAgeMs),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function permitFromRow(row: PermitRow): ResourcePermit {
  return {
    ...row,
    fencingToken: BigInt(row.fencingToken),
  };
}

export function poolFromRow(row: PoolRow): ResourcePool {
  return {
    ...row,
    controlVersion: BigInt(row.controlVersion),
  };
}

export function circuitFromRow(row: CircuitRow): CircuitBreaker {
  return {
    ...row,
    version: BigInt(row.version),
  };
}

/** 在调用方已有事务中应用唯一的资源池熔断状态转换。 */
export async function recordCircuitOutcomeInTransaction(
  tx: Prisma.TransactionClient,
  poolId: string,
  outcome: ResourceOutcome,
  now: Date,
): Promise<CircuitBreaker> {
  const circuits = await ensureCircuit(tx, poolId, now);
  const current = circuits[0];
  if (!current) throw new SchedulingInvariantError("资源池熔断器不存在");
  if (current.state === "CONFIG_BLOCKED") return circuitFromRow(current);
  const failed = outcome.kind !== "SUCCESS";
  const nextConsecutive = failed ? current.consecutiveFailures + 1 : 0;
  const windowReset = current.windowAttempts >= 20;
  const nextAttempts = windowReset ? 1 : current.windowAttempts + 1;
  const nextFailures = windowReset
    ? failed
      ? 1
      : 0
    : current.windowFailures + (failed ? 1 : 0);
  const shouldOpen =
    current.state === "HALF_OPEN"
      ? failed
      : outcome.kind === "RATE_LIMITED" ||
        nextConsecutive >= 5 ||
        (nextAttempts >= 20 && nextFailures / nextAttempts >= 0.5);
  const delay =
    outcome.kind === "RATE_LIMITED"
      ? Math.max(
          outcome.retryAfterMs ?? 0,
          CIRCUIT_RETRY_DELAYS_MS[Math.min(current.openCount, 4)] ?? 60_000,
        )
      : (CIRCUIT_RETRY_DELAYS_MS[Math.min(current.openCount, 4)] ?? 60_000);
  const rows = await tx.$queryRaw<CircuitRow[]>(Prisma.sql`
    UPDATE "ResearchCircuitBreaker"
       SET "state" = CASE WHEN ${shouldOpen} THEN 'OPEN'
                          WHEN "state" = 'HALF_OPEN' AND ${!failed} THEN 'CLOSED'
                          ELSE "state" END,
           "consecutiveFailures" = ${nextConsecutive}, "windowAttempts" = ${nextAttempts},
           "windowFailures" = ${nextFailures},
           "openCount" = CASE WHEN ${shouldOpen} THEN "openCount" + 1 ELSE "openCount" END,
           "retryAfter" = CASE WHEN ${shouldOpen} THEN ${new Date(now.getTime() + delay)}
                                WHEN "state" = 'OPEN' THEN "retryAfter" ELSE NULL END,
           "halfOpenProbeTaskId" = NULL, "version" = "version" + 1, "updatedAt" = ${now}
     WHERE "resourcePoolId" = ${poolId}
    RETURNING "resourcePoolId", "state", "version", "consecutiveFailures", "windowAttempts",
      "windowFailures", "openCount", "retryAfter", "halfOpenProbeTaskId", "blockedReason", "updatedAt"
  `);
  if (!rows[0]) throw new SchedulingInvariantError("资源池熔断器更新失败");
  return circuitFromRow(rows[0]);
}

export function queryTask(
  tx: Prisma.TransactionClient,
  taskId: string,
  forUpdate = false,
): Promise<TaskRow[]> {
  const lockClause = forUpdate ? Prisma.sql` FOR UPDATE` : Prisma.empty;
  return tx.$queryRaw<TaskRow[]>(Prisma.sql`
    SELECT "id", "taskType", "idempotencyKey", "inputHash", "inputContractVersion",
           "inputJson", "schedulingTier", "resourcePoolId", "fairnessKey", "userId",
           "parentTaskId", "externalCopyId", "targetCompletionAt", "status", "attempts", "maxAttempts",
           "retryDeadline", "nextAttemptAt", "workerId", "fencingToken", "leaseExpiresAt",
           "heartbeatAt", "resultContractVersion", "resultHash", "resultJson", "errorClass",
           "retryability", "terminalReason", "oldestBacklogAgeMs", "createdAt", "updatedAt"
      FROM "ResearchTask" WHERE "id" = ${taskId}${lockClause}
  `);
}

export async function ensureCircuit(
  tx: Prisma.TransactionClient,
  poolId: string,
  now: Date,
): Promise<CircuitRow[]> {
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "ResearchCircuitBreaker" ("id", "resourcePoolId", "updatedAt")
    VALUES (${randomUUID()}, ${poolId}, ${now}) ON CONFLICT ("resourcePoolId") DO NOTHING
  `);
  return tx.$queryRaw<CircuitRow[]>(Prisma.sql`
    SELECT "resourcePoolId", "state", "version", "consecutiveFailures", "windowAttempts",
           "windowFailures", "openCount", "retryAfter", "halfOpenProbeTaskId", "blockedReason", "updatedAt"
      FROM "ResearchCircuitBreaker" WHERE "resourcePoolId" = ${poolId} FOR UPDATE
  `);
}

export async function oldestBacklogAge(
  tx: Prisma.TransactionClient,
  poolId: string,
  now: Date,
): Promise<bigint | null> {
  const rows = await tx.$queryRaw<Array<{ oldest: Date | null }>>(Prisma.sql`
    SELECT MIN("createdAt") AS oldest FROM "ResearchTask"
     WHERE "resourcePoolId" = ${poolId} AND "status" IN ('PENDING', 'RETRY_WAIT')
  `);
  return rows[0]?.oldest
    ? BigInt(Math.max(0, now.getTime() - rows[0].oldest.getTime()))
    : null;
}

export async function backlogInTransactionById(
  tx: Prisma.TransactionClient,
  poolId: string,
  now: Date,
): Promise<BacklogSnapshot> {
  const pools = await tx.$queryRaw<PoolRow[]>(Prisma.sql`
    SELECT "id", "poolKey", "resourceKind", "hardConcurrency", "currentConcurrency",
           "controlVersion", "lastHealthyAt", "healthySince", "successStreak", "latencyBaselineMs", "cooldownUntil"
      FROM "ResearchResourcePool" WHERE "id" = ${poolId}
  `);
  const pool = pools[0];
  if (!pool) throw new SchedulingInvariantError("资源池不存在");
  return backlogInTransaction(tx, pool, now);
}

export async function backlogInTransaction(
  tx: Prisma.TransactionClient,
  pool: PoolRow,
  now: Date,
): Promise<BacklogSnapshot> {
  const rows = await tx.$queryRaw<
    Array<{
      schedulingTier: SchedulingTier;
      count: bigint;
      oldest: Date | null;
    }>
  >(Prisma.sql`
    SELECT "schedulingTier", COUNT(*)::bigint AS count, MIN("createdAt") AS oldest
      FROM "ResearchTask"
     WHERE "resourcePoolId" = ${pool.id} AND "status" IN ('PENDING', 'RETRY_WAIT')
     GROUP BY "schedulingTier"
  `);
  const counts: Record<SchedulingTier, number> = {
    INTERACTIVE: 0,
    TIME_CRITICAL: 0,
    BACKGROUND: 0,
  };
  let oldest: Date | null = null;
  for (const row of rows) {
    counts[row.schedulingTier] = Number(row.count);
    if (row.oldest && (!oldest || row.oldest < oldest)) oldest = row.oldest;
  }
  return {
    resourcePoolId: pool.id,
    limits: {
      INTERACTIVE: backlogLimit("INTERACTIVE", pool.hardConcurrency),
      TIME_CRITICAL: backlogLimit("TIME_CRITICAL", pool.hardConcurrency),
      BACKGROUND: backlogLimit("BACKGROUND", pool.hardConcurrency),
    },
    counts,
    oldestAgeMs: oldest
      ? BigInt(Math.max(0, now.getTime() - oldest.getTime()))
      : null,
    total: counts.INTERACTIVE + counts.TIME_CRITICAL + counts.BACKGROUND,
  };
}

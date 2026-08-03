import { createHash, randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  backlogLimit,
  CIRCUIT_RETRY_DELAYS_MS,
  DEFAULT_RETRY_DELAYS_MS,
  defaultMaxAttempts,
  defaultRetryDeadline,
  retryDelayMs,
  weightedTierOrder,
} from "~/server/domain/scheduling/policies";
import {
  type AdmissionResult,
  type BacklogSnapshot,
  type CircuitBreaker,
  type ClaimedTask,
  type EnqueueTaskInput,
  LeaseLostError,
  type ResearchTask,
  type ResourceOutcome,
  type ResourcePermit,
  ResourcePermitUnavailableError,
  type ResourcePool,
  SchedulingInvariantError,
  type SchedulingTier,
  type TaskSettlement,
} from "~/server/domain/scheduling/types";

export {
  LeaseLostError,
  ResourcePermitUnavailableError,
  SchedulingInvariantError,
} from "~/server/domain/scheduling/types";

interface PostgresSchedulerOptions {
  now?: () => Date;
  leaseMs?: number;
  permitLeaseMs?: number;
  maxUserConcurrencyPerPool?: number;
  retryDelaysMs?: readonly number[];
}

interface TaskRow {
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

interface PermitRow {
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

interface PoolRow {
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

interface CircuitRow {
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

function taskFromRow(row: TaskRow): ResearchTask {
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

function permitFromRow(row: PermitRow): ResourcePermit {
  return {
    ...row,
    fencingToken: BigInt(row.fencingToken),
  };
}

function poolFromRow(row: PoolRow): ResourcePool {
  return {
    ...row,
    controlVersion: BigInt(row.controlVersion),
  };
}

function circuitFromRow(row: CircuitRow): CircuitBreaker {
  return {
    ...row,
    version: BigInt(row.version),
  };
}

function resultHash(result: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(result) ?? "null", "utf8")
    .digest("hex")}`;
}

function queryTask(
  tx: Prisma.TransactionClient,
  taskId: string,
  forUpdate = false,
): Promise<TaskRow[]> {
  const lockClause = forUpdate ? Prisma.sql` FOR UPDATE` : Prisma.empty;
  return tx.$queryRaw<TaskRow[]>(Prisma.sql`
    SELECT "id", "taskType", "idempotencyKey", "inputHash", "inputContractVersion",
           "inputJson", "schedulingTier", "resourcePoolId", "fairnessKey", "userId",
           "parentTaskId", "targetCompletionAt", "status", "attempts", "maxAttempts",
           "retryDeadline", "nextAttemptAt", "workerId", "fencingToken", "leaseExpiresAt",
           "heartbeatAt", "resultContractVersion", "resultHash", "resultJson", "errorClass",
           "retryability", "terminalReason", "oldestBacklogAgeMs", "createdAt", "updatedAt"
      FROM "ResearchTask" WHERE "id" = ${taskId}${lockClause}
  `);
}

/**
 * PostgreSQL adapter for the scheduling module. Every mutating operation uses
 * one transaction and keeps PostgreSQL as the source of task/permit truth.
 */
export class PostgresResearchScheduler {
  private readonly now: () => Date;
  private readonly leaseMs: number;
  private readonly permitLeaseMs: number;
  private readonly maxUserConcurrencyPerPool: number;
  private readonly retryDelaysMs: readonly number[];

  constructor(
    private readonly db: PrismaClient,
    options: PostgresSchedulerOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.leaseMs = options.leaseMs ?? 15 * 60_000;
    this.permitLeaseMs = options.permitLeaseMs ?? 60_000;
    this.maxUserConcurrencyPerPool = options.maxUserConcurrencyPerPool ?? 1;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    if (
      this.leaseMs <= 0 ||
      this.permitLeaseMs <= 0 ||
      this.maxUserConcurrencyPerPool <= 0
    ) {
      throw new SchedulingInvariantError("任务 lease 必须为正数");
    }
  }

  async enqueue(input: EnqueueTaskInput): Promise<AdmissionResult> {
    const now = this.now();
    return this.db.$transaction(async (tx) => {
      const duplicate = await tx.$queryRaw<TaskRow[]>(Prisma.sql`
        SELECT "id", "taskType", "idempotencyKey", "inputHash", "inputContractVersion",
               "inputJson", "schedulingTier", "resourcePoolId", "fairnessKey", "userId",
               "parentTaskId", "targetCompletionAt", "status", "attempts", "maxAttempts",
               "retryDeadline", "nextAttemptAt", "workerId", "fencingToken", "leaseExpiresAt",
               "heartbeatAt", "resultContractVersion", "resultHash", "resultJson", "errorClass",
               "retryability", "terminalReason", "oldestBacklogAgeMs", "createdAt", "updatedAt"
          FROM "ResearchTask" WHERE "idempotencyKey" = ${input.idempotencyKey}
          FOR UPDATE
      `);
      if (duplicate[0]) {
        return {
          decision: "DEDUPLICATED",
          reason: "IDEMPOTENCY_KEY_REUSED",
          task: taskFromRow(duplicate[0]),
          oldestBacklogAgeMs: await this.oldestBacklogAge(
            tx,
            input.resourcePoolId,
            now,
          ),
        };
      }
      const pools = await tx.$queryRaw<PoolRow[]>(Prisma.sql`
        SELECT "id", "poolKey", "resourceKind", "hardConcurrency", "currentConcurrency",
               "controlVersion", "lastHealthyAt", "healthySince", "successStreak", "latencyBaselineMs", "cooldownUntil"
          FROM "ResearchResourcePool" WHERE "id" = ${input.resourcePoolId} FOR UPDATE
      `);
      const pool = pools[0];
      if (!pool) throw new SchedulingInvariantError("资源池不存在");
      const circuits = await this.ensureCircuit(tx, pool.id, now);
      const circuit = circuits[0];
      if (!circuit) throw new SchedulingInvariantError("资源池熔断器不存在");
      if (circuit.state === "CONFIG_BLOCKED") {
        return {
          decision: "REJECTED",
          reason: circuit.blockedReason ?? "RESOURCE_CONFIG_BLOCKED",
          task: null,
          oldestBacklogAgeMs: await this.oldestBacklogAge(tx, pool.id, now),
        };
      }
      if (
        circuit.state === "OPEN" &&
        (!circuit.retryAfter || circuit.retryAfter > now)
      ) {
        return {
          decision: "REJECTED",
          reason: "RESOURCE_CIRCUIT_OPEN",
          task: null,
          oldestBacklogAgeMs: await this.oldestBacklogAge(tx, pool.id, now),
        };
      }
      const backlog = await this.backlogInTransaction(tx, pool, now);
      const tierCount = backlog.counts[input.schedulingTier];
      const limit = backlog.limits[input.schedulingTier];
      if (tierCount >= limit) {
        const decision =
          input.schedulingTier === "INTERACTIVE"
            ? "BUSY"
            : input.schedulingTier === "TIME_CRITICAL"
              ? "MERGED"
              : "PAUSED";
        return {
          decision,
          reason:
            input.schedulingTier === "BACKGROUND"
              ? "BACKGROUND_BACKLOG_PAUSED"
              : `${input.schedulingTier}_BACKLOG_LIMIT`,
          task: null,
          oldestBacklogAgeMs: backlog.oldestAgeMs,
        };
      }
      const id = randomUUID();
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "ResearchTask" (
          "id", "taskType", "idempotencyKey", "inputHash", "inputContractVersion", "inputJson",
          "schedulingTier", "resourcePoolId", "fairnessKey", "userId", "parentTaskId",
          "targetCompletionAt", "status", "maxAttempts", "retryDeadline", "oldestBacklogAgeMs"
        ) VALUES (
          ${id}, ${input.taskType}, ${input.idempotencyKey}, ${input.inputHash}, ${input.inputContractVersion},
          ${JSON.stringify(input.input)}::jsonb, ${input.schedulingTier}, ${input.resourcePoolId},
          ${input.fairnessKey}, ${input.userId ?? null}, ${input.parentTaskId ?? null},
          ${input.targetCompletionAt ?? null}, 'PENDING',
          ${input.maxAttempts ?? defaultMaxAttempts(input.schedulingTier)},
          ${input.retryDeadline ?? defaultRetryDeadline(input.schedulingTier, now)}, 0
        )
      `);
      const rows = await queryTask(tx, id);
      if (!rows[0]) throw new SchedulingInvariantError("任务写入后无法读取");
      return {
        decision: "ACCEPTED",
        reason: "ADMITTED",
        task: taskFromRow(rows[0]),
        oldestBacklogAgeMs: backlog.oldestAgeMs,
      };
    });
  }

  async claim(poolId: string, workerId: string): Promise<ClaimedTask | null> {
    const now = this.now();
    return this.db.$transaction(async (tx) => {
      const pools = await tx.$queryRaw<PoolRow[]>(Prisma.sql`
        SELECT "id", "poolKey", "resourceKind", "hardConcurrency", "currentConcurrency",
               "controlVersion", "lastHealthyAt", "healthySince", "successStreak", "latencyBaselineMs", "cooldownUntil"
          FROM "ResearchResourcePool" WHERE "id" = ${poolId} FOR UPDATE
      `);
      const pool = pools[0];
      if (!pool) throw new SchedulingInvariantError("资源池不存在");
      await tx.$executeRaw(Prisma.sql`
        UPDATE "ResearchResourcePermit"
           SET "status" = 'EXPIRED', "releasedAt" = ${now}, "releaseReason" = 'permit_lease_expired'
         WHERE "resourcePoolId" = ${poolId} AND "status" = 'ACTIVE' AND "leaseExpiresAt" <= ${now}
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "ResearchTask"
           SET "status" = CASE WHEN "attempts" < "maxAttempts" AND "retryDeadline" > ${now}
                               THEN 'RETRY_WAIT' ELSE 'FAILED' END,
               "nextAttemptAt" = CASE WHEN "attempts" < "maxAttempts" AND "retryDeadline" > ${now}
                                      THEN ${now} ELSE NULL END,
               "workerId" = NULL, "leaseExpiresAt" = NULL, "heartbeatAt" = NULL,
               "errorClass" = 'LEASE_EXPIRED', "updatedAt" = ${now}
         WHERE "resourcePoolId" = ${poolId} AND "status" = 'RUNNING' AND "leaseExpiresAt" <= ${now}
      `);
      const circuits = await this.ensureCircuit(tx, poolId, now);
      const circuit = circuits[0];
      if (!circuit || circuit.state === "CONFIG_BLOCKED") return null;
      if (circuit.state === "OPEN") {
        if (
          !circuit.retryAfter ||
          circuit.retryAfter > now ||
          circuit.halfOpenProbeTaskId
        )
          return null;
        const transitioned = await tx.$executeRaw(Prisma.sql`
          UPDATE "ResearchCircuitBreaker" SET "state" = 'HALF_OPEN', "version" = "version" + 1,
                 "updatedAt" = ${now} WHERE "resourcePoolId" = ${poolId} AND "state" = 'OPEN'
        `);
        if (transitioned !== 1) return null;
        circuit.state = "HALF_OPEN";
        circuit.version += 1n;
        circuit.updatedAt = now;
      }
      if (circuit.state === "HALF_OPEN" && circuit.halfOpenProbeTaskId)
        return null;
      const active = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count FROM "ResearchResourcePermit"
         WHERE "resourcePoolId" = ${poolId} AND "status" = 'ACTIVE' AND "leaseExpiresAt" > ${now}
      `);
      if (Number(active[0]?.count ?? 0n) >= pool.currentConcurrency)
        return null;

      const rows = await tx.$queryRaw<TaskRow[]>(Prisma.sql`
        SELECT "id", "taskType", "idempotencyKey", "inputHash", "inputContractVersion",
               "inputJson", "schedulingTier", "resourcePoolId", "fairnessKey", "userId",
               "parentTaskId", "targetCompletionAt", "status", "attempts", "maxAttempts",
               "retryDeadline", "nextAttemptAt", "workerId", "fencingToken", "leaseExpiresAt",
               "heartbeatAt", "resultContractVersion", "resultHash", "resultJson", "errorClass",
               "retryability", "terminalReason", "oldestBacklogAgeMs", "createdAt", "updatedAt"
          FROM "ResearchTask"
         WHERE "resourcePoolId" = ${poolId}
           AND "status" IN ('PENDING', 'RETRY_WAIT')
           AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})
           AND "retryDeadline" > ${now} AND "attempts" < "maxAttempts"
         ORDER BY CASE
           WHEN "targetCompletionAt" IS NULL THEN 3
           WHEN "targetCompletionAt" <= ${new Date(now.getTime() + 5 * 60_000)} THEN 0
           WHEN "targetCompletionAt" <= ${new Date(now.getTime() + 30 * 60_000)} THEN 1
           ELSE 2 END,
           "fairnessKey", "createdAt"
         FOR UPDATE SKIP LOCKED LIMIT 200
      `);
      const activeUsers = await tx.$queryRaw<
        Array<{ userId: string; count: bigint }>
      >(Prisma.sql`
        SELECT "userId", COUNT(*)::bigint AS count
          FROM "ResearchTask"
         WHERE "resourcePoolId" = ${poolId} AND "status" = 'RUNNING' AND "userId" IS NOT NULL
         GROUP BY "userId"
      `);
      const activeUserCounts = new Map(
        activeUsers.map((row) => [row.userId, Number(row.count)]),
      );
      const availableTiers = new Set(rows.map((row) => row.schedulingTier));
      const tier = weightedTierOrder(
        availableTiers,
        BigInt(pool.controlVersion),
      )[0];
      if (!tier) return null;
      const candidates = rows.filter((row) => row.schedulingTier === tier);
      const eligible = candidates.filter((row) => {
        if (!row.userId) return true;
        return (
          (activeUserCounts.get(row.userId) ?? 0) <
          this.maxUserConcurrencyPerPool
        );
      });
      const fairnessKeys = [
        ...new Set(eligible.map((row) => row.fairnessKey)),
      ].sort();
      const fairnessStart = Number(
        BigInt(pool.controlVersion) % BigInt(Math.max(1, fairnessKeys.length)),
      );
      const orderedFairnessKeys = fairnessKeys
        .slice(fairnessStart)
        .concat(fairnessKeys.slice(0, fairnessStart));
      const candidate = orderedFairnessKeys.flatMap((fairnessKey) =>
        eligible
          .filter((row) => row.fairnessKey === fairnessKey)
          .sort(
            (left, right) =>
              left.createdAt.getTime() - right.createdAt.getTime(),
          ),
      )[0];
      if (!candidate) return null;
      const nextToken = BigInt(candidate.fencingToken) + 1n;
      const updated = await tx.$queryRaw<TaskRow[]>(Prisma.sql`
        UPDATE "ResearchTask"
           SET "status" = 'RUNNING', "attempts" = "attempts" + 1, "workerId" = ${workerId},
               "fencingToken" = ${nextToken}, "leaseExpiresAt" = ${new Date(now.getTime() + this.leaseMs)},
               "heartbeatAt" = ${now}, "nextAttemptAt" = NULL,
               "oldestBacklogAgeMs" = EXTRACT(EPOCH FROM (${now} - "createdAt")) * 1000,
               "updatedAt" = ${now}
         WHERE "id" = ${candidate.id} AND "fencingToken" = ${candidate.fencingToken}
           AND "status" IN ('PENDING', 'RETRY_WAIT')
        RETURNING "id", "taskType", "idempotencyKey", "inputHash", "inputContractVersion",
          "inputJson", "schedulingTier", "resourcePoolId", "fairnessKey", "userId", "parentTaskId",
          "targetCompletionAt", "status", "attempts", "maxAttempts", "retryDeadline", "nextAttemptAt",
          "workerId", "fencingToken", "leaseExpiresAt", "heartbeatAt", "resultContractVersion",
          "resultHash", "resultJson", "errorClass", "retryability", "terminalReason",
          "oldestBacklogAgeMs", "createdAt", "updatedAt"
      `);
      const taskRow = updated[0];
      if (!taskRow) return null;
      const permitId = randomUUID();
      const permitRows = await tx.$queryRaw<PermitRow[]>(Prisma.sql`
        INSERT INTO "ResearchResourcePermit" (
          "id", "resourcePoolId", "taskId", "permitKey", "holderId", "fencingToken",
          "status", "acquiredAt", "leaseExpiresAt"
        ) VALUES (
          ${permitId}, ${poolId}, ${candidate.id},
          ${`${candidate.id}:${nextToken.toString()}:primary`}, ${workerId}, ${nextToken},
          'ACTIVE', ${now}, ${new Date(now.getTime() + this.permitLeaseMs)}
        )
        RETURNING "id", "resourcePoolId", "taskId", "permitKey", "holderId", "fencingToken",
          "status", "acquiredAt", "leaseExpiresAt", "releasedAt", "releaseReason"
      `);
      await tx.$executeRaw(Prisma.sql`
        UPDATE "ResearchResourcePool" SET "controlVersion" = "controlVersion" + 1, "updatedAt" = ${now}
         WHERE "id" = ${poolId}
      `);
      if (circuit.state === "HALF_OPEN") {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "ResearchCircuitBreaker" SET "halfOpenProbeTaskId" = ${candidate.id}, "updatedAt" = ${now}
           WHERE "resourcePoolId" = ${poolId} AND "state" = 'HALF_OPEN'
        `);
      }
      if (!permitRows[0])
        throw new ResourcePermitUnavailableError("资源许可写入失败");
      return {
        task: taskFromRow(taskRow),
        permit: permitFromRow(permitRows[0]),
      };
    });
  }

  async renew(
    taskId: string,
    fencingToken: bigint,
    holderId: string,
  ): Promise<ClaimedTask> {
    const now = this.now();
    return this.db.$transaction(async (tx) => {
      const tasks = await tx.$queryRaw<TaskRow[]>(Prisma.sql`
        UPDATE "ResearchTask"
           SET "heartbeatAt" = ${now}, "leaseExpiresAt" = ${new Date(now.getTime() + this.leaseMs)},
               "updatedAt" = ${now}
         WHERE "id" = ${taskId} AND "fencingToken" = ${fencingToken} AND "workerId" = ${holderId}
           AND "status" = 'RUNNING' AND "leaseExpiresAt" > ${now}
        RETURNING "id", "taskType", "idempotencyKey", "inputHash", "inputContractVersion",
          "inputJson", "schedulingTier", "resourcePoolId", "fairnessKey", "userId", "parentTaskId",
          "targetCompletionAt", "status", "attempts", "maxAttempts", "retryDeadline", "nextAttemptAt",
          "workerId", "fencingToken", "leaseExpiresAt", "heartbeatAt", "resultContractVersion",
          "resultHash", "resultJson", "errorClass", "retryability", "terminalReason",
          "oldestBacklogAgeMs", "createdAt", "updatedAt"
      `);
      if (!tasks[0]) throw new LeaseLostError();
      const permits = await tx.$queryRaw<PermitRow[]>(Prisma.sql`
        UPDATE "ResearchResourcePermit"
           SET "leaseExpiresAt" = ${new Date(now.getTime() + this.permitLeaseMs)}
         WHERE "taskId" = ${taskId} AND "holderId" = ${holderId} AND "fencingToken" = ${fencingToken}
           AND "status" = 'ACTIVE' AND "leaseExpiresAt" > ${now}
        RETURNING "id", "resourcePoolId", "taskId", "permitKey", "holderId", "fencingToken",
          "status", "acquiredAt", "leaseExpiresAt", "releasedAt", "releaseReason"
      `);
      if (!permits[0])
        throw new ResourcePermitUnavailableError("任务缺少有效资源许可");
      return { task: taskFromRow(tasks[0]), permit: permitFromRow(permits[0]) };
    });
  }

  async acquireNestedPermit(input: {
    taskId: string;
    resourcePoolId: string;
    holderId: string;
    fencingToken: bigint;
    permitKey?: string;
    leaseMs?: number;
  }): Promise<ResourcePermit> {
    const now = this.now();
    return this.db.$transaction(async (tx) => {
      const taskRows = await queryTask(tx, input.taskId, true);
      const task = taskRows[0];
      if (
        !task ||
        task.status !== "RUNNING" ||
        task.fencingToken !== input.fencingToken ||
        task.workerId !== input.holderId ||
        !task.leaseExpiresAt ||
        task.leaseExpiresAt <= now
      )
        throw new LeaseLostError("嵌套调用不能使用旧 fencing token");
      if (task.resourcePoolId !== input.resourcePoolId) {
        throw new ResourcePermitUnavailableError(
          "嵌套调用必须先以目标资源池创建子任务，不能跨池复用父任务许可",
        );
      }
      const pools = await tx.$queryRaw<PoolRow[]>(Prisma.sql`
        SELECT "id", "poolKey", "resourceKind", "hardConcurrency", "currentConcurrency",
               "controlVersion", "lastHealthyAt", "healthySince", "successStreak", "latencyBaselineMs", "cooldownUntil"
          FROM "ResearchResourcePool" WHERE "id" = ${input.resourcePoolId} FOR UPDATE
      `);
      const pool = pools[0];
      if (!pool) throw new SchedulingInvariantError("资源池不存在");
      const circuits = await this.ensureCircuit(tx, pool.id, now);
      if (
        !circuits[0] ||
        circuits[0].state === "OPEN" ||
        circuits[0].state === "CONFIG_BLOCKED"
      ) {
        throw new ResourcePermitUnavailableError("资源池熔断或配置阻断");
      }
      const active = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
        SELECT COUNT(*)::bigint AS count FROM "ResearchResourcePermit"
         WHERE "resourcePoolId" = ${pool.id} AND "status" = 'ACTIVE' AND "leaseExpiresAt" > ${now}
      `);
      const existing = input.permitKey
        ? await tx.$queryRaw<PermitRow[]>(Prisma.sql`
            SELECT "id", "resourcePoolId", "taskId", "permitKey", "holderId", "fencingToken", "status",
                   "acquiredAt", "leaseExpiresAt", "releasedAt", "releaseReason"
              FROM "ResearchResourcePermit" WHERE "permitKey" = ${input.permitKey} AND "status" = 'ACTIVE'
              FOR UPDATE
          `)
        : [];
      if (existing[0]) {
        const permit = existing[0];
        if (
          permit.taskId !== task.id ||
          permit.resourcePoolId !== pool.id ||
          permit.holderId !== input.holderId ||
          permit.fencingToken !== input.fencingToken
        ) {
          throw new LeaseLostError("资源许可已被其他 fencing 持有");
        }
        return permitFromRow(permit);
      }
      if (Number(active[0]?.count ?? 0n) >= pool.currentConcurrency) {
        throw new ResourcePermitUnavailableError(
          "资源池许可已达到全局并发上限",
        );
      }
      const permitRows = await tx.$queryRaw<PermitRow[]>(Prisma.sql`
        INSERT INTO "ResearchResourcePermit" (
          "id", "resourcePoolId", "taskId", "permitKey", "holderId", "fencingToken",
          "status", "acquiredAt", "leaseExpiresAt"
        ) VALUES (
          ${randomUUID()}, ${pool.id}, ${task.id},
          ${input.permitKey ?? `${task.id}:${pool.id}:${randomUUID()}`}, ${input.holderId}, ${input.fencingToken},
          'ACTIVE', ${now}, ${new Date(now.getTime() + (input.leaseMs ?? this.permitLeaseMs))}
        )
        RETURNING "id", "resourcePoolId", "taskId", "permitKey", "holderId", "fencingToken",
          "status", "acquiredAt", "leaseExpiresAt", "releasedAt", "releaseReason"
      `);
      if (!permitRows[0])
        throw new ResourcePermitUnavailableError("资源许可写入失败");
      return permitFromRow(permitRows[0]);
    });
  }

  async releasePermit(
    permitId: string,
    holderId: string,
    fencingToken: bigint,
    reason = "released",
  ): Promise<void> {
    const result = await this.db.$executeRaw(Prisma.sql`
      UPDATE "ResearchResourcePermit"
         SET "status" = 'RELEASED', "releasedAt" = ${this.now()}, "releaseReason" = ${reason}
       WHERE "id" = ${permitId} AND "status" = 'ACTIVE' AND "holderId" = ${holderId}
         AND "fencingToken" = ${fencingToken}
    `);
    if (result === 0)
      throw new LeaseLostError("旧 fencing token 不能释放资源许可");
  }

  async settle(
    taskId: string,
    fencingToken: bigint,
    settlement: TaskSettlement,
  ): Promise<ResearchTask> {
    const now = this.now();
    return this.db.$transaction(async (tx) => {
      const rows = await queryTask(tx, taskId, true);
      const task = rows[0];
      if (
        !task ||
        task.status !== "RUNNING" ||
        task.fencingToken !== fencingToken ||
        !task.leaseExpiresAt ||
        task.leaseExpiresAt <= now
      ) {
        throw new LeaseLostError("旧 fencing token 不能结算任务");
      }
      let status: ResearchTask["status"];
      let nextAttemptAt: Date | null = null;
      let errorClass: string | null = null;
      let retryability: ResearchTask["retryability"] = null;
      let terminalReason: string | null = null;
      let resultJson: unknown | null = null;
      let resultContractVersion: string | null = null;
      let resultHashValue: string | null = null;
      if (settlement.disposition === "COMPLETED") {
        status = "SUCCEEDED";
        resultJson = settlement.result;
        resultContractVersion = settlement.resultContractVersion;
        resultHashValue = resultHash(settlement.result);
      } else if (settlement.disposition === "RETRY") {
        errorClass = settlement.errorClass;
        const retryable = settlement.retryable ?? true;
        const withinBudget =
          task.attempts < task.maxAttempts && task.retryDeadline > now;
        if (!retryable || !withinBudget) {
          status = "FAILED";
          retryability = retryable ? "RETRYABLE" : "NON_RETRYABLE";
          terminalReason = retryable
            ? "RETRY_BUDGET_EXHAUSTED"
            : "NON_RETRYABLE_FAILURE";
        } else {
          status = "RETRY_WAIT";
          const delay = Math.max(
            retryDelayMs(task.attempts, this.retryDelaysMs),
            settlement.retryAfterMs ?? 0,
          );
          nextAttemptAt = new Date(
            Math.min(now.getTime() + delay, task.retryDeadline.getTime()),
          );
          retryability = "RETRYABLE";
        }
      } else {
        status = settlement.disposition;
        errorClass = settlement.errorClass;
        retryability = "NON_RETRYABLE";
        terminalReason = settlement.terminalReason;
      }
      const updated = await tx.$queryRaw<TaskRow[]>(Prisma.sql`
        UPDATE "ResearchTask"
           SET "status" = ${status}, "nextAttemptAt" = ${nextAttemptAt}, "workerId" = NULL,
               "leaseExpiresAt" = NULL, "heartbeatAt" = NULL, "resultContractVersion" = ${resultContractVersion},
               "resultHash" = ${resultHashValue}, "resultJson" = ${resultJson === null ? null : JSON.stringify(resultJson)}::jsonb,
               "errorClass" = ${errorClass}, "retryability" = ${retryability}, "terminalReason" = ${terminalReason},
               "updatedAt" = ${now}
         WHERE "id" = ${taskId} AND "fencingToken" = ${fencingToken} AND "status" = 'RUNNING'
           AND "leaseExpiresAt" > ${now}
        RETURNING "id", "taskType", "idempotencyKey", "inputHash", "inputContractVersion",
          "inputJson", "schedulingTier", "resourcePoolId", "fairnessKey", "userId", "parentTaskId",
          "targetCompletionAt", "status", "attempts", "maxAttempts", "retryDeadline", "nextAttemptAt",
          "workerId", "fencingToken", "leaseExpiresAt", "heartbeatAt", "resultContractVersion",
          "resultHash", "resultJson", "errorClass", "retryability", "terminalReason",
          "oldestBacklogAgeMs", "createdAt", "updatedAt"
      `);
      if (!updated[0]) throw new LeaseLostError("提交终态时 lease 已失效");
      await tx.$executeRaw(Prisma.sql`
        UPDATE "ResearchResourcePermit"
           SET "status" = 'RELEASED', "releasedAt" = ${now}, "releaseReason" = ${status}
         WHERE "taskId" = ${taskId} AND "status" = 'ACTIVE'
      `);
      if (status === "SUCCEEDED") {
        await tx.$executeRaw(Prisma.sql`
          UPDATE "ResearchCircuitBreaker"
             SET "state" = CASE WHEN "state" = 'HALF_OPEN' THEN 'CLOSED' ELSE "state" END,
                 "halfOpenProbeTaskId" = NULL, "consecutiveFailures" = 0,
                 "windowAttempts" = 0, "windowFailures" = 0, "retryAfter" = NULL,
                 "version" = "version" + 1, "updatedAt" = ${now}
           WHERE "resourcePoolId" = ${task.resourcePoolId}
        `);
      }
      return taskFromRow(updated[0]);
    });
  }

  async getBacklog(poolId: string): Promise<BacklogSnapshot> {
    return this.db.$transaction((tx) =>
      this.backlogInTransactionById(tx, poolId, this.now()),
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
    return this.db.$transaction(async (tx) => {
      const circuits = await this.ensureCircuit(tx, poolId, now);
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
               "retryAfter" = CASE WHEN ${shouldOpen} THEN ${new Date(now.getTime() + delay)} ELSE NULL END,
               "halfOpenProbeTaskId" = NULL,
               "version" = "version" + 1, "updatedAt" = ${now}
         WHERE "resourcePoolId" = ${poolId}
        RETURNING "resourcePoolId", "state", "version", "consecutiveFailures", "windowAttempts",
          "windowFailures", "openCount", "retryAfter", "halfOpenProbeTaskId", "blockedReason", "updatedAt"
      `);
      if (!rows[0]) throw new SchedulingInvariantError("资源池熔断器更新失败");
      return circuitFromRow(rows[0]);
    });
  }

  async blockConfiguration(
    poolId: string,
    reason: string,
  ): Promise<CircuitBreaker> {
    const rows = await this.db.$queryRaw<CircuitRow[]>(Prisma.sql`
      UPDATE "ResearchCircuitBreaker" SET "state" = 'CONFIG_BLOCKED', "blockedReason" = ${reason},
             "retryAfter" = NULL, "halfOpenProbeTaskId" = NULL, "version" = "version" + 1,
             "updatedAt" = ${this.now()}
       WHERE "resourcePoolId" = ${poolId}
      RETURNING "resourcePoolId", "state", "version", "consecutiveFailures", "windowAttempts",
        "windowFailures", "openCount", "retryAfter", "halfOpenProbeTaskId", "blockedReason", "updatedAt"
    `);
    if (!rows[0]) throw new SchedulingInvariantError("资源池熔断器不存在");
    return circuitFromRow(rows[0]);
  }

  async allowConfiguration(poolId: string): Promise<CircuitBreaker> {
    const now = this.now();
    const rows = await this.db.$queryRaw<CircuitRow[]>(Prisma.sql`
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
  }

  async recordAdaptiveOutcome(
    poolId: string,
    outcome: ResourceOutcome,
  ): Promise<{
    previous: number;
    current: number;
    changed: boolean;
    reason: string;
    cooldownUntil: Date | null;
  }> {
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

  private async ensureCircuit(
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

  private async oldestBacklogAge(
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

  private async backlogInTransactionById(
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
    return this.backlogInTransaction(tx, pool, now);
  }

  private async backlogInTransaction(
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
}

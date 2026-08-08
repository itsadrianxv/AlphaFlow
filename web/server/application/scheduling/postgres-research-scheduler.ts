import { createHash, randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import {
  DEFAULT_RETRY_DELAYS_MS,
  defaultMaxAttempts,
  defaultRetryDeadline,
  retryDelayMs,
  urgencyBucket,
  weightedTierOrder,
} from "~/server/domain/scheduling/policies";
import {
  type AdmissionResult,
  type ClaimedTask,
  type EnqueueTaskInput,
  LeaseLostError,
  type ResearchTask,
  type ResourcePermit,
  ResourcePermitUnavailableError,
  SchedulingInvariantError,
  type TaskSettlement,
} from "~/server/domain/scheduling/types";
import {
  backlogInTransaction,
  ensureCircuit,
  oldestBacklogAge,
  type PermitRow,
  type PoolRow,
  permitFromRow,
  queryTask,
  type TaskRow,
  taskFromRow,
} from "./postgres-scheduling-storage";

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

function resultHash(result: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(result) ?? "null", "utf8")
    .digest("hex")}`;
}

/**
 * 任务生命周期 module。每个变更操作使用单个事务，并以 PostgreSQL
 * 作为任务和资源许可事实的权威来源。
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
               "parentTaskId", "externalCopyId", "targetCompletionAt", "status", "attempts", "maxAttempts",
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
          oldestBacklogAgeMs: await oldestBacklogAge(
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
      const circuits = await ensureCircuit(tx, pool.id, now);
      const circuit = circuits[0];
      if (!circuit) throw new SchedulingInvariantError("资源池熔断器不存在");
      const backlog = await backlogInTransaction(tx, pool, now);
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
          "schedulingTier", "resourcePoolId", "fairnessKey", "userId", "parentTaskId", "externalCopyId",
          "targetCompletionAt", "status", "maxAttempts", "retryDeadline", "oldestBacklogAgeMs"
        ) VALUES (
          ${id}, ${input.taskType}, ${input.idempotencyKey}, ${input.inputHash}, ${input.inputContractVersion},
          ${JSON.stringify(input.input)}::jsonb, ${input.schedulingTier}, ${input.resourcePoolId},
          ${input.fairnessKey}, ${input.userId ?? null}, ${input.parentTaskId ?? null}, ${input.externalCopyId ?? null},
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
        WITH expired_tasks AS (
          UPDATE "ResearchTask"
             SET "status" = CASE WHEN "attempts" < "maxAttempts" AND "retryDeadline" > ${now}
                                 THEN 'RETRY_WAIT' ELSE 'FAILED' END,
                 "nextAttemptAt" = CASE WHEN "attempts" < "maxAttempts" AND "retryDeadline" > ${now}
                                        THEN ${now} ELSE NULL END,
                 "workerId" = NULL, "leaseExpiresAt" = NULL, "heartbeatAt" = NULL,
                 "errorClass" = 'LEASE_EXPIRED',
                 "retryability" = CASE WHEN "attempts" < "maxAttempts" AND "retryDeadline" > ${now}
                                       THEN 'RETRYABLE' ELSE 'NON_RETRYABLE' END,
                 "terminalReason" = CASE WHEN "attempts" < "maxAttempts" AND "retryDeadline" > ${now}
                                         THEN NULL ELSE 'RETRY_BUDGET_EXHAUSTED' END,
                 "updatedAt" = ${now}
           WHERE "resourcePoolId" = ${poolId} AND "status" = 'RUNNING' AND "leaseExpiresAt" <= ${now}
          RETURNING "id"
        )
        UPDATE "ResearchResourcePermit"
           SET "status" = 'EXPIRED', "releasedAt" = ${now}, "releaseReason" = 'task_lease_expired'
         WHERE "taskId" IN (SELECT "id" FROM expired_tasks) AND "status" = 'ACTIVE'
      `);
      const circuits = await ensureCircuit(tx, poolId, now);
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
      if (circuit.state === "HALF_OPEN" && circuit.halfOpenProbeTaskId) {
        const probeRows = await tx.$queryRaw<
          Array<{ status: ResearchTask["status"]; leaseExpiresAt: Date | null }>
        >(Prisma.sql`
          SELECT "status", "leaseExpiresAt"
            FROM "ResearchTask" WHERE "id" = ${circuit.halfOpenProbeTaskId}
        `);
        const probe = probeRows[0];
        if (
          !probe ||
          probe.status !== "RUNNING" ||
          !probe.leaseExpiresAt ||
          probe.leaseExpiresAt <= now
        ) {
          await tx.$executeRaw(Prisma.sql`
            UPDATE "ResearchCircuitBreaker"
               SET "halfOpenProbeTaskId" = NULL, "updatedAt" = ${now}
             WHERE "resourcePoolId" = ${poolId} AND "state" = 'HALF_OPEN'
               AND "halfOpenProbeTaskId" = ${circuit.halfOpenProbeTaskId}
          `);
          circuit.halfOpenProbeTaskId = null;
        }
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
      const eligible = rows.filter((row) => {
        if (!row.userId) return true;
        return (
          (activeUserCounts.get(row.userId) ?? 0) <
          this.maxUserConcurrencyPerPool
        );
      });
      const availableTiers = new Set(eligible.map((row) => row.schedulingTier));
      const tier = weightedTierOrder(
        availableTiers,
        BigInt(pool.controlVersion),
      )[0];
      if (!tier) return null;
      const candidates = eligible.filter((row) => row.schedulingTier === tier);
      const urgency = Math.min(
        ...candidates.map((row) => urgencyBucket(row.targetCompletionAt, now)),
      );
      const urgentCandidates = candidates.filter(
        (row) => urgencyBucket(row.targetCompletionAt, now) === urgency,
      );
      const fairnessKeys = [
        ...new Set(urgentCandidates.map((row) => row.fairnessKey)),
      ].sort();
      const fairnessStart = Number(
        BigInt(pool.controlVersion) % BigInt(Math.max(1, fairnessKeys.length)),
      );
      const orderedFairnessKeys = fairnessKeys
        .slice(fairnessStart)
        .concat(fairnessKeys.slice(0, fairnessStart));
      const candidate = orderedFairnessKeys.flatMap((fairnessKey) =>
        urgentCandidates
          .filter((row) => row.fairnessKey === fairnessKey)
          .sort(
            (left, right) =>
              Number(left.attempts > 0) - Number(right.attempts > 0) ||
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
      const circuits = await ensureCircuit(tx, pool.id, now);
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
             SET "state" = 'CLOSED', "halfOpenProbeTaskId" = NULL,
                 "consecutiveFailures" = 0,
                 "windowAttempts" = 0, "windowFailures" = 0, "retryAfter" = NULL,
                 "version" = "version" + 1, "updatedAt" = ${now}
           WHERE "resourcePoolId" = ${task.resourcePoolId} AND "state" = 'HALF_OPEN'
        `);
      }
      return taskFromRow(updated[0]);
    });
  }

  async cancel(
    taskId: string,
    fencingToken: bigint,
    reason = "cancelled",
  ): Promise<ResearchTask> {
    return this.settle(taskId, fencingToken, {
      disposition: "CANCELLED",
      errorClass: "TASK_CANCELLED",
      terminalReason: reason,
    });
  }
}

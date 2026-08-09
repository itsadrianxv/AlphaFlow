import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  FeishuCopy,
  FeishuCopyStatus,
} from "~/server/application/research-distribution/research-distribution-service";
import { FEISHU_DELIVERY_MAX_ATTEMPTS } from "~/server/domain/scheduling/policies";
import {
  type CircuitBreaker,
  LeaseLostError,
  type ResearchTask,
  type ResourceOutcome,
  type ResourcePermit,
} from "~/server/domain/scheduling/types";
import type { PostgresResearchScheduler } from "./postgres-research-scheduler";
import {
  circuitFromRow,
  ensureCircuit,
  type PermitRow,
  permitFromRow,
  queryTask,
  recordCircuitOutcomeInTransaction,
  type TaskRow,
  taskFromRow,
} from "./postgres-scheduling-storage";

type CopyRow = {
  id: string;
  entryId: string;
  idempotencyKey: string;
  payloadJson: unknown;
  status: string;
  attempts: number;
  firstAttemptAt: Date | null;
  retryDeadline: Date;
  nextAttemptAt: Date | null;
  sentAt: Date | null;
  lastErrorCode: string | null;
  failureClass: string | null;
  claimToken: string | null;
  claimExpiresAt: Date | null;
  fencingToken: bigint;
};

const copyColumns = Prisma.sql`
  "id", "entryId", "idempotencyKey", "payloadJson", "status", "attempts",
  "firstAttemptAt", "retryDeadline", "nextAttemptAt", "sentAt", "lastErrorCode",
  "failureClass", "claimToken", "claimExpiresAt", "fencingToken"
`;

export type FeishuAttemptOutcome =
  | { kind: "SUCCESS" }
  | {
      kind: "RATE_LIMITED" | "TIMEOUT" | "FAILURE";
      errorCode: string;
      retryAfterMs?: number;
    }
  | { kind: "TARGET_CONFIGURATION" | "PERMANENT_FAILURE"; errorCode: string };

export type SettledExternalCopyAttempt = {
  copy: FeishuCopy;
  task: ResearchTask;
  permit: ResourcePermit;
  circuit: CircuitBreaker;
};

export class PostgresExternalCopyAttemptRepository {
  constructor(
    private readonly db: PrismaClient,
    private readonly scheduler?: PostgresResearchScheduler,
    private readonly testHooks: {
      beforeCommit?: () => void;
    } = {},
  ) {}

  async claimNextExternalCopyAttempt(input: {
    poolId: string;
    workerId: string;
    claimedAt: Date;
    leaseMs: number;
  }) {
    const scheduler = this.scheduler;
    if (!scheduler) {
      throw new Error("原子领取外部副本尝试需要 PostgreSQL scheduler");
    }
    return this.db.$transaction(async (tx) => {
      const claimedTask = await scheduler.claimInTransaction(
        tx,
        input.poolId,
        input.workerId,
        input.claimedAt,
      );
      if (!claimedTask) return null;
      const copyId = claimedTask.task.externalCopyId;
      if (!copyId) throw new LeaseLostError("飞书投递任务缺少外部副本身份");
      const copy = await this.claimCopyInTransaction(tx, {
        taskId: claimedTask.task.id,
        taskFencingToken: claimedTask.task.fencingToken,
        copyId,
        claimedAt: input.claimedAt,
        leaseMs: input.leaseMs,
      });
      if (!copy) throw new LeaseLostError("飞书投递副本已不可领取");
      return { ...claimedTask, copy };
    });
  }

  async claimExternalCopyAttempt(input: {
    taskId: string;
    taskFencingToken: bigint;
    copyId: string;
    claimedAt: Date;
    leaseMs: number;
  }): Promise<FeishuCopy | null> {
    return this.db.$transaction((tx) => this.claimCopyInTransaction(tx, input));
  }

  private async claimCopyInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      taskId: string;
      taskFencingToken: bigint;
      copyId: string;
      claimedAt: Date;
      leaseMs: number;
    },
  ): Promise<FeishuCopy | null> {
    const task = (await queryTask(tx, input.taskId, true))[0];
    if (
      !task ||
      task.status !== "RUNNING" ||
      task.fencingToken !== input.taskFencingToken ||
      !task.leaseExpiresAt ||
      task.leaseExpiresAt <= input.claimedAt ||
      task.externalCopyId !== input.copyId
    ) {
      throw new LeaseLostError("飞书投递任务租约或副本身份已失效");
    }
    const permits = await tx.$queryRaw<PermitRow[]>(Prisma.sql`
        SELECT "id", "resourcePoolId", "taskId", "permitKey", "holderId", "fencingToken",
               "status", "acquiredAt", "leaseExpiresAt", "releasedAt", "releaseReason"
          FROM "ResearchResourcePermit"
         WHERE "taskId" = ${input.taskId} AND "status" = 'ACTIVE'
         FOR UPDATE
      `);
    const permit = permits[0];
    if (
      !permit ||
      permit.fencingToken !== input.taskFencingToken ||
      permit.holderId !== task.workerId ||
      permit.leaseExpiresAt <= input.claimedAt
    ) {
      throw new LeaseLostError("飞书投递任务主许可已失效");
    }
    const copies = await tx.$queryRaw<CopyRow[]>(Prisma.sql`
        SELECT ${copyColumns} FROM "ResearchExternalCopy"
         WHERE "id" = ${input.copyId} FOR UPDATE
      `);
    const copy = copies[0];
    if (!copy) throw new LeaseLostError("飞书投递副本不存在");
    if (copy.status === "SENT" || copy.status === "FAILED") return null;
    if (
      copy.retryDeadline <= input.claimedAt ||
      ((copy.status === "PENDING" || copy.status === "RETRY_WAIT") &&
        copy.nextAttemptAt &&
        copy.nextAttemptAt > input.claimedAt)
    )
      return null;
    if (
      copy.status === "SENDING" &&
      copy.claimExpiresAt &&
      copy.claimExpiresAt > input.claimedAt
    )
      return null;
    const rows = await tx.$queryRaw<CopyRow[]>(Prisma.sql`
        UPDATE "ResearchExternalCopy"
           SET "status" = 'SENDING', "attempts" = "attempts" + 1,
               "firstAttemptAt" = COALESCE("firstAttemptAt", ${input.claimedAt}),
               "nextAttemptAt" = NULL, "claimToken" = ${`${input.taskId}:${input.taskFencingToken.toString()}`},
               "claimExpiresAt" = ${new Date(input.claimedAt.getTime() + input.leaseMs)},
               "fencingToken" = "fencingToken" + 1, "updatedAt" = ${input.claimedAt}
         WHERE "id" = ${input.copyId} AND "status" IN ('PENDING', 'RETRY_WAIT', 'SENDING')
        RETURNING ${copyColumns}
      `);
    return rows[0] ? mapCopy(rows[0]) : null;
  }

  async settleExternalCopyAttempt(input: {
    taskId: string;
    taskFencingToken: bigint;
    copyId: string;
    copyFencingToken: bigint;
    outcome: FeishuAttemptOutcome;
    completedAt: Date;
  }): Promise<SettledExternalCopyAttempt> {
    return this.db.$transaction(async (tx) => {
      const taskRows = await queryTask(tx, input.taskId, true);
      const task = taskRows[0];
      if (
        !task ||
        task.status !== "RUNNING" ||
        task.fencingToken !== input.taskFencingToken ||
        !task.leaseExpiresAt ||
        task.leaseExpiresAt <= input.completedAt ||
        task.externalCopyId !== input.copyId
      )
        throw new LeaseLostError("飞书投递任务 fencing 或租约已失效");

      const copies = await tx.$queryRaw<CopyRow[]>(Prisma.sql`
        SELECT ${copyColumns} FROM "ResearchExternalCopy" WHERE "id" = ${input.copyId} FOR UPDATE
      `);
      const copy = copies[0];
      if (
        !copy ||
        copy.status !== "SENDING" ||
        copy.fencingToken !== input.copyFencingToken ||
        !copy.claimExpiresAt ||
        copy.claimExpiresAt <= input.completedAt
      )
        throw new LeaseLostError("飞书投递副本 fencing 或租约已失效");

      const permits = await tx.$queryRaw<PermitRow[]>(Prisma.sql`
        SELECT "id", "resourcePoolId", "taskId", "permitKey", "holderId", "fencingToken",
               "status", "acquiredAt", "leaseExpiresAt", "releasedAt", "releaseReason"
          FROM "ResearchResourcePermit" WHERE "taskId" = ${input.taskId} AND "status" = 'ACTIVE' FOR UPDATE
      `);
      const permit = permits[0];
      if (
        !permit ||
        permit.resourcePoolId !== task.resourcePoolId ||
        permit.fencingToken !== input.taskFencingToken ||
        permit.holderId !== task.workerId ||
        permit.leaseExpiresAt <= input.completedAt
      )
        throw new LeaseLostError("飞书投递任务主许可 fencing 或租约已失效");

      const circuitRows = await ensureCircuit(
        tx,
        task.resourcePoolId,
        input.completedAt,
      );
      if (!circuitRows[0]) throw new LeaseLostError("飞书资源池熔断器不存在");
      const next = nextCopyState(copy, input.outcome, input.completedAt);
      const copyRows = await tx.$queryRaw<CopyRow[]>(Prisma.sql`
        UPDATE "ResearchExternalCopy"
           SET "status" = ${next.status}, "nextAttemptAt" = ${next.nextAttemptAt},
               "sentAt" = ${next.sentAt}, "lastErrorCode" = ${next.lastErrorCode},
               "failureClass" = ${next.failureClass}, "claimToken" = NULL, "claimExpiresAt" = NULL,
               "updatedAt" = ${input.completedAt}
         WHERE "id" = ${input.copyId} AND "status" = 'SENDING' AND "fencingToken" = ${input.copyFencingToken}
        RETURNING ${copyColumns}
      `);
      if (!copyRows[0])
        throw new LeaseLostError("飞书投递副本提交时 fencing 已失效");
      const result = {
        copyId: input.copyId,
        attemptNo: copy.attempts,
        status: next.status,
        ...(next.failureClass ? { failureClass: next.failureClass } : {}),
        ...(next.lastErrorCode ? { errorCode: next.lastErrorCode } : {}),
      };
      const taskRowsUpdated = await tx.$queryRaw<TaskRow[]>(Prisma.sql`
        UPDATE "ResearchTask"
           SET "status" = ${next.status === "SENT" ? "SUCCEEDED" : "FAILED"}, "nextAttemptAt" = NULL,
               "workerId" = NULL, "leaseExpiresAt" = NULL, "heartbeatAt" = NULL,
               "resultContractVersion" = 'feishu-delivery-result.v1',
               "resultHash" = ${hashResult(result)}, "resultJson" = ${JSON.stringify(result)}::jsonb,
               "errorClass" = ${next.lastErrorCode}, "retryability" = ${next.status === "RETRY_WAIT" ? "NON_RETRYABLE" : next.failureClass ? "NON_RETRYABLE" : null},
               "terminalReason" = ${next.status === "SENT" ? null : next.status === "RETRY_WAIT" ? "EXTERNAL_COPY_RETRY_SCHEDULED" : "EXTERNAL_COPY_FAILED"},
               "updatedAt" = ${input.completedAt}
         WHERE "id" = ${input.taskId} AND "status" = 'RUNNING' AND "fencingToken" = ${input.taskFencingToken}
        RETURNING "id", "taskType", "idempotencyKey", "inputHash", "inputContractVersion", "inputJson",
          "schedulingTier", "resourcePoolId", "fairnessKey", "userId", "parentTaskId", "externalCopyId",
          "targetCompletionAt", "status", "attempts", "maxAttempts", "retryDeadline", "nextAttemptAt", "workerId",
          "fencingToken", "leaseExpiresAt", "heartbeatAt", "resultContractVersion", "resultHash", "resultJson",
          "errorClass", "retryability", "terminalReason", "oldestBacklogAgeMs", "createdAt", "updatedAt"
      `);
      if (!taskRowsUpdated[0])
        throw new LeaseLostError("飞书投递任务提交时 fencing 已失效");
      const released = await tx.$queryRaw<PermitRow[]>(Prisma.sql`
        UPDATE "ResearchResourcePermit" SET "status" = 'RELEASED', "releasedAt" = ${input.completedAt}, "releaseReason" = ${next.status === "SENT" ? "SUCCEEDED" : "FAILED"}
         WHERE "id" = ${permit.id} AND "status" = 'ACTIVE' AND "fencingToken" = ${input.taskFencingToken}
        RETURNING "id", "resourcePoolId", "taskId", "permitKey", "holderId", "fencingToken", "status", "acquiredAt", "leaseExpiresAt", "releasedAt", "releaseReason"
      `);
      if (!released[0])
        throw new LeaseLostError("飞书投递主许可提交时 fencing 已失效");
      let circuit = circuitFromRow(circuitRows[0]);
      if (next.circuitOutcome)
        circuit = await recordCircuitOutcomeInTransaction(
          tx,
          task.resourcePoolId,
          next.circuitOutcome,
          input.completedAt,
        );
      this.testHooks.beforeCommit?.();
      return {
        copy: mapCopy(copyRows[0]),
        task: taskFromRow(taskRowsUpdated[0]),
        permit: permitFromRow(released[0]),
        circuit,
      };
    });
  }
}

function nextCopyState(
  copy: CopyRow,
  outcome: FeishuAttemptOutcome,
  completedAt: Date,
) {
  if (outcome.kind === "SUCCESS")
    return {
      status: "SENT" as const,
      nextAttemptAt: null,
      sentAt: completedAt,
      lastErrorCode: null,
      failureClass: null,
      circuitOutcome: { kind: "SUCCESS" as const } satisfies ResourceOutcome,
    };
  const retryable =
    outcome.kind === "RATE_LIMITED" ||
    outcome.kind === "TIMEOUT" ||
    outcome.kind === "FAILURE";
  const nextAttemptAt = retryable
    ? new Date(completedAt.getTime() + (outcome.retryAfterMs ?? 0))
    : null;
  const canRetry =
    retryable &&
    nextAttemptAt !== null &&
    copy.attempts < FEISHU_DELIVERY_MAX_ATTEMPTS &&
    copy.retryDeadline > completedAt &&
    nextAttemptAt <= copy.retryDeadline;
  const failureClass = canRetry
    ? outcome.kind === "RATE_LIMITED"
      ? "RATE_LIMITED"
      : outcome.kind === "TIMEOUT"
        ? "TIMEOUT"
        : "UPSTREAM_FAILURE"
    : retryable
      ? "RETRY_EXHAUSTED"
      : outcome.kind;
  return {
    status: (canRetry ? "RETRY_WAIT" : "FAILED") as "RETRY_WAIT" | "FAILED",
    nextAttemptAt: canRetry ? nextAttemptAt : null,
    sentAt: null,
    lastErrorCode: outcome.errorCode,
    failureClass,
    circuitOutcome: retryable
      ? ({
          kind: outcome.kind === "FAILURE" ? "FAILURE" : outcome.kind,
          retryAfterMs: outcome.retryAfterMs,
        } as ResourceOutcome)
      : null,
  };
}

function mapCopy(row: CopyRow): FeishuCopy {
  return {
    id: row.id,
    entryId: row.entryId,
    idempotencyKey: row.idempotencyKey,
    payload: row.payloadJson as FeishuCopy["payload"],
    status: row.status as FeishuCopyStatus,
    attempts: row.attempts,
    firstAttemptAt: row.firstAttemptAt?.toISOString() ?? null,
    retryDeadline: row.retryDeadline.toISOString(),
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    sentAt: row.sentAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    failureClass: row.failureClass,
    claimToken: row.claimToken,
    claimExpiresAt: row.claimExpiresAt?.toISOString() ?? null,
    fencingToken: row.fencingToken.toString(),
  };
}

function hashResult(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

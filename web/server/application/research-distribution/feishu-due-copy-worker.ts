import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  type FeishuCopy,
  FeishuDeliveryError,
  type FeishuDeliveryPort,
} from "~/server/application/research-distribution/research-distribution-service";
import { ProductionRuntimeObserver } from "~/server/application/runtime-observability/production-runtime-observer";
import { PostgresExternalCopyAttemptRepository } from "~/server/application/scheduling/postgres-external-copy-attempt-repository";
import type { PostgresResearchScheduler } from "~/server/application/scheduling/postgres-research-scheduler";
import { FEISHU_DELIVERY_MAX_ATTEMPTS } from "~/server/domain/scheduling/policies";
import { LeaseLostError } from "~/server/domain/scheduling/types";

export const FEISHU_DELIVERY_TASK_TYPE = "research.feishu-delivery.v1";
export const FEISHU_POOL_KEY = "feishu:research-delivery";

const taskInputSchema = z.object({
  contractVersion: z.literal("feishu-delivery-task.v1"),
  copyId: z.string().min(1),
  attemptNo: z.number().int().positive(),
});

function hashJson(value: unknown) {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

export class FeishuDueCopyScheduler {
  constructor(
    private readonly db: PrismaClient,
    private readonly scheduler: PostgresResearchScheduler,
  ) {}

  async scheduleDueCopies(input: {
    poolId: string;
    limit?: number;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const copies = await this.db.researchExternalCopy.findMany({
      where: {
        channel: "FEISHU",
        retryDeadline: { gt: now },
        attempts: { lt: FEISHU_DELIVERY_MAX_ATTEMPTS },
        OR: [
          {
            status: {
              in: ["PENDING", "RETRY_WAIT"],
            },
            nextAttemptAt: null,
          },
          {
            status: {
              in: ["PENDING", "RETRY_WAIT"],
            },
            nextAttemptAt: { lte: now },
          },
          { status: "SENDING", claimExpiresAt: { lte: now } },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: input.limit ?? 50,
    });
    let accepted = 0;
    let deduplicated = 0;
    let rejected = 0;
    for (const copy of copies) {
      const taskInput = {
        contractVersion: "feishu-delivery-task.v1" as const,
        copyId: copy.id,
        attemptNo: copy.attempts + 1,
      };
      const result = await this.scheduler.enqueue({
        taskType: FEISHU_DELIVERY_TASK_TYPE,
        idempotencyKey: `feishu-copy:${copy.id}:attempt:${String(taskInput.attemptNo)}`,
        inputHash: hashJson(taskInput),
        inputContractVersion: taskInput.contractVersion,
        input: taskInput,
        schedulingTier: "TIME_CRITICAL",
        resourcePoolId: input.poolId,
        fairnessKey: copy.entryId,
        externalCopyId: copy.id,
        maxAttempts: 1,
      });
      if (result.decision === "ACCEPTED") accepted += 1;
      else if (result.decision === "DEDUPLICATED") deduplicated += 1;
      else rejected += 1;
    }
    return { accepted, deduplicated, rejected };
  }
}

export class FeishuDueCopyWorker {
  constructor(
    private readonly db: PrismaClient,
    private readonly scheduler: PostgresResearchScheduler,
    private readonly dependencies: {
      feishu?: FeishuDeliveryPort;
      clock?: () => Date;
      deliveryLeaseMs?: number;
      observer?: Pick<ProductionRuntimeObserver, "record">;
    } = {},
  ) {}

  async runOnce(poolId: string, workerId: string) {
    const clock = this.dependencies.clock ?? (() => new Date());
    const startedAt = clock();
    const repository = new PostgresExternalCopyAttemptRepository(
      this.db,
      this.scheduler,
    );
    const claimed = await repository.claimNextExternalCopyAttempt({
      poolId,
      workerId,
      claimedAt: startedAt,
      leaseMs: this.dependencies.deliveryLeaseMs ?? 60_000,
    });
    if (!claimed) return null;
    const observer =
      this.dependencies.observer ?? new ProductionRuntimeObserver(this.db);
    let input: z.infer<typeof taskInputSchema> | null = null;
    const claimedCopy: FeishuCopy | null = claimed.copy;
    let httpSucceeded = false;
    try {
      if (claimed.task.taskType !== FEISHU_DELIVERY_TASK_TYPE) {
        throw new Error(
          `Feishu Worker 不能执行任务类型 ${claimed.task.taskType}`,
        );
      }
      input = taskInputSchema.parse(claimed.task.input);
      if (!this.dependencies.feishu)
        throw new FeishuDeliveryError("FEISHU_PORT_NOT_CONFIGURED", false);
      await this.dependencies.feishu.send(claimedCopy.payload);
      httpSucceeded = true;
      const settled = await repository.settleExternalCopyAttempt({
        taskId: claimed.task.id,
        taskFencingToken: claimed.task.fencingToken,
        copyId: claimedCopy.id,
        copyFencingToken: BigInt(claimedCopy.fencingToken),
        outcome: { kind: "SUCCESS" },
        completedAt: clock(),
      });
      const finalCopy = settled.copy;
      await recordObservationSafely(observer, {
        idempotencyKey: `feishu-worker:${claimed.task.id}:${claimed.task.fencingToken.toString()}:SENT`,
        metricKind: "DELIVERY",
        stage: "external-delivery",
        resourcePool: FEISHU_POOL_KEY,
        startedAt,
        readyAt: clock(),
        success: true,
        degraded: false,
        errorClass: null,
        delivery: {
          channel: "FEISHU",
          status: deliveryStatus(finalCopy.status),
          attempt: finalCopy.attempts,
          latencyMs: Math.max(0, clock().getTime() - startedAt.getTime()),
        },
        context: {
          taskId: claimed.task.id,
          taskType: claimed.task.taskType,
          inputContractVersion: claimed.task.inputContractVersion,
          inputHash: claimed.task.inputHash,
          resultContractVersion: "feishu-delivery-result.v1",
          authoritativeObjectIds: [finalCopy.id, finalCopy.entryId],
          retryAttempt: claimed.task.attempts,
          fencingToken: claimed.task.fencingToken.toString(),
          ...(finalCopy.status !== "SENT"
            ? { degradedReason: finalCopy.status }
            : {}),
        },
      });
      return { copy: finalCopy, taskId: claimed.task.id };
    } catch (error) {
      if (error instanceof LeaseLostError || httpSucceeded) throw error;
      if (!input) {
        await repository.settleExternalCopyAttempt({
          taskId: claimed.task.id,
          taskFencingToken: claimed.task.fencingToken,
          copyId: claimed.copy.id,
          copyFencingToken: BigInt(claimed.copy.fencingToken),
          outcome: {
            kind: "PERMANENT_FAILURE",
            errorCode: "FEISHU_DELIVERY_TASK_INPUT_INVALID",
          },
          completedAt: clock(),
        });
        throw error;
      }
      if (!claimedCopy) {
        throw new LeaseLostError("飞书投递副本已失去 claim");
      }
      if (claimedCopy.status === "SENDING" && claimedCopy.claimToken) {
        const deliveryError =
          error instanceof FeishuDeliveryError
            ? error
            : new FeishuDeliveryError("FEISHU_UNKNOWN_ERROR", true);
        const now = clock();
        await repository.settleExternalCopyAttempt({
          taskId: claimed.task.id,
          taskFencingToken: claimed.task.fencingToken,
          copyId: claimedCopy.id,
          copyFencingToken: BigInt(claimedCopy.fencingToken),
          outcome: deliveryOutcome(deliveryError),
          completedAt: now,
        });
      }
      await recordObservationSafely(observer, {
        idempotencyKey: `feishu-worker:${claimed.task.id}:${claimed.task.fencingToken.toString()}:failure`,
        metricKind: "DELIVERY",
        stage: "external-delivery",
        resourcePool: FEISHU_POOL_KEY,
        startedAt,
        readyAt: clock(),
        success: false,
        errorClass: "FEISHU_DELIVERY_WORKER_FAILED",
        delivery: {
          channel: "FEISHU",
          status: "FAILED",
          attempt: claimed.task.attempts,
          latencyMs: Math.max(0, clock().getTime() - startedAt.getTime()),
        },
        context: {
          taskId: claimed.task.id,
          taskType: claimed.task.taskType,
          inputContractVersion: claimed.task.inputContractVersion,
          inputHash: claimed.task.inputHash,
          retryAttempt: claimed.task.attempts,
          fencingToken: claimed.task.fencingToken.toString(),
        },
      });
      throw error;
    }
  }
}

function deliveryOutcome(error: FeishuDeliveryError) {
  if (!error.retryable) {
    const targetConfiguration =
      error.code.startsWith("FEISHU_HTTP_4") ||
      error.code.includes("TARGET_NOT_CONFIGURED") ||
      error.code.includes("WEBHOOK_NOT_CONFIGURED") ||
      error.code.includes("WEBHOOK_INVALID") ||
      error.code === "FEISHU_PORT_NOT_CONFIGURED";
    return {
      kind: targetConfiguration
        ? ("TARGET_CONFIGURATION" as const)
        : ("PERMANENT_FAILURE" as const),
      errorCode: error.code,
    };
  }
  return {
    kind:
      error.resourceOutcome ??
      (error.code.includes("429")
        ? ("RATE_LIMITED" as const)
        : error.code.includes("TIMEOUT") || error.code.includes("408")
          ? ("TIMEOUT" as const)
          : ("FAILURE" as const)),
    errorCode: error.code,
    retryAfterMs: error.retryAfterMs,
  };
}

async function recordObservationSafely(
  observer: Pick<ProductionRuntimeObserver, "record">,
  input: Parameters<ProductionRuntimeObserver["record"]>[0],
) {
  try {
    await observer.record(input);
  } catch {
    // 观测失败不能回滚已经完成的权威结算。
  }
}

function deliveryStatus(status: string) {
  if (status === "SENT") return "SENT" as const;
  if (status === "FAILED") return "FAILED" as const;
  if (status === "RETRY_WAIT") return "RETRY" as const;
  return "PENDING" as const;
}

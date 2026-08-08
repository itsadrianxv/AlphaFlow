import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  FeishuDeliveryError,
  type FeishuDeliveryPort,
} from "~/server/application/research-distribution/research-distribution-service";
import { ProductionRuntimeObserver } from "~/server/application/runtime-observability/production-runtime-observer";
import type { PostgresResearchScheduler } from "~/server/application/scheduling/postgres-research-scheduler";
import { PostgresSchedulingControl } from "~/server/application/scheduling/postgres-scheduling-control";
import { PrismaResearchDistributionStore } from "~/server/infrastructure/research-distribution/prisma-research-distribution-store";

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
    } = {},
  ) {}

  async runOnce(poolId: string, workerId: string) {
    const claimed = await this.scheduler.claim(poolId, workerId);
    if (!claimed) return null;
    const clock = this.dependencies.clock ?? (() => new Date());
    const startedAt = clock();
    const observer = new ProductionRuntimeObserver(this.db);
    let input: z.infer<typeof taskInputSchema> | null = null;
    try {
      if (claimed.task.taskType !== FEISHU_DELIVERY_TASK_TYPE) {
        throw new Error(
          `Feishu Worker 不能执行任务类型 ${claimed.task.taskType}`,
        );
      }
      input = taskInputSchema.parse(claimed.task.input);
      const store = new PrismaResearchDistributionStore(this.db);
      const copy = await store.claimCopy(
        input.copyId,
        startedAt,
        this.dependencies.deliveryLeaseMs ?? 60_000,
      );
      if (!copy) {
        await this.scheduler.settle(
          claimed.task.id,
          claimed.task.fencingToken,
          {
            disposition: "COMPLETED",
            resultContractVersion: "feishu-delivery-result.v1",
            result: {
              copyId: input.copyId,
              status: "SKIPPED",
              attemptNo: input.attemptNo,
            },
          },
        );
        return {
          copy: await store.getCopy(input.copyId),
          taskId: claimed.task.id,
        };
      }
      if (!this.dependencies.feishu)
        throw new FeishuDeliveryError("FEISHU_PORT_NOT_CONFIGURED", false);
      await this.dependencies.feishu.send(copy.payload);
      const settledCopy = await store.settleCopy({
        ...copy,
        status: "SENT",
        sentAt: clock().toISOString(),
        lastErrorCode: null,
        failureClass: null,
      });
      await new PostgresSchedulingControl(this.db, {
        now: clock,
      }).recordOutcome(poolId, { kind: "SUCCESS", at: clock() });
      const finalCopy = settledCopy;
      await observer.record({
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
      await this.scheduler.settle(claimed.task.id, claimed.task.fencingToken, {
        disposition: "COMPLETED",
        resultContractVersion: "feishu-delivery-result.v1",
        result: {
          copyId: finalCopy.id,
          status: finalCopy.status,
          attemptNo: input.attemptNo,
        },
      });
      return { copy: finalCopy, taskId: claimed.task.id };
    } catch (error) {
      const store = new PrismaResearchDistributionStore(this.db);
      if (!input) {
        await this.scheduler.settle(
          claimed.task.id,
          claimed.task.fencingToken,
          {
            disposition: "RETRY",
            errorClass: "FEISHU_DELIVERY_TASK_INPUT_INVALID",
            retryable: true,
          },
        );
        throw error;
      }
      const current = await store.getCopy(input.copyId);
      if (!current) {
        await this.scheduler.settle(
          claimed.task.id,
          claimed.task.fencingToken,
          {
            disposition: "RETRY",
            errorClass: "FEISHU_DELIVERY_COPY_UNAVAILABLE",
            retryable: true,
          },
        );
        throw error;
      }
      if (current?.status === "SENDING" && current.claimToken) {
        const deliveryError =
          error instanceof FeishuDeliveryError
            ? error
            : new FeishuDeliveryError("FEISHU_UNKNOWN_ERROR", true);
        const now = clock();
        const exhausted =
          !deliveryError.retryable ||
          current.attempts >= 5 ||
          new Date(current.retryDeadline) <= now;
        await store.settleCopy({
          ...current,
          status: exhausted ? "FAILED" : "RETRY_WAIT",
          nextAttemptAt: exhausted
            ? null
            : new Date(
                now.getTime() + (deliveryError.retryAfterMs ?? 60_000),
              ).toISOString(),
          lastErrorCode: deliveryError.code,
          failureClass: deliveryError.retryable
            ? exhausted
              ? "RETRY_EXHAUSTED"
              : deliveryError.code.includes("429")
                ? "RATE_LIMITED"
                : deliveryError.code.includes("TIMEOUT") ||
                    deliveryError.code.includes("408")
                  ? "TIMEOUT"
                  : "UPSTREAM_FAILURE"
            : deliveryError.code.startsWith("FEISHU_HTTP_4")
              ? "TARGET_CONFIGURATION"
              : "PERMANENT_FAILURE",
        });
        if (deliveryError.retryable)
          await new PostgresSchedulingControl(this.db, {
            now: clock,
          }).recordOutcome(poolId, {
            kind: deliveryError.code.includes("429")
              ? "RATE_LIMITED"
              : deliveryError.code.includes("TIMEOUT") ||
                  deliveryError.code.includes("408")
                ? "TIMEOUT"
                : "FAILURE",
            retryAfterMs: deliveryError.retryAfterMs,
            at: now,
          });
      }
      await observer.record({
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
      await this.scheduler.settle(claimed.task.id, claimed.task.fencingToken, {
        disposition: "COMPLETED",
        resultContractVersion: "feishu-delivery-result.v1",
        result: {
          copyId: input.copyId,
          status: "FAILED",
          attemptNo: input.attemptNo,
        },
      });
      throw error;
    }
  }
}

function deliveryStatus(status: string) {
  if (status === "SENT") return "SENT" as const;
  if (status === "FAILED") return "FAILED" as const;
  if (status === "RETRY_WAIT") return "RETRY" as const;
  return "PENDING" as const;
}

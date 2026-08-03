import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  type FeishuDeliveryPort,
  ResearchDistributionService,
} from "~/server/application/research-distribution/research-distribution-service";
import { ResearchInboxService } from "~/server/application/research-inbox/research-inbox-service";
import { ProductionRuntimeObserver } from "~/server/application/runtime-observability/production-runtime-observer";
import type { PostgresResearchScheduler } from "~/server/application/scheduling/postgres-research-scheduler";
import { PostgresFeishuDeliveryGuard } from "~/server/infrastructure/research-distribution/postgres-feishu-delivery-guard";
import { PrismaResearchDistributionStore } from "~/server/infrastructure/research-distribution/prisma-research-distribution-store";
import { PrismaResearchInboxRepository } from "~/server/infrastructure/research-inbox/prisma-research-inbox-repository";

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
              in: [
                "PENDING",
                "RETRY_WAIT",
                "DEFERRED_CIRCUIT",
                "CONFIG_BLOCKED",
              ],
            },
            nextAttemptAt: null,
          },
          {
            status: {
              in: [
                "PENDING",
                "RETRY_WAIT",
                "DEFERRED_CIRCUIT",
                "CONFIG_BLOCKED",
              ],
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
    try {
      if (claimed.task.taskType !== FEISHU_DELIVERY_TASK_TYPE) {
        throw new Error(
          `Feishu Worker 不能执行任务类型 ${claimed.task.taskType}`,
        );
      }
      const input = taskInputSchema.parse(claimed.task.input);
      const store = new PrismaResearchDistributionStore(this.db);
      const inbox = new ResearchInboxService(
        new PrismaResearchInboxRepository(this.db),
        { clock },
      );
      const guard = new PostgresFeishuDeliveryGuard(this.scheduler, {
        taskId: claimed.task.id,
        resourcePoolId: poolId,
        holderId: workerId,
        fencingToken: claimed.task.fencingToken,
        permitKey: `feishu-delivery:${claimed.task.id}`,
      });
      const service = new ResearchDistributionService(inbox, store, {
        clock,
        feishu: this.dependencies.feishu,
        feishuGuard: guard,
        deliveryLeaseMs: this.dependencies.deliveryLeaseMs,
      });
      const copy = await service.retryFeishuCopy(input.copyId);
      await observer.record({
        idempotencyKey: `feishu-worker:${claimed.task.id}:${claimed.task.fencingToken.toString()}:${copy.status}`,
        metricKind: "DELIVERY",
        stage: "external-delivery",
        resourcePool: FEISHU_POOL_KEY,
        startedAt,
        readyAt: clock(),
        success: copy.status === "SENT",
        degraded: copy.status !== "SENT",
        errorClass: copy.lastErrorCode,
        delivery: {
          channel: "FEISHU",
          status: deliveryStatus(copy.status),
          attempt: copy.attempts,
          latencyMs: Math.max(0, clock().getTime() - startedAt.getTime()),
        },
        context: {
          taskId: claimed.task.id,
          taskType: claimed.task.taskType,
          inputContractVersion: claimed.task.inputContractVersion,
          inputHash: claimed.task.inputHash,
          resultContractVersion: "feishu-delivery-result.v1",
          authoritativeObjectIds: [copy.id, copy.entryId],
          retryAttempt: claimed.task.attempts,
          fencingToken: claimed.task.fencingToken.toString(),
          ...(copy.status !== "SENT" ? { degradedReason: copy.status } : {}),
        },
      });
      await this.scheduler.settle(claimed.task.id, claimed.task.fencingToken, {
        disposition: "COMPLETED",
        resultContractVersion: "feishu-delivery-result.v1",
        result: {
          copyId: copy.id,
          status: copy.status,
          attemptNo: input.attemptNo,
        },
      });
      return { copy, taskId: claimed.task.id };
    } catch (error) {
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
        disposition: "RETRY",
        errorClass: "FEISHU_DELIVERY_WORKER_FAILED",
        retryable: true,
      });
      throw error;
    }
  }
}

function deliveryStatus(status: string) {
  if (status === "SENT") return "SENT" as const;
  if (status === "FAILED" || status === "CONFIG_BLOCKED")
    return "FAILED" as const;
  if (status === "RETRY_WAIT" || status === "DEFERRED_CIRCUIT")
    return "RETRY" as const;
  return "PENDING" as const;
}

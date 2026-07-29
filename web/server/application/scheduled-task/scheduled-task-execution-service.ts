import type { Prisma, PrismaClient } from "@prisma/client";
import { env } from "~/env";
import { scheduledTaskDeliverySpecSchema } from "~/server/domain/scheduled-task/contracts";
import { hasDeliveryTarget } from "~/server/domain/scheduled-task/delivery-targets";
import { publishDefinitiveTaskRun } from "./definitive-task-run-stream";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type ExecutionSubmission = {
  execution: { id: string; scheduledAt: Date };
  task: { id: string; userId: string };
  version: {
    id: string;
    executionPlan: Prisma.JsonValue;
  };
};

export async function submitScheduledTaskExecution(
  db: PrismaClient,
  item: ExecutionSubmission,
) {
  const runId = `scheduled-${item.execution.id}`;
  const plan = asRecord(item.version.executionPlan);
  if (plan.type === "deterministic_scoring") {
    try {
      await publishDefinitiveTaskRun(item.execution.id);
      await db.scheduledTaskExecution.updateMany({
        where: {
          id: item.execution.id,
          status: { in: ["PENDING", "CLAIMED"] },
        },
        data: { status: "SUBMITTED", workerId: null },
      });
      return { executionId: item.execution.id, submitted: true };
    } catch (error) {
      await db.scheduledTaskExecution.update({
        where: { id: item.execution.id },
        data: {
          status: "PENDING",
          error: {
            code: "DEFINITIVE_QUEUE_UNAVAILABLE",
            message: error instanceof Error ? error.message : String(error),
          },
        },
      });
      return { executionId: item.execution.id, submitted: false };
    }
  }
  await db.scheduledTaskExecution.update({
    where: { id: item.execution.id },
    data: { status: "SUBMITTED", agentRunId: runId },
  });
  const response = await fetch(
    `${env.AGENT_RUNTIME_URL.replace(/\/$/, "")}/internal/scheduled-task-runs`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        executionId: item.execution.id,
        taskId: item.task.id,
        taskVersionId: item.version.id,
        userId: item.task.userId,
        runId,
        executionPlan: item.version.executionPlan,
        allowedCapabilities: Array.isArray(plan.allowedCapabilities)
          ? plan.allowedCapabilities
          : [],
        scheduledAt: item.execution.scheduledAt.toISOString(),
      }),
    },
  );
  if (!response.ok) {
    await db.scheduledTaskExecution.update({
      where: { id: item.execution.id },
      data: {
        status: "RETRYING",
        error: { message: `agent-runtime ${response.status}` },
      },
    });
  }
  return { executionId: item.execution.id, submitted: response.ok };
}

export class ScheduledTaskExecutionService {
  constructor(private readonly db: PrismaClient) {}

  async trialRun(params: {
    userId: string;
    taskId: string;
    deliver: boolean;
    idempotencyKey: string;
  }) {
    const duplicate = await this.db.scheduledTaskExecution.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (duplicate?.taskId) {
      const owned = await this.db.scheduledTask.findFirst({
        where: { id: duplicate.taskId, userId: params.userId },
        select: { id: true },
      });
      if (owned) return { executionId: duplicate.id, submitted: true };
    }
    const task = await this.db.scheduledTask.findFirst({
      where: {
        id: params.taskId,
        userId: params.userId,
        status: { in: ["ACTIVE", "PAUSED"] },
      },
      include: { versions: { orderBy: { version: "desc" } } },
    });
    const version = task?.versions.find(
      (item) => item.version === task.currentVersion,
    );
    if (!task || !version) throw new Error("TASK_NOT_EXECUTABLE");
    const delivery = scheduledTaskDeliverySpecSchema.parse(
      version.deliverySpec,
    );
    if (params.deliver) {
      if (
        delivery.type !== "FEISHU" ||
        !hasDeliveryTarget("FEISHU", delivery.targetRef)
      ) {
        throw new Error("DELIVERY_TARGET_UNAVAILABLE");
      }
    }
    const deterministic = asRecord(version.executionPlan).type === "deterministic_scoring";
    const execution = await this.db.scheduledTaskExecution.create({
      data: {
        taskId: task.id,
        taskVersionId: version.id,
        scheduledAt: new Date(),
        status: deterministic ? "PENDING" : "CLAIMED",
        trigger: "MANUAL",
        deliveryRequested: params.deliver,
        idempotencyKey: params.idempotencyKey,
        workerId: deterministic ? null : "manual",
        claimedAt: deterministic ? null : new Date(),
        attempts: deterministic ? 0 : 1,
      },
    });
    return submitScheduledTaskExecution(this.db, {
      execution,
      task,
      version,
    });
  }
}

import { randomUUID } from "node:crypto";
import { type Prisma, PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { deliverScheduledTask } from "../scheduler-delivery";

const db = new PrismaClient();
const redisUrl = process.env.REDIS_URL ?? "redis://redis:6379";
const stream =
  process.env.SCHEDULED_TASK_EVENT_STREAM ?? "scheduled-task:events";
const group = process.env.SCHEDULED_TASK_EVENT_GROUP ?? "scheduler";
const consumer =
  process.env.SCHEDULED_TASK_EVENT_CONSUMER ??
  `scheduler-${process.pid}-${randomUUID()}`;
const pollMs = Number(process.env.SCHEDULER_POLL_INTERVAL_MS ?? 5000);
const blockMs = Number(process.env.SCHEDULED_TASK_EVENT_BLOCK_MS ?? 5000);
const claimIdleMs = Number(
  process.env.SCHEDULED_TASK_EVENT_CLAIM_IDLE_MS ?? 60_000,
);
const batchSize = Number(process.env.SCHEDULED_TASK_EVENT_BATCH_SIZE ?? 20);
const agentUrl = process.env.AGENT_RUNTIME_URL ?? "http://agent-runtime:8020";
const commands = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
const reader = new Redis(redisUrl, { maxRetriesPerRequest: null });
const recovery = new Redis(redisUrl, { maxRetriesPerRequest: 3 });

type StreamEvent = {
  eventType: string;
  executionId: string;
  occurredAt: string;
  errorCode?: string;
  errorMessage?: string;
};

function asRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function deliverySpec(value: Prisma.JsonValue) {
  const record = asRecord(value);
  return {
    type: typeof record.type === "string" ? record.type : undefined,
    targetRef:
      typeof record.targetRef === "string" ? record.targetRef : undefined,
  };
}

function deliveryResult(value: Prisma.JsonValue | null) {
  const record = value ? asRecord(value) : {};
  return {
    title: typeof record.title === "string" ? record.title : undefined,
    summary: typeof record.summary === "string" ? record.summary : undefined,
    body: typeof record.body === "string" ? record.body : undefined,
  };
}
function fieldsToEvent(fields: string[]): StreamEvent | null {
  const record: Record<string, string> = {};
  for (let index = 0; index < fields.length; index += 2)
    record[fields[index] ?? ""] = fields[index + 1] ?? "";
  if (!record.executionId || !record.eventType || !record.occurredAt)
    return null;
  return record as StreamEvent;
}

function nextRun(scheduleValue: Prisma.JsonValue, from: Date): Date | null {
  const schedule = asRecord(scheduleValue);
  const parts = String(schedule.time ?? "00:00")
    .split(":")
    .map(Number);
  const result = new Date(from);
  result.setUTCSeconds(0, 0);
  result.setUTCHours(parts[0] ?? 0, parts[1] ?? 0, 0, 0);
  if (result <= from) result.setUTCDate(result.getUTCDate() + 1);
  if (schedule.type === "WEEKLY" && Array.isArray(schedule.weekdays)) {
    for (let i = 0; i < 8; i += 1) {
      if (schedule.weekdays.includes(result.getUTCDay())) return result;
      result.setUTCDate(result.getUTCDate() + 1);
    }
    return null;
  }
  return result;
}

async function claimAndSubmit() {
  const item = await db.$transaction(async (tx) => {
    const task = await tx.scheduledTask.findFirst({
      where: { status: "ACTIVE", nextRunAt: { lte: new Date() } },
      orderBy: { nextRunAt: "asc" },
    });
    if (!task?.nextRunAt) return null;
    const version = await tx.scheduledTaskVersion.findUnique({
      where: {
        taskId_version: { taskId: task.id, version: task.currentVersion },
      },
    });
    if (!version) return null;
    const scheduledAt = task.nextRunAt;
    const nextRunAt = nextRun(version.scheduleSpec, scheduledAt);
    const claimed = await tx.scheduledTask.updateMany({
      where: { id: task.id, status: "ACTIVE", nextRunAt: scheduledAt },
      data: { nextRunAt },
    });
    if (claimed.count !== 1) return null;
    const execution = await tx.scheduledTaskExecution.create({
      data: {
        taskId: task.id,
        taskVersionId: version.id,
        scheduledAt,
        status: "CLAIMED",
        workerId: consumer,
        claimedAt: new Date(),
        attempts: 1,
      },
    });
    return { execution, version, task };
  });
  if (!item || item.execution.status !== "CLAIMED") return;
  const runId = `scheduled-${item.execution.id}`;
  const plan = asRecord(item.version.executionPlan);
  await db.scheduledTaskExecution.update({
    where: { id: item.execution.id },
    data: { status: "SUBMITTED", agentRunId: runId },
  });
  const response = await fetch(`${agentUrl}/internal/scheduled-task-runs`, {
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
  });
  if (!response.ok)
    await db.scheduledTaskExecution.update({
      where: { id: item.execution.id },
      data: {
        status: "RETRYING",
        error: { message: `agent-runtime ${response.status}` },
      },
    });
}

async function recoverStalledExecutions() {
  const cutoff = new Date(Date.now() - 3 * 60_000);
  const executions = await db.scheduledTaskExecution.findMany({
    where: {
      status: { in: ["SUBMITTED", "RUNNING", "RETRYING"] },
      updatedAt: { lt: cutoff },
      attempts: { lt: 5 },
    },
    include: { task: true, taskVersion: true },
    take: batchSize,
  });
  for (const execution of executions) {
    const claimed = await db.scheduledTaskExecution.updateMany({
      where: {
        id: execution.id,
        status: execution.status,
        updatedAt: execution.updatedAt,
      },
      data: {
        status: "SUBMITTED",
        attempts: { increment: 1 },
        error: undefined,
      },
    });
    if (claimed.count !== 1) continue;
    const plan = execution.taskVersion.executionPlan as Record<string, unknown>;
    const response = await fetch(`${agentUrl}/internal/scheduled-task-runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        executionId: execution.id,
        taskId: execution.taskId,
        taskVersionId: execution.taskVersionId,
        userId: execution.task.userId,
        runId: execution.agentRunId ?? `scheduled-${execution.id}`,
        executionPlan: plan,
        allowedCapabilities: Array.isArray(plan.allowedCapabilities)
          ? plan.allowedCapabilities
          : [],
        scheduledAt: execution.scheduledAt.toISOString(),
      }),
    });
    if (!response.ok)
      await db.scheduledTaskExecution.update({
        where: { id: execution.id },
        data: {
          status: "RETRYING",
          error: { message: `agent-runtime ${response.status}` },
        },
      });
  }
}

async function processEvent(messageId: string, fields: string[]) {
  const event = fieldsToEvent(fields);
  if (!event) {
    await commands.xack(stream, group, messageId);
    return;
  }
  const occurredAt = new Date(event.occurredAt);
  await db.$transaction(async (tx) => {
    const execution = await tx.scheduledTaskExecution.findUnique({
      where: { id: event.executionId },
      include: { taskVersion: true },
    });
    if (!execution) return;
    if (
      event.eventType === "execution.started" &&
      execution.status === "SUBMITTED"
    )
      await tx.scheduledTaskExecution.update({
        where: { id: execution.id },
        data: { status: "RUNNING", startedAt: occurredAt },
      });
    if (
      event.eventType === "execution.succeeded" &&
      execution.status !== "FAILED" &&
      execution.status !== "CANCELLED"
    )
      await tx.scheduledTaskExecution.update({
        where: { id: execution.id },
        data: {
          status: "SUCCEEDED",
          completedAt: execution.completedAt ?? occurredAt,
          eventPublishedAt: new Date(),
          lastEventError: undefined,
        },
      });
    if (
      event.eventType === "execution.succeeded" &&
      execution.status !== "FAILED" &&
      execution.status !== "CANCELLED"
    ) {
      const spec = deliverySpec(execution.taskVersion.deliverySpec);
      if (spec.type) {
        const targetRef = spec.targetRef ?? "";
        await tx.scheduledTaskDelivery.upsert({
          where: {
            executionId_targetType_targetRef: {
              executionId: execution.id,
              targetType: spec.type,
              targetRef,
            },
          },
          create: {
            executionId: execution.id,
            targetType: spec.type,
            targetRef,
          },
          update: {},
        });
      }
    }
    if (
      event.eventType === "execution.failed" &&
      execution.status !== "SUCCEEDED"
    )
      await tx.scheduledTaskExecution.update({
        where: { id: execution.id },
        data: {
          status: "FAILED",
          completedAt: execution.completedAt ?? occurredAt,
          eventPublishedAt: new Date(),
          error: execution.error ?? {
            code: event.errorCode,
            message: event.errorMessage,
          },
        },
      });
    if (
      event.eventType === "execution.cancelled" &&
      execution.status !== "SUCCEEDED"
    )
      await tx.scheduledTaskExecution.update({
        where: { id: execution.id },
        data: {
          status: "CANCELLED",
          completedAt: execution.completedAt ?? occurredAt,
          eventPublishedAt: new Date(),
        },
      });
  });
  await commands.xack(stream, group, messageId);
}

async function consumeNew() {
  while (true) {
    try {
      const response = (await reader.xreadgroup(
        "GROUP",
        group,
        consumer,
        "COUNT",
        batchSize,
        "BLOCK",
        blockMs,
        "STREAMS",
        stream,
        ">",
      )) as Array<[string, Array<[string, string[]]>]> | null;
      for (const [, messages] of response ?? [])
        for (const [id, fields] of messages) await processEvent(id, fields);
    } catch (error) {
      console.error("[scheduler] stream read failed", error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function recoverPending() {
  while (true) {
    try {
      const response = (await recovery.xautoclaim(
        stream,
        group,
        consumer,
        claimIdleMs,
        "0-0",
        "COUNT",
        batchSize,
      )) as [string, Array<[string, string[]]>, string[]];
      for (const [id, fields] of response[1] ?? [])
        await processEvent(id, fields);
    } catch (error) {
      console.error("[scheduler] pending recovery failed", error);
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(claimIdleMs / 2, 5000)),
    );
  }
}

async function processDeliveries() {
  const deliveries = await db.scheduledTaskDelivery.findMany({
    where: { status: { in: ["PENDING", "RETRYING"] }, attempts: { lt: 5 } },
    include: { execution: { include: { taskVersion: true } } },
    take: batchSize,
  });
  for (const delivery of deliveries) {
    const spec = deliverySpec(delivery.execution.taskVersion.deliverySpec);
    try {
      await deliverScheduledTask(
        spec,
        deliveryResult(delivery.execution.result),
      );
      await db.scheduledTaskDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          attempts: { increment: 1 },
          error: null,
        },
      });
    } catch (error) {
      await db.scheduledTaskDelivery.update({
        where: { id: delivery.id },
        data: {
          status: delivery.attempts >= 4 ? "FAILED" : "RETRYING",
          attempts: { increment: 1 },
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

async function recoverDatabaseEvents() {
  const cutoff = new Date(Date.now() - 30_000);
  const executions = await db.scheduledTaskExecution.findMany({
    where: {
      status: { in: ["SUCCEEDED", "FAILED", "CANCELLED"] },
      eventPublishedAt: null,
      completedAt: { lt: cutoff },
    },
    take: batchSize,
  });
  for (const execution of executions) {
    const eventType = `execution.${execution.status.toLowerCase()}`;
    try {
      await commands.xadd(
        stream,
        "MAXLEN",
        "~",
        10_000,
        "*",
        "eventId",
        randomUUID(),
        "eventType",
        eventType,
        "executionId",
        execution.id,
        "taskId",
        execution.taskId,
        "taskVersionId",
        execution.taskVersionId,
        "runId",
        execution.agentRunId ?? "",
        "status",
        execution.status.toLowerCase(),
        "resultRef",
        execution.id,
        "occurredAt",
        (execution.completedAt ?? new Date()).toISOString(),
        "attempt",
        String(execution.attempts),
      );
    } catch (error) {
      await db.scheduledTaskExecution.update({
        where: { id: execution.id },
        data: {
          lastEventError: {
            message: error instanceof Error ? error.message : String(error),
          },
        },
      });
    }
  }
}

async function main() {
  try {
    await commands.xgroup("CREATE", stream, group, "0", "MKSTREAM");
  } catch (error) {
    if (!String(error).includes("BUSYGROUP")) throw error;
  }
  console.info(
    `[scheduler] consumer=${consumer} stream=${stream} group=${group}`,
  );
  setInterval(
    () =>
      void claimAndSubmit().catch((error) =>
        console.error("[scheduler] dispatch failed", error),
      ),
    pollMs,
  );
  setInterval(
    () =>
      void processDeliveries().catch((error) =>
        console.error("[scheduler] delivery failed", error),
      ),
    5000,
  );
  setInterval(
    () =>
      void recoverDatabaseEvents().catch((error) =>
        console.error("[scheduler] database recovery failed", error),
      ),
    30_000,
  );
  setInterval(
    () =>
      void recoverStalledExecutions().catch((error) =>
        console.error("[scheduler] execution recovery failed", error),
      ),
    30_000,
  );
  void consumeNew();
  void recoverPending();
  void claimAndSubmit();
}

void main().catch((error) => {
  console.error("[scheduler] fatal", error);
  process.exitCode = 1;
});

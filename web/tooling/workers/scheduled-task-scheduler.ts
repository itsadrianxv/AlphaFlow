import { randomUUID } from "node:crypto";
import { type Prisma, PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { publishDefinitiveTaskRun } from "../../server/application/scheduled-task/definitive-task-run-stream";
import { enqueueHomePageTask } from "../../server/application/homepage/home-page-snapshot-service";
import { publishHomePageGenerationTask } from "../../server/application/homepage/home-page-task-stream";
import {
  homePageDueDateCandidates,
  shanghaiClock,
} from "../../server/application/homepage/home-page-schedule";
import { submitScheduledTaskExecution } from "../../server/application/scheduled-task/scheduled-task-execution-service";
import {
  scheduledTaskDeliverySpecSchema,
  scheduledTaskOutputSpecSchema,
} from "../../server/domain/scheduled-task/contracts";
import { assertDeliveryTargetSecretsConfigured } from "../../server/domain/scheduled-task/delivery-targets";
import {
  computeNextRunAt,
  type ScheduleSpec,
} from "../../server/domain/scheduled-task/schedule";
import { resolvePublicBaseUrl } from "../../shared/public-url";
import {
  DeliveryAttemptError,
  deliverScheduledTask,
} from "../scheduler-delivery";

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
const deliveryStuckMs = Number(
  process.env.SCHEDULED_TASK_DELIVERY_STUCK_MS ?? 5 * 60_000,
);
const agentUrl = process.env.AGENT_RUNTIME_URL ?? "http://agent-runtime:8020";
const pythonUrl =
  process.env.PYTHON_SERVICE_URL ?? "http://python-service:8000";
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
  const parsed = scheduledTaskDeliverySpecSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function deliveryResult(
  value: Prisma.JsonValue | null,
  context?: {
    taskName: string;
    executionId: string;
    rows: Array<{ stockCode: string; stockName: string; rank: number; score: number }>;
    summaryLimit: number;
  },
) {
  const record = value ? asRecord(value) : {};
  if (record.type === "SCORING_REPORT" && context) {
    const rows = context.rows.slice(0, context.summaryLimit);
    const baseUrl = resolvePublicBaseUrl({ authUrl: process.env.AUTH_URL });
    const lines = rows.map(
      (row) =>
        `${row.rank}. ${row.stockName}（${row.stockCode}） ${row.score} 分`,
    );
    return {
      title: `${context.taskName}评分完成`,
      summary: `入选 ${String(record.selectedCount ?? rows.length)} 只股票`,
      body: [
        `数据截止：${String(record.asOfDate ?? "-")}`,
        `评估 ${String(record.evaluatedCount ?? "-")} / ${String(record.universeCount ?? "-")} 只股票，入选 ${String(record.selectedCount ?? rows.length)} 只。`,
        ...lines,
        `完整结果与 Excel：${baseUrl}/api/scheduled-tasks/executions/${context.executionId}/export`,
      ].join("\n"),
    };
  }
  return {
    title: typeof record.title === "string" ? record.title : undefined,
    summary: typeof record.summary === "string" ? record.summary : undefined,
    body: typeof record.body === "string" ? record.body : undefined,
  };
}

function isEmptyResult(value: Prisma.JsonValue | null) {
  const quality = asRecord(asRecord(value).quality as Prisma.JsonValue);
  return quality.emptyResult === true;
}
function fieldsToEvent(fields: string[]): StreamEvent | null {
  const record: Record<string, string> = {};
  for (let index = 0; index < fields.length; index += 2)
    record[fields[index] ?? ""] = fields[index + 1] ?? "";
  if (!record.executionId || !record.eventType || !record.occurredAt)
    return null;
  return record as StreamEvent;
}

async function isTradingDay(date: string, marketCalendar: string) {
  const response = await fetch(
    `${pythonUrl.replace(/\/$/, "")}/api/v1/capabilities/tushare/query-dataset`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        dataset: "trade_cal",
        params: { exchange: marketCalendar, start_date: date, end_date: date },
        maxRows: 5,
      }),
    },
  );
  if (!response.ok)
    throw new Error(`MARKET_CALENDAR_UNAVAILABLE_${response.status}`);
  const payload = (await response.json()) as {
    rows?: Array<Record<string, unknown>>;
  };
  return (payload.rows ?? []).some((row) => String(row.is_open) === "1");
}

async function claimAndSubmit() {
  const task = await db.scheduledTask.findFirst({
    where: { status: "ACTIVE", nextRunAt: { lte: new Date() } },
    orderBy: { nextRunAt: "asc" },
  });
  if (!task?.nextRunAt) return;
  const version = await db.scheduledTaskVersion.findUnique({
    where: {
      taskId_version: { taskId: task.id, version: task.currentVersion },
    },
  });
  if (!version) return;
  const scheduledAt = task.nextRunAt;
  const plan = asRecord(version.executionPlan);
  const deterministic = plan.type === "deterministic_scoring";
  const nextRunAt = await computeNextRunAt(
    version.scheduleSpec as unknown as ScheduleSpec,
    scheduledAt,
    isTradingDay,
  );
  const item = await db.$transaction(async (tx) => {
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
        status: deterministic ? "PENDING" : "CLAIMED",
        workerId: deterministic ? null : consumer,
        claimedAt: deterministic ? null : new Date(),
        attempts: deterministic ? 0 : 1,
        trigger: "SCHEDULED",
        deliveryRequested:
          deliverySpec(version.deliverySpec)?.type === "FEISHU",
      },
    });
    return { execution, version, task };
  });
  if (!item) return;
  await submitScheduledTaskExecution(db, item);
}

async function recoverStalledExecutions() {
  const now = new Date();
  const retryGrace = new Date(now.getTime() - 30_000);
  const definitiveCandidates = await db.scheduledTaskExecution.findMany({
    where: {
      OR: [
        { status: "PENDING", updatedAt: { lt: retryGrace } },
        {
          status: "RETRYING",
          nextAttemptAt: { lte: retryGrace },
          attempts: { lt: 4 },
        },
        { status: "RUNNING", leaseExpiresAt: { lte: now }, attempts: { lt: 4 } },
        { status: "SUBMITTED", updatedAt: { lt: new Date(now.getTime() - 3 * 60_000) }, attempts: { lt: 4 } },
      ],
    },
    include: { taskVersion: true },
    take: batchSize,
  });
  for (const execution of definitiveCandidates) {
    if (asRecord(execution.taskVersion.executionPlan).type !== "deterministic_scoring")
      continue;
    try {
      await publishDefinitiveTaskRun(execution.id);
      if (execution.status === "PENDING" || execution.status === "RETRYING")
        await db.scheduledTaskExecution.updateMany({
          where: { id: execution.id, status: execution.status },
          data: { status: "SUBMITTED", error: undefined },
        });
    } catch (error) {
      await db.scheduledTaskExecution.update({
        where: { id: execution.id },
        data: {
          error: {
            code: "DEFINITIVE_REQUEUE_FAILED",
            message: error instanceof Error ? error.message : String(error),
          },
        },
      });
    }
  }

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
    if (asRecord(execution.taskVersion.executionPlan).type === "deterministic_scoring")
      continue;
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
      execution.status !== "CANCELLED" &&
      execution.deliveryRequested
    ) {
      const spec = deliverySpec(execution.taskVersion.deliverySpec);
      if (spec?.type === "FEISHU") {
        const targetRef = spec.targetRef;
        const output = scheduledTaskOutputSpecSchema.safeParse(
          execution.taskVersion.outputSpec,
        );
        const skipEmpty =
          output.success &&
          !output.data.sendOnEmpty &&
          isEmptyResult(execution.result);
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
            status: skipEmpty ? "SKIPPED" : "PENDING",
            error: skipEmpty ? "EMPTY_RESULT" : undefined,
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
  const stuckBefore = new Date(Date.now() - deliveryStuckMs);
  await db.scheduledTaskDelivery.updateMany({
    where: {
      status: "SENDING",
      updatedAt: { lt: stuckBefore },
      attempts: { lt: 5 },
    },
    data: { status: "RETRYING", error: "DELIVERY_WORKER_INTERRUPTED" },
  });
  await db.scheduledTaskDelivery.updateMany({
    where: {
      status: "SENDING",
      updatedAt: { lt: stuckBefore },
      attempts: { gte: 5 },
    },
    data: { status: "FAILED", error: "DELIVERY_RETRY_EXHAUSTED" },
  });
  const deliveries = await db.scheduledTaskDelivery.findMany({
    where: { status: { in: ["PENDING", "RETRYING"] }, attempts: { lt: 5 } },
    include: {
      execution: {
        include: {
          taskVersion: true,
          task: { select: { name: true } },
          scoreResults: {
            where: { selected: true },
            orderBy: { rank: "asc" },
            take: 50,
            select: {
              stockCode: true,
              stockName: true,
              rank: true,
              score: true,
            },
          },
        },
      },
    },
    take: batchSize,
  });
  for (const delivery of deliveries) {
    const claimed = await db.scheduledTaskDelivery.updateMany({
      where: {
        id: delivery.id,
        status: delivery.status,
        attempts: delivery.attempts,
      },
      data: { status: "SENDING", attempts: { increment: 1 }, error: null },
    });
    if (claimed.count !== 1) continue;
    const attempt = delivery.attempts + 1;
    const spec = deliverySpec(delivery.execution.taskVersion.deliverySpec);
    if (!spec || spec.type !== "FEISHU") {
      await db.scheduledTaskDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", error: "INVALID_DELIVERY_SPEC" },
      });
      continue;
    }
    const output = scheduledTaskOutputSpecSchema.parse(
      delivery.execution.taskVersion.outputSpec,
    );
    const summaryLimit =
      "type" in output && output.type === "SCORING_REPORT"
        ? output.feishuSummaryLimit
        : 20;
    try {
      const result = await deliverScheduledTask(
        spec,
        deliveryResult(delivery.execution.result, {
          taskName: delivery.execution.task.name,
          executionId: delivery.execution.id,
          rows: delivery.execution.scoreResults,
          summaryLimit,
        }),
      );
      if (result.outcome !== "SENT")
        throw new DeliveryAttemptError(
          "UNEXPECTED_DELIVERY_OUTCOME",
          "投递器没有确认发送成功",
          false,
        );
      await db.scheduledTaskDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          error: null,
        },
      });
    } catch (error) {
      const retryable =
        error instanceof DeliveryAttemptError && error.retryable && attempt < 5;
      const code =
        error instanceof DeliveryAttemptError
          ? error.code
          : "DELIVERY_UNEXPECTED_ERROR";
      const message = error instanceof Error ? error.message : String(error);
      await db.scheduledTaskDelivery.update({
        where: { id: delivery.id },
        data: {
          status: retryable ? "RETRYING" : "FAILED",
          error: `${code}: ${message}`,
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

async function scheduleHomePageDefault() {
  const snapshot = await db.homePageSnapshot.findFirst({
    where: { scope: "DEFAULT" },
    orderBy: { generatedAt: "desc" },
    select: { id: true },
  });
  const clock = shanghaiClock();
  if (!snapshot) {
    await enqueueHomePageTask(db, {
      scope: "DEFAULT",
      triggerReason: "BOOTSTRAP",
      targetTradeDate: clock.date,
    });
    return;
  }
  let targetTradeDate: string | undefined;
  for (const candidate of homePageDueDateCandidates()) {
    if (await isTradingDay(candidate.replaceAll("-", ""), "SSE")) {
      targetTradeDate = candidate;
      break;
    }
  }
  if (!targetTradeDate) return;
  await enqueueHomePageTask(db, {
    scope: "DEFAULT",
    triggerReason: "DEFAULT_DAILY",
    targetTradeDate,
  });
}

async function recoverHomePageTaskEvents() {
  const tasks = await db.homePageGenerationTask.findMany({
    where: {
      status: { in: ["PENDING", "RETRY_WAIT"] },
      eventPublishedAt: null,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });
  for (const task of tasks) {
    try {
      const published = await publishHomePageGenerationTask(task.id, commands);
      await db.homePageGenerationTask.updateMany({
        where: { id: task.id, eventPublishedAt: null },
        data: { eventPublishedAt: new Date(published.createdAt) },
      });
    } catch (error) {
      console.error("[scheduler] homepage event publish failed", error);
    }
  }
}

async function main() {
  assertDeliveryTargetSecretsConfigured();
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
    () => void scheduleHomePageDefault().catch((error) =>
      console.error("[scheduler] homepage schedule failed", error),
    ),
    60_000,
  );
  setInterval(
    () => void recoverHomePageTaskEvents().catch((error) =>
      console.error("[scheduler] homepage event recovery failed", error),
    ),
    5_000,
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
  void scheduleHomePageDefault();
  void recoverHomePageTaskEvents();
}

void main().catch((error) => {
  console.error("[scheduler] fatal", error);
  process.exitCode = 1;
});

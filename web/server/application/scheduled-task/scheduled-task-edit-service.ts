import type { Prisma, PrismaClient } from "@prisma/client";
import { ScheduledTaskSetupService } from "~/server/application/scheduled-task/scheduled-task-setup-service";
import {
  type ScheduledTaskDraftInput,
  scheduledTaskDeliverySpecSchema,
  scheduledTaskOutputSpecSchema,
  scheduledTaskStructuredEditSchema,
  scheduleSpecSchema,
} from "~/server/domain/scheduled-task/contracts";
import { hasDeliveryTarget } from "~/server/domain/scheduled-task/delivery-targets";
import {
  ScheduledTaskAgentChangeController,
  scoringTaskAgentChangeSetSchema,
} from "./scheduled-task-agent-change-controller";

type DraftSource = "STRUCTURED" | "AGENT";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function json(value: unknown) {
  return value as Prisma.InputJsonValue;
}

function comparable(value: unknown) {
  return JSON.stringify(value);
}

function scoringBuilderDraft(params: {
  name: string;
  scheduleSpec: unknown;
  executionPlan: unknown;
  outputSpec: unknown;
  deliverySpec: unknown;
}) {
  const plan = asRecord(params.executionPlan);
  const universe = asRecord(plan.universe);
  const indicators = Array.isArray(plan.indicators)
    ? plan.indicators.map(asRecord)
    : [];
  const macd = indicators.find((item) => item.type === "macd");
  const kdj = indicators.find((item) => item.type === "kdj");
  return {
    name: params.name,
    schedule: params.scheduleSpec,
    universe:
      universe.type === "stocks"
        ? {
            type: "stocks" as const,
            stockInputs: Array.isArray(universe.stockCodes)
              ? universe.stockCodes.map(String)
              : [],
          }
        : { type: "all_a_shares" as const },
    data: plan.data,
    indicatorParams: {
      macd: {
        fast: 12,
        slow: 26,
        signal: 9,
        ...asRecord(macd?.params),
      },
      kdj: {
        period: 9,
        kSmoothing: 3,
        dSmoothing: 3,
        ...asRecord(kdj?.params),
      },
    },
    rules: plan.rules,
    selection: plan.selection,
    output: params.outputSpec,
    delivery: params.deliverySpec,
  };
}

function buildChanges(
  current: {
    name: string;
    schedule: unknown;
    output: unknown;
    delivery: unknown;
    userPrompt: string;
    dataSources: unknown;
  },
  next: typeof current,
) {
  const fields = [
    ["name", "任务名称", current.name, next.name],
    ["userPrompt", "任务目标", current.userPrompt, next.userPrompt],
    ["dataSources", "数据来源", current.dataSources, next.dataSources],
    ["schedule", "执行计划", current.schedule, next.schedule],
    ["output", "输出配置", current.output, next.output],
    ["delivery", "投递设置", current.delivery, next.delivery],
  ] as const;
  return fields.flatMap(([field, label, before, after]) =>
    comparable(before) === comparable(after)
      ? []
      : [{ field, label, before, after }],
  );
}

export class ScheduledTaskEditService {
  private readonly setup: ScheduledTaskSetupService;

  constructor(private readonly db: PrismaClient) {
    this.setup = new ScheduledTaskSetupService(db);
  }

  private async currentTask(userId: string, taskId: string) {
    const task = await this.db.scheduledTask.findFirst({
      where: {
        id: taskId,
        userId,
        status: { in: ["ACTIVE", "PAUSED"] },
      },
      include: { versions: { orderBy: { version: "desc" } } },
    });
    const version = task?.versions.find(
      (item) => item.version === task.currentVersion,
    );
    if (!task || !version) throw new Error("TASK_NOT_EDITABLE");
    return { task, version };
  }

  async prepareStructured(params: {
    userId: string;
    taskId: string;
    input: unknown;
    idempotencyKey: string;
  }) {
    const duplicate = await this.db.scheduledTaskEditDraft.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (duplicate?.userId === params.userId) return duplicate;

    const input = scheduledTaskStructuredEditSchema.parse(params.input);
    if (
      input.delivery.type === "FEISHU" &&
      !hasDeliveryTarget("FEISHU", input.delivery.targetRef)
    ) {
      throw new Error("DELIVERY_TARGET_UNAVAILABLE");
    }
    const { task, version } = await this.currentTask(
      params.userId,
      params.taskId,
    );
    const nextRunAt = await this.setup.nextRunAt(input.schedule);
    if (!nextRunAt) throw new Error("NEXT_RUN_UNAVAILABLE");
    const currentOutput = scheduledTaskOutputSpecSchema.parse(
      version.outputSpec,
    );
    const currentDelivery = scheduledTaskDeliverySpecSchema.parse(
      version.deliverySpec,
    );
    const currentSchedule = scheduleSpecSchema.parse(version.scheduleSpec);
    const changes = buildChanges(
      {
        name: task.name,
        userPrompt: version.userPrompt,
        dataSources: version.dataSources,
        schedule: currentSchedule,
        output: currentOutput,
        delivery: currentDelivery,
      },
      {
        name: input.name,
        userPrompt: version.userPrompt,
        dataSources: version.dataSources,
        schedule: input.schedule,
        output: input.output,
        delivery: input.delivery,
      },
    );
    if (!changes.length) throw new Error("NO_CHANGES");

    return this.replacePendingDraft({
      userId: params.userId,
      taskId: task.id,
      source: "STRUCTURED",
      baseVersion: task.currentVersion,
      name: input.name,
      userPrompt: version.userPrompt,
      scheduleSpec: input.schedule,
      dataSources: version.dataSources,
      executionPlan: {
        ...asRecord(version.executionPlan),
        output: input.output,
      },
      outputSpec: input.output,
      deliverySpec: input.delivery,
      feasibility: version.feasibility,
      changes,
      nextRunAt,
      idempotencyKey: params.idempotencyKey,
    });
  }

  async prepareAgent(params: {
    userId: string;
    taskId: string;
    conversationId: string;
    value: unknown;
    idempotencyKey: string;
  }) {
    const duplicate = await this.db.scheduledTaskEditDraft.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (duplicate?.userId === params.userId) return duplicate;
    const { task, version } = await this.currentTask(
      params.userId,
      params.taskId,
    );
    const validated = await this.setup.validateDraft(params.value);
    const feasibility = asRecord(validated.feasibility);
    if (
      !["SUPPORTED", "SUPPORTED_WITH_LIMITS"].includes(
        String(feasibility.status),
      )
    ) {
      throw new Error("DRAFT_NOT_CONFIRMABLE");
    }
    const draft = validated as ScheduledTaskDraftInput &
      Record<string, unknown>;
    const changes = buildChanges(
      {
        name: task.name,
        userPrompt: version.userPrompt,
        dataSources: version.dataSources,
        schedule: scheduleSpecSchema.parse(version.scheduleSpec),
        output: scheduledTaskOutputSpecSchema.parse(version.outputSpec),
        delivery: scheduledTaskDeliverySpecSchema.parse(version.deliverySpec),
      },
      {
        name: draft.name,
        userPrompt: draft.userPrompt,
        dataSources: draft.dataSources,
        schedule: draft.schedule,
        output: draft.output,
        delivery: draft.delivery,
      },
    );
    if (!changes.length) throw new Error("NO_CHANGES");
    return this.replacePendingDraft({
      userId: params.userId,
      taskId: task.id,
      conversationId: params.conversationId,
      source: "AGENT",
      baseVersion: task.currentVersion,
      name: draft.name,
      userPrompt: draft.userPrompt,
      scheduleSpec: draft.schedule,
      dataSources: draft.dataSources,
      executionPlan: draft.executionPlan,
      outputSpec: draft.output,
      deliverySpec: draft.delivery,
      feasibility: draft.feasibility,
      changes,
      nextRunAt: new Date(String(draft.nextRunAt)),
      idempotencyKey: params.idempotencyKey,
    });
  }

  async prepareScoringAgentChange(params: {
    userId: string;
    taskId: string;
    conversationId: string;
    changeSet: unknown;
    idempotencyKey: string;
  }) {
    const duplicate = await this.db.scheduledTaskEditDraft.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (duplicate?.userId === params.userId) return duplicate;
    const parsed = scoringTaskAgentChangeSetSchema.parse(params.changeSet);
    if (parsed.ambiguity.status === "NEEDS_CLARIFICATION")
      return {
        status: "NEEDS_CLARIFICATION" as const,
        question: parsed.ambiguity.question,
      };
    const task = await this.db.scheduledTask.findFirst({
      where: {
        id: params.taskId,
        userId: params.userId,
        status: { in: ["DRAFT", "ACTIVE", "PAUSED"] },
      },
      include: {
        versions: {
          where: { version: parsed.generatedAtVersion },
          take: 1,
        },
      },
    });
    const version = task?.versions[0];
    if (!task || !version) throw new Error("EDIT_VERSION_CONFLICT");
    const baseDraft = scoringBuilderDraft({
      name: task.name,
      scheduleSpec: version.scheduleSpec,
      executionPlan: version.executionPlan,
      outputSpec: version.outputSpec,
      deliverySpec: version.deliverySpec,
    });
    const applied = new ScheduledTaskAgentChangeController().apply({
      generatedDraft: baseDraft,
      currentDraft: baseDraft,
      currentVersion: parsed.generatedAtVersion,
      changeSet: parsed,
    });
    if (applied.status !== "APPLIED") throw new Error("DRAFT_NOT_CONFIRMABLE");
    const nextRunAt = await this.setup.nextRunAt(applied.draft.schedule);
    if (!nextRunAt) throw new Error("NEXT_RUN_UNAVAILABLE");
    return this.replacePendingDraft({
      userId: params.userId,
      taskId: task.id,
      conversationId: params.conversationId,
      source: "AGENT",
      baseVersion: parsed.generatedAtVersion,
      name: applied.draft.name,
      userPrompt: version.userPrompt,
      scheduleSpec: applied.draft.schedule,
      dataSources: version.dataSources,
      executionPlan: applied.draft.executionPlan,
      outputSpec: version.outputSpec,
      deliverySpec: version.deliverySpec,
      feasibility: {
        status: "SUPPORTED",
        warnings: [],
        blockingIssues: [],
      },
      changes: applied.markers,
      nextRunAt,
      idempotencyKey: params.idempotencyKey,
    });
  }

  private async replacePendingDraft(params: {
    userId: string;
    taskId: string;
    conversationId?: string;
    source: DraftSource;
    baseVersion: number;
    name: string;
    userPrompt: string;
    scheduleSpec: unknown;
    dataSources: unknown;
    executionPlan: unknown;
    outputSpec: unknown;
    deliverySpec: unknown;
    feasibility: unknown;
    changes: unknown;
    nextRunAt: Date;
    idempotencyKey: string;
  }) {
    return this.db.$transaction(async (tx) => {
      const previous = await tx.scheduledTaskEditDraft.findFirst({
        where: {
          taskId: params.taskId,
          userId: params.userId,
          source: params.source,
          status: "PENDING",
          ...(params.conversationId
            ? { conversationId: params.conversationId }
            : { conversationId: null }),
        },
        orderBy: { updatedAt: "desc" },
      });
      if (previous) {
        await tx.scheduledTaskEditDraft.update({
          where: { id: previous.id },
          data: {
            baseVersion: params.baseVersion,
            revision: { increment: 1 },
            name: params.name,
            userPrompt: params.userPrompt,
            scheduleSpec: json(params.scheduleSpec),
            dataSources: json(params.dataSources),
            executionPlan: json(params.executionPlan),
            outputSpec: json(params.outputSpec),
            deliverySpec: json(params.deliverySpec),
            feasibility: json(params.feasibility),
            changes: json(params.changes),
            nextRunAt: params.nextRunAt,
            idempotencyKey: params.idempotencyKey,
          },
        });
        return tx.scheduledTaskEditDraft.findUniqueOrThrow({
          where: { id: previous.id },
        });
      }
      return tx.scheduledTaskEditDraft.create({
        data: {
          taskId: params.taskId,
          userId: params.userId,
          conversationId: params.conversationId,
          source: params.source,
          baseVersion: params.baseVersion,
          name: params.name,
          userPrompt: params.userPrompt,
          scheduleSpec: json(params.scheduleSpec),
          dataSources: json(params.dataSources),
          executionPlan: json(params.executionPlan),
          outputSpec: json(params.outputSpec),
          deliverySpec: json(params.deliverySpec),
          feasibility: json(params.feasibility),
          changes: json(params.changes),
          nextRunAt: params.nextRunAt,
          idempotencyKey: params.idempotencyKey,
        },
      });
    });
  }

  async confirm(params: {
    userId: string;
    draftId: string;
    expectedRevision: number;
  }) {
    const draft = await this.db.scheduledTaskEditDraft.findFirst({
      where: {
        id: params.draftId,
        userId: params.userId,
        status: "PENDING",
        revision: params.expectedRevision,
      },
    });
    if (!draft?.nextRunAt) throw new Error("EDIT_DRAFT_NOT_FOUND");
    const nextVersion = draft.baseVersion + 1;
    return this.db.$transaction(async (tx) => {
      const updated = await tx.scheduledTask.updateMany({
        where: {
          id: draft.taskId,
          userId: params.userId,
          currentVersion: draft.baseVersion,
          status: { in: ["ACTIVE", "PAUSED"] },
        },
        data: {
          name: draft.name,
          timezone: scheduleSpecSchema.parse(draft.scheduleSpec).timezone,
          currentVersion: nextVersion,
          nextRunAt: draft.nextRunAt,
        },
      });
      if (updated.count !== 1) throw new Error("EDIT_VERSION_CONFLICT");
      await tx.scheduledTaskVersion.create({
        data: {
          taskId: draft.taskId,
          version: nextVersion,
          userPrompt: draft.userPrompt,
          scheduleSpec: json(draft.scheduleSpec),
          dataSources: json(draft.dataSources),
          executionPlan: json(draft.executionPlan),
          outputSpec: json(draft.outputSpec),
          deliverySpec: json(draft.deliverySpec),
          feasibility: json(draft.feasibility),
          idempotencyKey: `edit:${draft.id}`,
        },
      });
      await tx.scheduledTaskEditDraft.update({
        where: { id: draft.id },
        data: { status: "CONFIRMED", confirmedAt: new Date() },
      });
      await tx.scheduledTaskEditDraft.updateMany({
        where: {
          taskId: draft.taskId,
          status: "PENDING",
          id: { not: draft.id },
        },
        data: { status: "DISCARDED", discardedAt: new Date() },
      });
      if (draft.conversationId) {
        await tx.agentConversation.updateMany({
          where: {
            id: draft.conversationId,
            userId: params.userId,
            activeScheduledTaskEditTaskId: draft.taskId,
          },
          data: {
            routingMode: "AUTO",
            activeScheduledTaskEditTaskId: null,
          },
        });
      }
      return { taskId: draft.taskId, version: nextVersion };
    });
  }

  async discard(params: { userId: string; draftId: string }) {
    const discarded = await this.db.scheduledTaskEditDraft.updateMany({
      where: {
        id: params.draftId,
        userId: params.userId,
        status: "PENDING",
      },
      data: { status: "DISCARDED", discardedAt: new Date() },
    });
    if (discarded.count !== 1) throw new Error("EDIT_DRAFT_NOT_FOUND");
    return { discarded: true as const };
  }
}

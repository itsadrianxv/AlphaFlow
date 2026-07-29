import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "~/env";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { AgentConversationService } from "~/server/application/agent-runtime/agent-conversation-service";
import { ScheduledTaskEditService } from "~/server/application/scheduled-task/scheduled-task-edit-service";
import { ScheduledTaskExecutionService } from "~/server/application/scheduled-task/scheduled-task-execution-service";
import { ScheduledTaskSetupService } from "~/server/application/scheduled-task/scheduled-task-setup-service";
import { WorkflowCommandService } from "~/server/application/workflow/command-service";
import {
  deterministicExecutionPlanSchema,
  scheduledTaskDeliverySpecSchema,
  scheduledTaskOutputSpecSchema,
  scheduledTaskStructuredEditSchema,
  scheduleSpecSchema,
} from "~/server/domain/scheduled-task/contracts";
import {
  hasDeliveryTarget,
  listDeliveryTargets,
} from "~/server/domain/scheduled-task/delivery-targets";
import { PrismaAgentConversationRepository } from "~/server/infrastructure/agent-runtime/prisma-agent-conversation-repository";
import { PrismaWorkflowRunRepository } from "~/server/infrastructure/workflow/prisma/workflow-run-repository";

function taskError(error: unknown): never {
  const message = error instanceof Error ? error.message : "定时任务操作失败";
  if (
    [
      "TASK_NOT_EDITABLE",
      "TASK_NOT_EXECUTABLE",
      "EDIT_DRAFT_NOT_FOUND",
    ].includes(message)
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: "定时任务不存在" });
  }
  if (message === "EDIT_VERSION_CONFLICT") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "任务版本已更新，请基于最新版本重新预览",
    });
  }
  const labels: Record<string, string> = {
    DELIVERY_TARGET_UNAVAILABLE: "飞书投递目标未配置或不可用",
    NEXT_RUN_UNAVAILABLE: "无法计算下一次执行时间",
    NO_CHANGES: "没有检测到配置变更",
    DRAFT_NOT_CONFIRMABLE: "候选修改尚未通过验证",
  };
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: labels[message] ?? message,
  });
}

export const scheduledTaskRouter = createTRPCRouter({
  validateDeterministicPlan: protectedProcedure
    .input(z.object({ plan: z.unknown() }))
    .mutation(({ input }) => {
      const parsed = deterministicExecutionPlanSchema.safeParse(input.plan);
      return parsed.success
        ? { valid: true as const, normalizedPlan: parsed.data, issues: [] }
        : {
            valid: false as const,
            normalizedPlan: null,
            issues: parsed.error.issues.map((issue) => ({
              path: issue.path.join("."),
              message: issue.message,
            })),
          };
    }),
  updateSetupDraftPlan: protectedProcedure
    .input(
      z.object({
        taskId: z.string().cuid(),
        expectedVersion: z.number().int().positive(),
        plan: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const parsed = deterministicExecutionPlanSchema.safeParse(input.plan);
      if (!parsed.success)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: parsed.error.issues
            .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
            .join("；"),
        });
      const semantic = await fetch(
        `${env.PYTHON_SERVICE_URL.replace(/\/$/, "")}/api/v1/definitive-scheduled-tasks/validate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      if (!semantic.ok) {
        const payload = (await semantic.json().catch(() => null)) as
          | { message?: string }
          | null;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: payload?.message ?? "评分规则语义校验失败",
        });
      }
      const task = await ctx.db.scheduledTask.findFirst({
        where: {
          id: input.taskId,
          userId: ctx.session.user.id,
          status: "DRAFT",
          currentVersion: input.expectedVersion,
        },
        select: { id: true },
      });
      if (!task)
        throw new TRPCError({ code: "CONFLICT", message: "草稿版本已经变化" });
      await ctx.db.scheduledTaskVersion.update({
        where: {
          taskId_version: {
            taskId: input.taskId,
            version: input.expectedVersion,
          },
        },
        data: { executionPlan: parsed.data },
      });
      return { valid: true as const, normalizedPlan: parsed.data };
    }),
  list: protectedProcedure.query(async ({ ctx }) => {
    const tasks = await ctx.db.scheduledTask.findMany({
      where: { userId: ctx.session.user.id, status: { not: "DRAFT" } },
      include: { versions: { orderBy: { version: "desc" } } },
      orderBy: { updatedAt: "desc" },
    });
    return tasks.map((task) => ({
      ...task,
      versions: task.versions.filter(
        (version) => version.version === task.currentVersion,
      ),
    }));
  }),
  getDetail: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const task = await ctx.db.scheduledTask.findFirst({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
          status: { not: "DRAFT" },
        },
        include: { versions: { orderBy: { version: "desc" } } },
      });
      const version = task?.versions.find(
        (item) => item.version === task.currentVersion,
      );
      if (!task || !version)
        throw new TRPCError({ code: "NOT_FOUND", message: "定时任务不存在" });
      const targets = listDeliveryTargets();
      const delivery = scheduledTaskDeliverySpecSchema.parse(
        version.deliverySpec,
      );
      return {
        ...task,
        versions: undefined,
        version,
        deliveryTarget:
          delivery.type === "FEISHU"
            ? (targets.find(
                (target) => target.targetRef === delivery.targetRef,
              ) ?? null)
            : null,
        availableDeliveryTargets: targets,
      };
    }),
  listExecutions: protectedProcedure
    .input(
      z.object({
        taskId: z.string().cuid(),
        limit: z.number().int().min(1).max(50).default(20),
        cursor: z.string().cuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const task = await ctx.db.scheduledTask.findFirst({
        where: { id: input.taskId, userId: ctx.session.user.id },
        select: { id: true },
      });
      if (!task)
        throw new TRPCError({ code: "NOT_FOUND", message: "定时任务不存在" });
      const rows = await ctx.db.scheduledTaskExecution.findMany({
        where: { taskId: input.taskId },
        include: {
          taskVersion: { select: { version: true } },
          deliveries: {
            select: { status: true, targetType: true, targetRef: true },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit + 1,
        ...(input.cursor
          ? { cursor: { id: input.cursor }, skip: 1 }
          : undefined),
      });
      const nextCursor =
        rows.length > input.limit ? rows[input.limit]?.id : undefined;
      return { items: rows.slice(0, input.limit), nextCursor };
    }),
  getExecution: protectedProcedure
    .input(z.object({ id: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const execution = await ctx.db.scheduledTaskExecution.findFirst({
        where: { id: input.id, task: { userId: ctx.session.user.id } },
        include: {
          taskVersion: { select: { version: true } },
          evidence: { orderBy: { createdAt: "asc" } },
          deliveries: { orderBy: { createdAt: "asc" } },
        },
      });
      if (!execution)
        throw new TRPCError({ code: "NOT_FOUND", message: "执行记录不存在" });
      return execution;
    }),
  getScoreResults: protectedProcedure
    .input(
      z.object({
        executionId: z.string().cuid(),
        limit: z.number().int().min(1).max(500).default(100),
        cursor: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const execution = await ctx.db.scheduledTaskExecution.findFirst({
        where: {
          id: input.executionId,
          task: { userId: ctx.session.user.id },
        },
        select: { id: true },
      });
      if (!execution)
        throw new TRPCError({ code: "NOT_FOUND", message: "执行记录不存在" });
      const rows = await ctx.db.scheduledTaskScoreResult.findMany({
        where: { executionId: input.executionId },
        orderBy: { rank: "asc" },
        take: input.limit + 1,
        ...(input.cursor ? { cursor: { executionId_rank: { executionId: input.executionId, rank: input.cursor } }, skip: 1 } : {}),
      });
      return {
        items: rows.slice(0, input.limit),
        nextCursor: rows.length > input.limit ? rows[input.limit]?.rank : undefined,
      };
    }),
  prepareStructuredEdit: protectedProcedure
    .input(
      z.object({
        taskId: z.string().cuid(),
        value: scheduledTaskStructuredEditSchema,
        idempotencyKey: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await new ScheduledTaskEditService(ctx.db).prepareStructured({
          userId: ctx.session.user.id,
          taskId: input.taskId,
          input: input.value,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        taskError(error);
      }
    }),
  getEditDraft: protectedProcedure
    .input(
      z
        .object({
          draftId: z.string().cuid().optional(),
          conversationId: z.string().cuid().optional(),
        })
        .refine((value) => value.draftId || value.conversationId),
    )
    .query(({ ctx, input }) =>
      ctx.db.scheduledTaskEditDraft.findFirst({
        where: {
          userId: ctx.session.user.id,
          status: "PENDING",
          ...(input.draftId ? { id: input.draftId } : {}),
          ...(input.conversationId
            ? { conversationId: input.conversationId }
            : {}),
        },
        orderBy: { updatedAt: "desc" },
      }),
    ),
  confirmEditDraft: protectedProcedure
    .input(
      z.object({
        draftId: z.string().cuid(),
        expectedRevision: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await new ScheduledTaskEditService(ctx.db).confirm({
          userId: ctx.session.user.id,
          draftId: input.draftId,
          expectedRevision: input.expectedRevision,
        });
      } catch (error) {
        taskError(error);
      }
    }),
  startAgentEdit: protectedProcedure
    .input(z.object({ taskId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.scheduledTask.findFirst({
        where: {
          id: input.taskId,
          userId: ctx.session.user.id,
          status: { in: ["ACTIVE", "PAUSED"] },
        },
        include: { versions: { orderBy: { version: "desc" } } },
      });
      const version = task?.versions.find(
        (item) => item.version === task.currentVersion,
      );
      if (!task || !version)
        throw new TRPCError({ code: "NOT_FOUND", message: "定时任务不存在" });
      const repository = new PrismaAgentConversationRepository(ctx.db);
      const service = new AgentConversationService(
        repository,
        new WorkflowCommandService(new PrismaWorkflowRunRepository(ctx.db)),
      );
      return service.sendMessage({
        userId: ctx.session.user.id,
        skillId: "scheduled-task-edit",
        skillIds: ["scheduled-task-edit"],
        prompt: `我想修改定时任务“${task.name}”。请先根据当前配置询问我具体想修改什么，生成候选修改后等待我在预览中确认。`,
        title: `修改定时任务：${task.name}`,
        routingMode: "SCHEDULED_TASK_EDIT",
        scheduledTaskEditTaskId: task.id,
        context: {
          scheduledTaskEdit: {
            taskId: task.id,
            baseVersion: task.currentVersion,
            name: task.name,
            userPrompt: version.userPrompt,
            schedule: version.scheduleSpec,
            dataSources: version.dataSources,
            executionPlan: version.executionPlan,
            output: version.outputSpec,
            delivery: version.deliverySpec,
          },
        },
      });
    }),
  trialRun: protectedProcedure
    .input(
      z.object({
        taskId: z.string().cuid(),
        deliver: z.boolean().default(false),
        idempotencyKey: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await new ScheduledTaskExecutionService(ctx.db).trialRun({
          userId: ctx.session.user.id,
          taskId: input.taskId,
          deliver: input.deliver,
          idempotencyKey: input.idempotencyKey,
        });
      } catch (error) {
        taskError(error);
      }
    }),
  getSetupDraft: protectedProcedure
    .input(z.object({ conversationId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const task = await ctx.db.scheduledTask.findFirst({
        where: {
          userId: ctx.session.user.id,
          status: "DRAFT",
          setupConversationId: input.conversationId,
        },
        orderBy: { updatedAt: "desc" },
      });
      return task
        ? new ScheduledTaskSetupService(ctx.db).preview(task.id)
        : null;
    }),
  activateDraft: protectedProcedure
    .input(
      z.object({
        taskId: z.string().cuid(),
        expectedVersion: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.scheduledTask.findFirst({
        where: {
          id: input.taskId,
          userId: ctx.session.user.id,
          status: "DRAFT",
          currentVersion: input.expectedVersion,
        },
        include: {
          versions: { where: { version: input.expectedVersion }, take: 1 },
        },
      });
      const version = task?.versions[0];
      if (!task || !version)
        throw new TRPCError({
          code: "CONFLICT",
          message: "草稿已更新，请检查最新预览",
        });
      const feasibility =
        version.feasibility &&
        typeof version.feasibility === "object" &&
        !Array.isArray(version.feasibility)
          ? (version.feasibility as Record<string, unknown>)
          : {};
      const blockers = Array.isArray(feasibility.blockingIssues)
        ? feasibility.blockingIssues
        : [];
      if (
        !["SUPPORTED", "SUPPORTED_WITH_LIMITS"].includes(
          String(feasibility.status),
        ) ||
        blockers.length
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "草稿尚未通过验证",
        });
      }
      const schedule = scheduleSpecSchema.parse(version.scheduleSpec);
      scheduledTaskOutputSpecSchema.parse(version.outputSpec);
      const delivery = scheduledTaskDeliverySpecSchema.parse(
        version.deliverySpec,
      );
      if (
        delivery.type === "FEISHU" &&
        !hasDeliveryTarget("FEISHU", delivery.targetRef)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "飞书投递目标未配置或已不可用",
        });
      const nextRunAt = await new ScheduledTaskSetupService(ctx.db).nextRunAt(
        schedule,
      );
      if (!nextRunAt)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "无法计算下一次执行时间",
        });
      return ctx.db.$transaction(async (tx) => {
        const updated = await tx.scheduledTask.updateMany({
          where: {
            id: task.id,
            userId: ctx.session.user.id,
            status: "DRAFT",
            currentVersion: input.expectedVersion,
          },
          data: { status: "ACTIVE", nextRunAt },
        });
        if (updated.count !== 1)
          throw new TRPCError({
            code: "CONFLICT",
            message: "草稿状态已经变化",
          });
        if (task.setupConversationId) {
          await tx.agentConversation.updateMany({
            where: {
              id: task.setupConversationId,
              userId: ctx.session.user.id,
              activeScheduledTaskDraftId: task.id,
            },
            data: { routingMode: "AUTO", activeScheduledTaskDraftId: null },
          });
        }
        return tx.scheduledTask.findUnique({ where: { id: task.id } });
      });
    }),
  pause: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.scheduledTask.updateMany({
        where: { id: input.id, userId: ctx.session.user.id, status: "ACTIVE" },
        data: { status: "PAUSED" },
      });
      if (!result.count) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),
  resume: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.db.scheduledTask.updateMany({
        where: { id: input.id, userId: ctx.session.user.id, status: "PAUSED" },
        data: { status: "ACTIVE" },
      });
      if (!result.count) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),
  cancel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.scheduledTask.findFirst({
        where: { id: input.id, userId: ctx.session.user.id },
        select: { id: true, status: true, setupConversationId: true },
      });
      const result = await ctx.db.scheduledTask.updateMany({
        where: {
          id: input.id,
          userId: ctx.session.user.id,
          status: { in: ["ACTIVE", "PAUSED", "DRAFT"] },
        },
        data: { status: "CANCELLED", nextRunAt: null },
      });
      if (!result.count) throw new TRPCError({ code: "NOT_FOUND" });
      if (task?.status === "DRAFT" && task.setupConversationId) {
        await ctx.db.agentConversation.updateMany({
          where: {
            id: task.setupConversationId,
            userId: ctx.session.user.id,
            activeScheduledTaskDraftId: task.id,
          },
          data: { routingMode: "AUTO", activeScheduledTaskDraftId: null },
        });
      }
      return { success: true };
    }),
});

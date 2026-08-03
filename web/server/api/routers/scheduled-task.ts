import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { env } from "~/env";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { AgentConversationService } from "~/server/application/agent-runtime/agent-conversation-service";
import { ScheduledTaskDraftController } from "~/server/application/scheduled-task/scheduled-task-draft-controller";
import { ScheduledTaskEditService } from "~/server/application/scheduled-task/scheduled-task-edit-service";
import { ScheduledTaskExecutionService } from "~/server/application/scheduled-task/scheduled-task-execution-service";
import { ScheduledTaskScoringDraftService } from "~/server/application/scheduled-task/scheduled-task-scoring-draft-service";
import { ScheduledTaskScoringLifecycleService } from "~/server/application/scheduled-task/scheduled-task-scoring-lifecycle-service";
import { ScheduledTaskSetupService } from "~/server/application/scheduled-task/scheduled-task-setup-service";
import { ScheduledTaskWebhookCredentialService } from "~/server/application/scheduled-task/scheduled-task-webhook-credential-service";
import { WorkflowCommandService } from "~/server/application/workflow/command-service";
import {
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

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
  if (["EDIT_VERSION_CONFLICT", "PREVIEW_VERSION_CONFLICT"].includes(message)) {
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
    PREVIEW_NOT_FOUND: "评分预览不存在",
    PREVIEW_REQUIRED: "首次启用前必须运行当前版本的评分预览",
    PREVIEW_NOT_EVALUABLE: "全部预览样本均无法评估，不能启用任务",
    PREVIEW_SAMPLE_REQUIRED: "全部 A 股预览必须选择 1 至 20 只样本",
    PREVIEW_SAMPLE_LIMIT: "评分预览最多选择 20 只样本",
    PREVIEW_SAMPLE_INVALID: "预览样本必须使用六位股票代码",
    PREVIEW_SAMPLE_DUPLICATED: "预览样本不能重复",
    PREVIEW_SAMPLE_OUTSIDE_UNIVERSE: "预览样本不在当前指定股票范围内",
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
      return new ScheduledTaskDraftController().validateExecutionPlan(
        input.plan,
      );
    }),
  saveScoringDraft: protectedProcedure
    .input(
      z.object({
        taskId: z.string().cuid().optional(),
        expectedVersion: z.number().int().positive().optional(),
        idempotencyKey: z.string().min(8).max(128),
        value: z.unknown(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await new ScheduledTaskScoringDraftService(ctx.db).save({
          userId: ctx.session.user.id,
          taskId: input.taskId,
          expectedVersion: input.expectedVersion,
          idempotencyKey: input.idempotencyKey,
          value: input.value,
        });
      } catch (error) {
        taskError(error);
      }
    }),
  startScoringPreview: protectedProcedure
    .input(
      z.object({
        taskId: z.string().cuid(),
        expectedVersion: z.number().int().positive(),
        sampleStockCodes: z.array(z.string()).max(20).optional(),
        idempotencyKey: z.string().min(8).max(128),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        return await new ScheduledTaskScoringLifecycleService(
          ctx.db,
        ).startPreview({
          userId: ctx.session.user.id,
          ...input,
        });
      } catch (error) {
        taskError(error);
      }
    }),
  getScoringPreview: protectedProcedure
    .input(z.object({ previewId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      try {
        return await new ScheduledTaskScoringLifecycleService(
          ctx.db,
        ).getPreview({
          userId: ctx.session.user.id,
          previewId: input.previewId,
        });
      } catch (error) {
        taskError(error);
      }
    }),
  getScoringDraft: protectedProcedure
    .input(z.object({ taskId: z.string().cuid() }))
    .query(async ({ ctx, input }) => {
      const task = await ctx.db.scheduledTask.findFirst({
        where: {
          id: input.taskId,
          userId: ctx.session.user.id,
          status: "DRAFT",
        },
      });
      if (!task)
        throw new TRPCError({ code: "NOT_FOUND", message: "评分草稿不存在" });
      const version = await ctx.db.scheduledTaskVersion.findUnique({
        where: {
          taskId_version: { taskId: task.id, version: task.currentVersion },
        },
      });
      if (!version)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "评分草稿版本不存在",
        });
      const delivery = scheduledTaskDeliverySpecSchema.parse(
        version.deliverySpec,
      );
      const deliveryCredential =
        delivery.type === "FEISHU"
          ? await new ScheduledTaskWebhookCredentialService(ctx.db).describe({
              userId: ctx.session.user.id,
              taskId: task.id,
              credentialRef: delivery.targetRef,
            })
          : null;
      return {
        taskId: task.id,
        version: task.currentVersion,
        name: task.name,
        config: version,
        deliveryCredential,
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
      const parsed = new ScheduledTaskDraftController().validateExecutionPlan(
        input.plan,
      );
      if (!parsed.valid)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: parsed.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("；"),
        });
      const semantic = await fetch(
        `${env.PYTHON_SERVICE_URL.replace(/\/$/, "")}/api/v1/definitive-scheduled-tasks/validate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(parsed.normalizedPlan),
        },
      );
      if (!semantic.ok) {
        const payload = (await semantic.json().catch(() => null)) as {
          message?: string;
        } | null;
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
        data: { executionPlan: parsed.normalizedPlan },
      });
      return { valid: true as const, normalizedPlan: parsed.normalizedPlan };
    }),
  list: protectedProcedure.query(async ({ ctx }) => {
    const tasks = await ctx.db.scheduledTask.findMany({
      where: { userId: ctx.session.user.id, status: { not: "DRAFT" } },
      include: {
        versions: { orderBy: { version: "desc" } },
        executions: {
          where: { trigger: { not: "PREVIEW" } },
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            deliveries: {
              select: { status: true, targetType: true },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
      },
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
        include: {
          versions: { orderBy: { version: "desc" } },
          executions: {
            where: { trigger: { not: "PREVIEW" } },
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              deliveries: { orderBy: { createdAt: "desc" }, take: 1 },
              scoreResults: {
                orderBy: { rank: "asc" },
                take: 20,
              },
            },
          },
        },
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
      const deterministic =
        asRecord(version.executionPlan).type === "deterministic_scoring";
      const storedCredential =
        deterministic && delivery.type === "FEISHU"
          ? await new ScheduledTaskWebhookCredentialService(ctx.db)
              .describe({
                userId: ctx.session.user.id,
                taskId: task.id,
                credentialRef: delivery.targetRef,
              })
              .catch(() => null)
          : null;
      const deliveryTarget = storedCredential
        ? {
            type: "FEISHU" as const,
            targetRef: storedCredential.credentialRef,
            name: storedCredential.maskedWebhook,
          }
        : delivery.type === "FEISHU"
          ? (targets.find(
              (target) => target.targetRef === delivery.targetRef,
            ) ?? null)
          : null;
      return {
        ...task,
        versions: undefined,
        version,
        deliveryTarget,
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
          scoreResults: { orderBy: { rank: "asc" } },
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
        ...(input.cursor
          ? {
              cursor: {
                executionId_rank: {
                  executionId: input.executionId,
                  rank: input.cursor,
                },
              },
              skip: 1,
            }
          : {}),
      });
      return {
        items: rows.slice(0, input.limit),
        nextCursor:
          rows.length > input.limit ? rows[input.limit]?.rank : undefined,
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
  discardEditDraft: protectedProcedure
    .input(z.object({ draftId: z.string().cuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await new ScheduledTaskEditService(ctx.db).discard({
          userId: ctx.session.user.id,
          draftId: input.draftId,
        });
      } catch (error) {
        taskError(error);
      }
    }),
  startAgentEdit: protectedProcedure
    .input(
      z.object({
        taskId: z.string().cuid(),
        prompt: z.string().trim().min(1).max(4000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.scheduledTask.findFirst({
        where: {
          id: input.taskId,
          userId: ctx.session.user.id,
          status: { in: ["DRAFT", "ACTIVE", "PAUSED"] },
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
        prompt:
          input.prompt ??
          `我想修改定时任务“${task.name}”。请先询问我具体想修改什么，生成候选修改后等待我在构建器中确认。`,
        title: `修改定时任务：${task.name}`,
        routingMode: "SCHEDULED_TASK_EDIT",
        scheduledTaskEditTaskId: task.id,
        context: {
          scheduledTaskEdit: {
            mode:
              asRecord(version.executionPlan).type === "deterministic_scoring"
                ? "deterministic_scoring_builder"
                : "scheduled_task",
            taskId: task.id,
            generatedAtVersion: task.currentVersion,
            name: task.name,
            schedule: version.scheduleSpec,
            executionPlan: version.executionPlan,
            output: version.outputSpec,
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
        previewId: z.string().cuid().optional(),
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
      const executionPlan =
        version.executionPlan &&
        typeof version.executionPlan === "object" &&
        !Array.isArray(version.executionPlan)
          ? (version.executionPlan as Record<string, unknown>)
          : {};
      if (executionPlan.type === "deterministic_scoring") {
        if (!input.previewId)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "首次启用前必须运行当前版本的评分预览",
          });
        try {
          const setup = new ScheduledTaskSetupService(ctx.db);
          return await new ScheduledTaskScoringLifecycleService(
            ctx.db,
          ).activate({
            userId: ctx.session.user.id,
            taskId: input.taskId,
            expectedVersion: input.expectedVersion,
            previewId: input.previewId,
            resolveNextRunAt: (schedule) => setup.nextRunAt(schedule),
          });
        } catch (error) {
          taskError(error);
        }
      }
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
      const planValidation =
        new ScheduledTaskDraftController().validateExecutionPlan(
          version.executionPlan,
        );
      if (!planValidation.valid)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: planValidation.issues
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join("；"),
        });
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
        data: { status: "PAUSED", nextRunAt: null },
      });
      if (!result.count) throw new TRPCError({ code: "NOT_FOUND" });
      return { success: true };
    }),
  resume: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const task = await ctx.db.scheduledTask.findFirst({
        where: { id: input.id, userId: ctx.session.user.id, status: "PAUSED" },
        include: { versions: { orderBy: { version: "desc" } } },
      });
      const version = task?.versions.find(
        (item) => item.version === task.currentVersion,
      );
      if (!task || !version) throw new TRPCError({ code: "NOT_FOUND" });
      const schedule = scheduleSpecSchema.parse(version.scheduleSpec);
      const nextRunAt = await new ScheduledTaskSetupService(ctx.db).nextRunAt(
        schedule,
      );
      if (!nextRunAt)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "无法计算下一次执行时间",
        });
      const result = await ctx.db.scheduledTask.updateMany({
        where: { id: input.id, userId: ctx.session.user.id, status: "PAUSED" },
        data: { status: "ACTIVE", nextRunAt },
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

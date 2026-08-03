import type { Prisma, PrismaClient } from "@prisma/client";
import { ScheduledTaskDraftController } from "~/server/application/scheduled-task/scheduled-task-draft-controller";
import { hasDeliveryTarget } from "~/server/domain/scheduled-task/delivery-targets";

export class ScheduledTaskScoringDraftService {
  private readonly controller = new ScheduledTaskDraftController();

  constructor(private readonly db: PrismaClient) {}

  async save(params: {
    userId: string;
    taskId?: string;
    expectedVersion?: number;
    idempotencyKey: string;
    value: unknown;
  }) {
    const validation = this.controller.validate(params.value);
    if (!validation.valid)
      return { saved: false as const, issues: validation.issues };
    if (
      validation.draft.delivery.type === "FEISHU" &&
      !hasDeliveryTarget("FEISHU", validation.draft.delivery.targetRef)
    )
      return {
        saved: false as const,
        issues: [
          {
            path: "delivery.targetRef",
            message: "飞书投递目标未配置或不可用",
          },
        ],
      };

    const duplicate = await this.db.scheduledTaskVersion.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
      select: {
        taskId: true,
        version: true,
        task: { select: { userId: true } },
      },
    });
    if (duplicate) {
      if (duplicate.task.userId !== params.userId)
        throw new Error("DRAFT_NOT_FOUND");
      return {
        saved: true as const,
        taskId: duplicate.taskId,
        version: duplicate.version,
      };
    }

    const { draft } = validation;
    const versionData = (version: number) => ({
      version,
      userPrompt: "",
      scheduleSpec: draft.schedule as unknown as Prisma.InputJsonObject,
      dataSources: [] as Prisma.InputJsonArray,
      executionPlan: draft.executionPlan as unknown as Prisma.InputJsonObject,
      outputSpec: draft.output as unknown as Prisma.InputJsonObject,
      deliverySpec: draft.delivery as unknown as Prisma.InputJsonObject,
      feasibility: {
        status: "SUPPORTED",
        warnings: [],
        blockingIssues: [],
      } as Prisma.InputJsonObject,
      idempotencyKey: params.idempotencyKey,
    });

    if (!params.taskId) {
      const task = await this.db.scheduledTask.create({
        data: {
          userId: params.userId,
          name: draft.name,
          status: "DRAFT",
          currentVersion: 1,
          timezone: draft.schedule.timezone,
          nextRunAt: null,
          versions: { create: versionData(1) },
        },
        select: { id: true, currentVersion: true },
      });
      return {
        saved: true as const,
        taskId: task.id,
        version: task.currentVersion,
      };
    }

    const taskId = params.taskId;
    const expectedVersion = params.expectedVersion;
    if (!taskId || !expectedVersion) throw new Error("EDIT_VERSION_CONFLICT");
    return this.db.$transaction(async (tx) => {
      const updated = await tx.scheduledTask.updateMany({
        where: {
          id: taskId,
          userId: params.userId,
          status: "DRAFT",
          currentVersion: expectedVersion,
        },
        data: {
          name: draft.name,
          timezone: draft.schedule.timezone,
          currentVersion: { increment: 1 },
          nextRunAt: null,
        },
      });
      if (updated.count !== 1) throw new Error("EDIT_VERSION_CONFLICT");
      const version = expectedVersion + 1;
      await tx.scheduledTaskVersion.create({
        data: { taskId, ...versionData(version) },
      });
      return { saved: true as const, taskId, version };
    });
  }
}

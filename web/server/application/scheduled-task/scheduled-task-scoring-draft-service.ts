import type { Prisma, PrismaClient } from "@prisma/client";
import { ScheduledTaskDraftController } from "~/server/application/scheduled-task/scheduled-task-draft-controller";
import { ScheduledTaskWebhookCredentialService } from "./scheduled-task-webhook-credential-service";

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
    const versionData = (
      version: number,
      deliverySpec:
        | { type: "SAVE_ONLY" }
        | { type: "FEISHU"; targetRef: string },
    ) => ({
      version,
      userPrompt: "",
      scheduleSpec: draft.schedule as unknown as Prisma.InputJsonObject,
      dataSources: [] as Prisma.InputJsonArray,
      executionPlan: draft.executionPlan as unknown as Prisma.InputJsonObject,
      outputSpec: draft.output as unknown as Prisma.InputJsonObject,
      deliverySpec: deliverySpec as unknown as Prisma.InputJsonObject,
      feasibility: {
        status: "SUPPORTED",
        warnings: [],
        blockingIssues: [],
      } as Prisma.InputJsonObject,
      idempotencyKey: params.idempotencyKey,
    });

    if (!params.taskId) {
      if (draft.delivery.type === "FEISHU") {
        const webhookUrl = draft.delivery.webhookUrl;
        if (!webhookUrl)
          return {
            saved: false as const,
            issues: [
              {
                path: "delivery.webhookUrl",
                message: "请输入飞书官方 Webhook",
              },
            ],
          };
        try {
          return await this.db.$transaction(async (tx) => {
            const task = await tx.scheduledTask.create({
              data: {
                userId: params.userId,
                name: draft.name,
                status: "DRAFT",
                currentVersion: 1,
                timezone: draft.schedule.timezone,
                nextRunAt: null,
              },
              select: { id: true, currentVersion: true },
            });
            const credential = await new ScheduledTaskWebhookCredentialService(
              tx as never,
            ).register({
              userId: params.userId,
              taskId: task.id,
              webhookUrl,
            });
            await tx.scheduledTaskVersion.create({
              data: {
                taskId: task.id,
                ...versionData(1, {
                  type: "FEISHU",
                  targetRef: credential.credentialRef,
                }),
              },
            });
            return {
              saved: true as const,
              taskId: task.id,
              version: task.currentVersion,
              delivery: { type: "FEISHU" as const, ...credential },
            };
          });
        } catch (error) {
          if (
            error instanceof Error &&
            error.message === "FEISHU_WEBHOOK_INVALID"
          )
            return {
              saved: false as const,
              issues: [
                {
                  path: "delivery.webhookUrl",
                  message: "仅支持飞书官方 HTTPS Webhook",
                },
              ],
            };
          throw error;
        }
      }
      const task = await this.db.scheduledTask.create({
        data: {
          userId: params.userId,
          name: draft.name,
          status: "DRAFT",
          currentVersion: 1,
          timezone: draft.schedule.timezone,
          nextRunAt: null,
          versions: { create: versionData(1, { type: "SAVE_ONLY" }) },
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
    try {
      return await this.db.$transaction(async (tx) => {
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
        let delivery:
          | { type: "SAVE_ONLY" }
          | {
              type: "FEISHU";
              credentialRef: string;
              maskedWebhook: string;
            } = { type: "SAVE_ONLY" };
        if (draft.delivery.type === "FEISHU") {
          const credentials = new ScheduledTaskWebhookCredentialService(
            tx as never,
          );
          try {
            delivery = draft.delivery.webhookUrl
              ? {
                  type: "FEISHU",
                  ...(await credentials.register({
                    userId: params.userId,
                    taskId,
                    webhookUrl: draft.delivery.webhookUrl,
                  })),
                }
              : {
                  type: "FEISHU",
                  ...(await credentials.describe({
                    userId: params.userId,
                    taskId,
                    credentialRef: draft.delivery.targetRef as string,
                  })),
                };
          } catch (error) {
            if (
              error instanceof Error &&
              [
                "FEISHU_WEBHOOK_INVALID",
                "FEISHU_CREDENTIAL_NOT_FOUND",
              ].includes(error.message)
            )
              throw new Error("SCORING_DELIVERY_INVALID");
            throw error;
          }
        }
        await tx.scheduledTaskVersion.create({
          data: {
            taskId,
            ...versionData(
              version,
              delivery.type === "FEISHU"
                ? { type: "FEISHU", targetRef: delivery.credentialRef }
                : { type: "SAVE_ONLY" },
            ),
          },
        });
        return {
          saved: true as const,
          taskId,
          version,
          ...(delivery.type === "FEISHU" ? { delivery } : {}),
        };
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "SCORING_DELIVERY_INVALID"
      )
        return {
          saved: false as const,
          issues: [
            {
              path: "delivery.webhookUrl",
              message: "飞书 Webhook 无效或已不可用",
            },
          ],
        };
      throw error;
    }
  }
}

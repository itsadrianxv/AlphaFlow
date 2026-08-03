import type { PrismaClient } from "@prisma/client";
import {
  decryptFeishuWebhook,
  encryptFeishuWebhook,
  maskFeishuWebhook,
} from "~/server/domain/scheduled-task/feishu-webhook-credential";

function defaultSecret() {
  const configured =
    process.env.SCHEDULED_TASK_CREDENTIAL_KEY ?? process.env.AUTH_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production")
    throw new Error("FEISHU_CREDENTIAL_KEY_MISSING");
  return "alphaflow-local-development-credential-key";
}

export class ScheduledTaskWebhookCredentialService {
  constructor(
    private readonly db: PrismaClient,
    private readonly secret = defaultSecret(),
  ) {}

  async register(params: {
    userId: string;
    taskId: string;
    webhookUrl: string;
  }) {
    const maskedWebhook = maskFeishuWebhook(params.webhookUrl);
    const credential = await this.db.scheduledTaskDeliveryCredential.create({
      data: {
        userId: params.userId,
        taskId: params.taskId,
        channel: "FEISHU",
        encryptedValue: encryptFeishuWebhook(params.webhookUrl, this.secret),
        maskedValue: maskedWebhook,
      },
    });
    return { credentialRef: credential.id, maskedWebhook };
  }

  async describe(params: {
    userId: string;
    taskId: string;
    credentialRef: string;
  }) {
    const credential = await this.db.scheduledTaskDeliveryCredential.findFirst({
      where: {
        id: params.credentialRef,
        userId: params.userId,
        taskId: params.taskId,
        channel: "FEISHU",
      },
      select: { id: true, maskedValue: true },
    });
    if (!credential) throw new Error("FEISHU_CREDENTIAL_NOT_FOUND");
    return {
      credentialRef: credential.id,
      maskedWebhook: credential.maskedValue,
    };
  }

  async resolveForDelivery(credentialRef: string) {
    const credential = await this.db.scheduledTaskDeliveryCredential.findFirst({
      where: { id: credentialRef, channel: "FEISHU" },
      select: { encryptedValue: true },
    });
    if (!credential) throw new Error("FEISHU_CREDENTIAL_NOT_FOUND");
    return decryptFeishuWebhook(credential.encryptedValue, this.secret);
  }
}

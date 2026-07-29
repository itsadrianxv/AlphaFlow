import type { ScheduledTaskDeliverySpec } from "../server/domain/scheduled-task/contracts";
import { resolveFeishuWebhook } from "../server/domain/scheduled-task/delivery-targets";

type FeishuDeliverySpec = Extract<
  ScheduledTaskDeliverySpec,
  { type: "FEISHU" }
>;

export class DeliveryAttemptError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "DeliveryAttemptError";
  }
}

function configurationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.split(":", 1)[0] || "FEISHU_CONFIGURATION_ERROR";
  return new DeliveryAttemptError(code, message, false);
}

export async function deliverScheduledTask(
  spec: FeishuDeliverySpec,
  result: { title?: string; summary?: string; body?: string },
) {
  let webhook: string;
  try {
    webhook = resolveFeishuWebhook(spec.targetRef);
  } catch (error) {
    throw configurationError(error);
  }

  let response: Response;
  try {
    response = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        msg_type: "post",
        content: {
          post: {
            zh_cn: {
              title: result.title ?? "定时任务",
              content: [
                [{ tag: "text", text: result.body ?? result.summary ?? "" }],
              ],
            },
          },
        },
      }),
    });
  } catch (error) {
    throw new DeliveryAttemptError(
      "FEISHU_NETWORK_ERROR",
      error instanceof Error ? error.message : String(error),
      true,
    );
  }

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new DeliveryAttemptError(
      `FEISHU_HTTP_${response.status}`,
      `飞书 Webhook HTTP ${response.status}`,
      retryable,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DeliveryAttemptError(
      "FEISHU_INVALID_RESPONSE",
      "飞书 Webhook 返回了无法解析的响应",
      false,
    );
  }
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  if (record.code !== 0) {
    throw new DeliveryAttemptError(
      `FEISHU_BUSINESS_${String(record.code ?? "UNKNOWN")}`,
      typeof record.msg === "string" ? record.msg : "飞书 Webhook 业务响应失败",
      false,
    );
  }
  return {
    outcome: "SENT" as const,
    providerMessageId:
      typeof record.data === "object" &&
      record.data &&
      "message_id" in record.data
        ? String((record.data as Record<string, unknown>).message_id)
        : undefined,
  };
}

import {
  FeishuDeliveryError,
  type FeishuDeliveryPayload,
  type FeishuDeliveryPort,
} from "~/server/application/research-distribution/research-distribution-service";
import { resolveFeishuWebhook } from "~/server/domain/scheduled-task/delivery-targets";

export class FeishuWebhookDeliveryAdapter implements FeishuDeliveryPort {
  constructor(
    private readonly targetRef: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async send(payload: FeishuDeliveryPayload): Promise<void> {
    let webhookUrl: string;
    try {
      webhookUrl = resolveFeishuWebhook(this.targetRef);
    } catch (error) {
      throw new FeishuDeliveryError(
        error instanceof Error
          ? (error.message.split(":")[0] ??
              "FEISHU_TARGET_CONFIGURATION_INVALID")
          : "FEISHU_TARGET_CONFIGURATION_INVALID",
        false,
      );
    }
    let response: Response;
    try {
      response = await this.fetcher(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          msg_type: "text",
          content: {
            text: [
              payload.title,
              `状态：${payload.status}`,
              `理由：${payload.reason}`,
              `站内：${payload.inboxLink}`,
            ].join("\n"),
          },
        }),
      });
    } catch (error) {
      if (error instanceof FeishuDeliveryError) throw error;
      throw new FeishuDeliveryError(
        "FEISHU_NETWORK_ERROR",
        true,
        undefined,
        "TIMEOUT",
      );
    }

    if (!response.ok) {
      throw new FeishuDeliveryError(
        `FEISHU_HTTP_${response.status}`,
        response.status === 408 ||
          response.status === 429 ||
          response.status >= 500,
        response.status === 429
          ? retryAfterMs(response.headers.get("retry-after"))
          : undefined,
        response.status === 429
          ? "RATE_LIMITED"
          : response.status === 408
            ? "TIMEOUT"
            : response.status >= 500
              ? "FAILURE"
              : undefined,
      );
    }
    const result = (await response.json().catch(() => null)) as {
      code?: unknown;
    } | null;
    if (result?.code !== 0) {
      throw new FeishuDeliveryError(
        `FEISHU_BUSINESS_${String(result?.code ?? "INVALID_RESPONSE")}`,
        true,
        undefined,
        "FAILURE",
      );
    }
  }
}

function retryAfterMs(value: string | null) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp)
    ? undefined
    : Math.max(0, timestamp - Date.now());
}

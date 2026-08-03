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
    let response: Response;
    try {
      response = await this.fetcher(resolveFeishuWebhook(this.targetRef), {
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
      throw new FeishuDeliveryError("FEISHU_NETWORK_ERROR", true);
    }

    if (!response.ok) {
      throw new FeishuDeliveryError(
        `FEISHU_HTTP_${response.status}`,
        response.status === 429 || response.status >= 500,
        response.status === 429
          ? retryAfterMs(response.headers.get("retry-after"))
          : undefined,
      );
    }
    const result = (await response.json().catch(() => null)) as {
      code?: unknown;
    } | null;
    if (result?.code !== 0) {
      throw new FeishuDeliveryError(
        `FEISHU_BUSINESS_${String(result?.code ?? "INVALID_RESPONSE")}`,
        false,
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

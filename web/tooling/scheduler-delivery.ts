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

export function buildScoringDeliveryMessage(params: {
  taskName: string;
  taskId: string;
  executionId: string;
  baseUrl: string;
  asOfDate: string;
  evaluatedCount: number;
  universeCount: number;
  selectedCount: number;
  summaryLimit: number;
  rows: Array<{
    stockCode: string;
    stockName: string;
    rank: number;
    score: number;
  }>;
}) {
  const rows = params.rows.slice(0, params.summaryLimit);
  const baseUrl = params.baseUrl.replace(/\/$/, "");
  return {
    title: `${params.taskName}评分完成`,
    summary: `入选 ${params.selectedCount} 只股票`,
    body: [
      `数据截止：${params.asOfDate}`,
      `评估 ${params.evaluatedCount} / ${params.universeCount} 只股票，入选 ${params.selectedCount} 只。`,
      ...rows.map(
        (row) =>
          `${row.rank}. ${row.stockName}（${row.stockCode}） ${row.score} 分`,
      ),
      `站内结果：${baseUrl}/scheduled-tasks/${params.taskId}?executionId=${params.executionId}`,
      `Excel：${baseUrl}/api/scheduled-tasks/executions/${params.executionId}/export`,
    ].join("\n"),
  };
}

function configurationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.split(":", 1)[0] || "FEISHU_CONFIGURATION_ERROR";
  return new DeliveryAttemptError(code, message, false);
}

export async function deliverScheduledTask(
  spec: FeishuDeliverySpec,
  result: { title?: string; summary?: string; body?: string },
  options: {
    resolveWebhook?: (targetRef: string) => Promise<string> | string;
  } = {},
) {
  let webhook: string;
  try {
    webhook = await (options.resolveWebhook ?? resolveFeishuWebhook)(
      spec.targetRef,
    );
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
  } catch {
    throw new DeliveryAttemptError(
      "FEISHU_NETWORK_ERROR",
      "飞书 Webhook 网络请求失败",
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

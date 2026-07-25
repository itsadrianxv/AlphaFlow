import "server-only";

import { ZodError } from "zod";
import {
  type MarketHeatmapSnapshot,
  marketHeatmapSnapshotSchema,
} from "~/contracts/market-heatmap";
import { env } from "~/env";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";

type GatewayPayload = {
  data?: unknown;
  error?: { message?: string };
  detail?: Array<{ msg?: string }>;
};

const getGatewayErrorMessage = (payload: GatewayPayload) =>
  payload.error?.message ?? payload.detail?.[0]?.msg ?? "未知错误";

export class PythonMarketHeatmapClient {
  async getSnapshot(): Promise<MarketHeatmapSnapshot> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      env.PYTHON_SERVICE_TIMEOUT_MS,
    );

    try {
      const response = await fetch(
        `${env.PYTHON_SERVICE_URL.replace(/\/$/, "")}/api/v1/market/heatmap?conceptLimit=15`,
        {
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
        },
      );
      const payload = (await response
        .json()
        .catch(() => ({}))) as GatewayPayload;
      if (!response.ok) {
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
          `热力图数据服务异常(${response.status}): ${getGatewayErrorMessage(payload)}`,
        );
      }
      return marketHeatmapSnapshotSchema.parse(payload.data);
    } catch (error) {
      if (error instanceof WorkflowDomainError) {
        throw error;
      }
      const message =
        (error as Error).name === "AbortError"
          ? `热力图数据请求超时（${env.PYTHON_SERVICE_TIMEOUT_MS}ms）`
          : error instanceof ZodError
            ? error.issues.map((issue) => issue.message).join("; ")
            : (error as Error).message;
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
        `热力图数据请求失败: ${message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

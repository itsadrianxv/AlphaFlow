import { marketContextSnapshotSchema } from "~/contracts/market-context";
import { env } from "~/env";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";

type GatewayErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

function resolveMarketContextServiceBasePath(rawBaseUrl: string) {
  const normalizedBaseUrl = rawBaseUrl.replace(/\/$/, "");

  if (normalizedBaseUrl.endsWith("/api/v1/market-context")) {
    const baseUrl = normalizedBaseUrl.replace(/\/market-context$/, "");
    return {
      baseUrl,
      marketContextBasePath: "/market-context",
    };
  }

  if (normalizedBaseUrl.endsWith("/api/v1")) {
    return {
      baseUrl: normalizedBaseUrl,
      marketContextBasePath: "/market-context",
    };
  }

  if (normalizedBaseUrl.endsWith("/api")) {
    return {
      baseUrl: normalizedBaseUrl,
      marketContextBasePath: "/v1/market-context",
    };
  }

  return {
    baseUrl: normalizedBaseUrl,
    marketContextBasePath: "/api/v1/market-context",
  };
}

export type PythonMarketContextClientConfig = {
  baseUrl?: string;
  timeoutMs?: number;
};

export class PythonMarketContextClient {
  private readonly baseUrl: string;
  private readonly marketContextBasePath: string;
  private readonly timeoutMs: number;

  constructor(config?: PythonMarketContextClientConfig) {
    const resolvedBaseUrl = resolveMarketContextServiceBasePath(
      config?.baseUrl ?? env.PYTHON_INTELLIGENCE_SERVICE_URL,
    );

    this.baseUrl = resolvedBaseUrl.baseUrl;
    this.marketContextBasePath = resolvedBaseUrl.marketContextBasePath;
    this.timeoutMs =
      config?.timeoutMs ?? env.PYTHON_INTELLIGENCE_SERVICE_TIMEOUT_MS;
  }

  async getSnapshot() {
    return this.request("/snapshot");
  }

  private async request(path: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(
        `${this.baseUrl}${this.marketContextBasePath}${path}`,
        {
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        let errorMessage = errorText;

        try {
          const payload = JSON.parse(errorText) as GatewayErrorResponse;
          errorMessage = payload.error?.message ?? errorText;
        } catch {
          errorMessage = errorText;
        }

        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
          `Market context service error(${response.status}): ${errorMessage}`,
        );
      }

      const payload = (await response.json()) as { data?: unknown };
      return marketContextSnapshotSchema.parse(payload.data);
    } catch (error) {
      if (error instanceof WorkflowDomainError) {
        throw error;
      }

      if ((error as Error).name === "AbortError") {
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
          `Market context request timed out (${this.timeoutMs}ms)`,
        );
      }

      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
        `Market context request failed: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

import { env } from "~/env";
import type {
  ConfidenceAnalysis,
  ConfidenceCheckRequest,
} from "~/server/domain/intelligence/confidence";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";

export type PythonConfidenceAnalysisClientConfig = {
  baseUrl?: string;
  timeoutMs?: number;
};

type ConfidenceBatchResponse = {
  items: ConfidenceAnalysis[];
};

export class PythonConfidenceAnalysisClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config?: PythonConfidenceAnalysisClientConfig) {
    this.baseUrl = (
      config?.baseUrl ?? env.PYTHON_INTELLIGENCE_SERVICE_URL
    ).replace(/\/$/, "");
    this.timeoutMs = config?.timeoutMs ?? 20_000;
  }

  async check(request: ConfidenceCheckRequest): Promise<ConfidenceAnalysis> {
    return this.request<ConfidenceAnalysis>(
      "/api/intelligence/confidence/check",
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );
  }

  async checkBatch(
    requests: ConfidenceCheckRequest[],
  ): Promise<ConfidenceAnalysis[]> {
    if (requests.length === 0) {
      return [];
    }

    const response = await this.request<ConfidenceBatchResponse>(
      "/api/intelligence/confidence/check-batch",
      {
        method: "POST",
        body: JSON.stringify({ items: requests }),
      },
    );

    return response.items ?? [];
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...init.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
          `Confidence analysis request failed (${response.status}): ${errorText}`,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof WorkflowDomainError) {
        throw error;
      }

      if ((error as Error).name === "AbortError") {
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
          `Confidence analysis request timed out (${this.timeoutMs}ms)`,
        );
      }

      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
        `Confidence analysis request failed: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

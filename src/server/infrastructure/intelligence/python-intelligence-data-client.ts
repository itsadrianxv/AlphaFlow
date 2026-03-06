import { env } from "~/env";
import type {
  CompanyEvidence,
  CompanyEvidenceBatchRequest,
  ThemeNewsItem,
} from "~/server/domain/intelligence/types";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";

export type PythonIntelligenceDataClientConfig = {
  baseUrl?: string;
  timeoutMs?: number;
};

export class PythonIntelligenceDataClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config?: PythonIntelligenceDataClientConfig) {
    this.baseUrl = (config?.baseUrl ?? env.PYTHON_INTELLIGENCE_SERVICE_URL).replace(
      /\/$/,
      "",
    );
    this.timeoutMs = config?.timeoutMs ?? 10_000;
  }

  async getThemeNews(params: {
    theme: string;
    days?: number;
    limit?: number;
  }): Promise<ThemeNewsItem[]> {
    const search = new URLSearchParams({
      theme: params.theme,
      days: String(params.days ?? 7),
      limit: String(params.limit ?? 20),
    });

    return this.request<ThemeNewsItem[]>(`/api/intelligence/news?${search.toString()}`);
  }

  async getEvidence(stockCode: string, concept?: string): Promise<CompanyEvidence> {
    const search = new URLSearchParams();
    if (concept) {
      search.set("concept", concept);
    }

    const query = search.toString();
    return this.request<CompanyEvidence>(
      `/api/intelligence/evidence/${stockCode}${query ? `?${query}` : ""}`,
    );
  }

  async getEvidenceBatch(
    request: CompanyEvidenceBatchRequest,
  ): Promise<CompanyEvidence[]> {
    return this.request<CompanyEvidence[]>("/api/intelligence/evidence/batch", {
      method: "POST",
      body: JSON.stringify(request),
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...init?.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "未知错误");
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
          `Intelligence 数据服务异常(${response.status}): ${errorText}`,
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
          `Intelligence 数据服务请求超时 (${this.timeoutMs}ms)`,
        );
      }

      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
        `Intelligence 数据服务请求失败: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

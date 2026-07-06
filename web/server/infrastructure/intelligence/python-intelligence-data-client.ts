import { env } from "~/env";
import type {
  CompanyEvidence,
  CompanyEvidenceBatchRequest,
  CompanyResearchPack,
  ThemeNewsItem,
} from "~/server/domain/intelligence/types";
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

type ThemeNewsGatewayData = {
  theme: string;
  newsItems: ThemeNewsItem[];
};

type ThemeCandidatesGatewayData = {
  theme: string;
  candidates: IntelligenceCandidateItem[];
};

type StockEvidenceGatewayData = {
  stockCode: string;
  concept: string;
  evidence: CompanyEvidence;
};

type StockEvidenceBatchGatewayData = {
  items: CompanyEvidence[];
};

type StockResearchPackGatewayData = {
  stockCode: string;
  concept: string;
  researchPack: CompanyResearchPack;
};

export type IntelligenceCandidateItem = {
  stockCode: string;
  stockName: string;
  reason: string;
  heat: number;
  concept: string;
};

export type PythonIntelligenceDataClientConfig = {
  baseUrl?: string;
  timeoutMs?: number;
};

function resolveIntelligenceServiceBasePath(rawBaseUrl: string) {
  const normalizedBaseUrl = rawBaseUrl.replace(/\/$/, "");

  if (normalizedBaseUrl.endsWith("/api/v1/intelligence")) {
    const baseUrl = normalizedBaseUrl.replace(/\/intelligence$/, "");
    return {
      baseUrl,
      intelligenceBasePath: "/intelligence",
      marketBasePath: "/market",
    };
  }

  if (normalizedBaseUrl.endsWith("/api/v1")) {
    return {
      baseUrl: normalizedBaseUrl,
      intelligenceBasePath: "/intelligence",
      marketBasePath: "/market",
    };
  }

  if (normalizedBaseUrl.endsWith("/api")) {
    return {
      baseUrl: normalizedBaseUrl,
      intelligenceBasePath: "/v1/intelligence",
      marketBasePath: "/v1/market",
    };
  }

  return {
    baseUrl: normalizedBaseUrl,
    intelligenceBasePath: "/api/v1/intelligence",
    marketBasePath: "/api/v1/market",
  };
}

export class PythonIntelligenceDataClient {
  private readonly baseUrl: string;
  private readonly intelligenceBasePath: string;
  private readonly marketBasePath: string;
  private readonly timeoutMs: number;

  constructor(config?: PythonIntelligenceDataClientConfig) {
    const resolvedBaseUrl = resolveIntelligenceServiceBasePath(
      config?.baseUrl ?? env.PYTHON_INTELLIGENCE_SERVICE_URL,
    );

    this.baseUrl = resolvedBaseUrl.baseUrl;
    this.intelligenceBasePath = resolvedBaseUrl.intelligenceBasePath;
    this.marketBasePath = resolvedBaseUrl.marketBasePath;
    this.timeoutMs =
      config?.timeoutMs ?? env.PYTHON_INTELLIGENCE_SERVICE_TIMEOUT_MS;
  }

  private intelligencePath(path: string) {
    return `${this.intelligenceBasePath}${path}`;
  }

  private marketPath(path: string) {
    return `${this.marketBasePath}${path}`;
  }

  async getThemeNews(params: {
    theme: string;
    days?: number;
    limit?: number;
  }): Promise<ThemeNewsItem[]> {
    const search = new URLSearchParams({
      days: String(params.days ?? 7),
      limit: String(params.limit ?? 20),
    });

    const payload = await this.request<ThemeNewsGatewayData>(
      this.intelligencePath(
        `/themes/${encodeURIComponent(params.theme)}/news?${search.toString()}`,
      ),
    );

    return payload.newsItems;
  }

  async getCandidates(params: {
    theme: string;
    limit?: number;
  }): Promise<IntelligenceCandidateItem[]> {
    const search = new URLSearchParams({
      limit: String(params.limit ?? 6),
    });

    const payload = await this.request<ThemeCandidatesGatewayData>(
      this.marketPath(
        `/themes/${encodeURIComponent(params.theme)}/candidates?${search.toString()}`,
      ),
    );

    return payload.candidates;
  }

  async getEvidence(
    stockCode: string,
    concept?: string,
  ): Promise<CompanyEvidence> {
    const search = new URLSearchParams();
    if (concept) {
      search.set("concept", concept);
    }

    const query = search.toString();
    const payload = await this.request<StockEvidenceGatewayData>(
      this.intelligencePath(
        `/stocks/${stockCode}/evidence${query ? `?${query}` : ""}`,
      ),
    );

    return payload.evidence;
  }

  async getEvidenceBatch(
    request: CompanyEvidenceBatchRequest,
  ): Promise<CompanyEvidence[]> {
    const payload = await this.request<StockEvidenceBatchGatewayData>(
      this.intelligencePath("/stocks/evidence/batch"),
      {
        method: "POST",
        body: JSON.stringify(request),
      },
    );

    return payload.items ?? [];
  }

  async getCompanyResearchPack(params: {
    stockCode: string;
    concept?: string;
  }): Promise<CompanyResearchPack> {
    const search = new URLSearchParams();
    if (params.concept) {
      search.set("concept", params.concept);
    }

    const query = search.toString();
    const payload = await this.request<StockResearchPackGatewayData>(
      this.intelligencePath(
        `/stocks/${params.stockCode}/research-pack${query ? `?${query}` : ""}`,
      ),
    );

    return payload.researchPack;
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
        let errorMessage = errorText;

        try {
          const payload = JSON.parse(errorText) as GatewayErrorResponse;
          errorMessage = payload.error?.message ?? errorText;
        } catch {
          errorMessage = errorText;
        }

        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
          `Intelligence 数据服务异常(${response.status}): ${errorMessage}`,
        );
      }

      const payload = (await response.json()) as T | { data?: T };
      if (
        payload &&
        typeof payload === "object" &&
        !Array.isArray(payload) &&
        "data" in payload
      ) {
        return payload.data as T;
      }

      return payload as T;
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

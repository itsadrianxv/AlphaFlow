import { env } from "~/env";
import {
  WORKFLOW_ERROR_CODES,
  WorkflowDomainError,
} from "~/server/domain/workflow/errors";

export type FirecrawlClientConfig = {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
};

export type FirecrawlSearchResult = {
  title: string;
  url: string;
  description?: string;
  markdown?: string;
};

export type FirecrawlScrapeDocument = {
  title: string;
  url: string;
  markdown?: string;
  description?: string;
};

type FirecrawlSearchResponse = {
  success?: boolean;
  data?: Array<{
    title?: string;
    url?: string;
    description?: string;
    markdown?: string;
  }>;
};

type FirecrawlScrapeResponse = {
  success?: boolean;
  data?: {
    markdown?: string;
    metadata?: {
      title?: string;
      description?: string;
      sourceURL?: string;
    };
  };
};

export class FirecrawlClient {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config?: FirecrawlClientConfig) {
    this.apiKey = config?.apiKey ?? env.FIRECRAWL_API_KEY;
    this.baseUrl = (config?.baseUrl ?? env.FIRECRAWL_BASE_URL).replace(
      /\/$/,
      "",
    );
    this.timeoutMs = config?.timeoutMs ?? env.FIRECRAWL_TIMEOUT_MS;
  }

  isConfigured() {
    return Boolean(this.apiKey);
  }

  async search(params: {
    query: string;
    limit?: number;
  }): Promise<FirecrawlSearchResult[]> {
    this.ensureConfigured();

    const response = await this.request<FirecrawlSearchResponse>("/v2/search", {
      method: "POST",
      body: JSON.stringify({
        query: params.query,
        limit: params.limit ?? 5,
        scrapeOptions: {
          formats: ["markdown"],
        },
      }),
    });

    return (response.data ?? [])
      .map((item) => ({
        title: item.title ?? item.url ?? "Untitled source",
        url: item.url ?? "",
        description: item.description,
        markdown: item.markdown,
      }))
      .filter((item) => item.url.length > 0);
  }

  async scrapeUrl(url: string): Promise<FirecrawlScrapeDocument | null> {
    this.ensureConfigured();

    const response = await this.request<FirecrawlScrapeResponse>("/v2/scrape", {
      method: "POST",
      body: JSON.stringify({
        url,
        formats: ["markdown"],
      }),
    });

    if (!response.data) {
      return null;
    }

    return {
      title: response.data.metadata?.title ?? url,
      url: response.data.metadata?.sourceURL ?? url,
      markdown: response.data.markdown,
      description: response.data.metadata?.description,
    };
  }

  private ensureConfigured() {
    if (!this.apiKey) {
      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
        "Firecrawl API Key 未配置",
      );
    }
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
          Authorization: `Bearer ${this.apiKey}`,
          ...init.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "未知错误");
        throw new WorkflowDomainError(
          WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
          `Firecrawl 请求失败(${response.status}): ${errorText}`,
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
          `Firecrawl 请求超时 (${this.timeoutMs}ms)`,
        );
      }

      throw new WorkflowDomainError(
        WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
        `Firecrawl 请求异常: ${(error as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

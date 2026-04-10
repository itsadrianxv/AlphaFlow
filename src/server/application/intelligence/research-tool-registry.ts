import type {
  CompanyEvidence,
  CompanyResearchPack,
  ThemeNewsItem,
} from "~/server/domain/intelligence/types";
import type { ResearchRuntimeConfig } from "~/server/domain/workflow/research";
import type { PythonCapabilityGatewayClient } from "~/server/infrastructure/capabilities/python-capability-gateway-client";
import type {
  DeepSeekClient,
  DeepSeekRequestOptions,
} from "~/server/infrastructure/intelligence/deepseek-client";
import type {
  FirecrawlScrapeDocument,
  FirecrawlSearchResult,
} from "~/server/infrastructure/intelligence/firecrawl-client";
import type {
  IntelligenceCandidateItem,
  PythonIntelligenceDataClient,
} from "~/server/infrastructure/intelligence/python-intelligence-data-client";

export type ResearchWebDocument = {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  sourceName: string;
  publishedAt?: string;
};

type ResearchToolRegistryDependencies = {
  deepSeekClient: DeepSeekClient;
  pythonCapabilityGatewayClient: PythonCapabilityGatewayClient;
  pythonIntelligenceDataClient: PythonIntelligenceDataClient;
};

function canonicalizeUrl(url?: string) {
  if (!url) {
    return undefined;
  }

  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.hostname.replace(/^www\./i, "").toLowerCase()}${parsed.pathname}`;
  } catch {
    return undefined;
  }
}

function summarizeInlineContent(content: string, maxLength: number) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}...`;
}

export class ResearchToolRegistry {
  private readonly deepSeekClient: DeepSeekClient;
  private readonly firecrawlClient: PythonCapabilityGatewayClient;
  private readonly pythonIntelligenceDataClient: PythonIntelligenceDataClient;

  constructor(dependencies: ResearchToolRegistryDependencies) {
    this.deepSeekClient = dependencies.deepSeekClient;
    this.firecrawlClient = dependencies.pythonCapabilityGatewayClient;
    this.pythonIntelligenceDataClient =
      dependencies.pythonIntelligenceDataClient;
  }

  private async summarizeWebContent(
    content: string,
    runtimeConfig: ResearchRuntimeConfig,
  ) {
    const trimmed = summarizeInlineContent(
      content,
      runtimeConfig.maxContentCharsPerSource,
    );

    if (
      trimmed.length < Math.min(900, runtimeConfig.maxContentCharsPerSource)
    ) {
      return trimmed;
    }

    const options: DeepSeekRequestOptions = {
      model: runtimeConfig.models.compression,
      maxOutputTokens: 600,
      budgetPolicy: {
        maxRetries: 1,
        truncateStrategy: ["trim_messages"],
        prioritySections: ["webpage", "summary"],
      },
    };

    return this.deepSeekClient
      .complete(
        [
          {
            role: "system",
            content:
              "Summarize the webpage content into a short investor-facing evidence note. Keep concrete facts, remove filler.",
          },
          {
            role: "user",
            content: trimmed,
          },
        ],
        trimmed,
        options,
      )
      .catch(() => trimmed);
  }

  async searchWeb(params: {
    queries: string[];
    runtimeConfig: ResearchRuntimeConfig;
    limit?: number;
  }): Promise<ResearchWebDocument[]> {
    if (
      params.runtimeConfig.toolProviders.webSearch !== "firecrawl" ||
      !this.firecrawlClient.isConfigured()
    ) {
      return [];
    }

    const results = await Promise.all(
      params.queries.map((query) =>
        this.firecrawlClient.search({
          query,
          limit: params.limit ?? 5,
        }),
      ),
    );

    const deduped = new Map<string, FirecrawlSearchResult>();
    for (const batch of results) {
      for (const item of batch) {
        const canonicalUrl = canonicalizeUrl(item.url) ?? item.url;
        if (!deduped.has(canonicalUrl)) {
          deduped.set(canonicalUrl, item);
        }
      }
    }

    const documents = await Promise.all(
      [...deduped.values()]
        .slice(0, params.runtimeConfig.maxEvidencePerUnit)
        .map(async (item) => {
          const rawContent = item.markdown ?? item.description ?? "";
          const summary = await this.summarizeWebContent(
            rawContent,
            params.runtimeConfig,
          );
          return {
            title: item.title,
            url: item.url,
            snippet: summarizeInlineContent(
              item.description ?? rawContent,
              Math.min(360, params.runtimeConfig.maxContentCharsPerSource),
            ),
            summary,
            sourceName: new URL(item.url).hostname.replace(/^www\./i, ""),
          } satisfies ResearchWebDocument;
        }),
    );

    return documents;
  }

  async fetchPage(params: {
    url: string;
    runtimeConfig: ResearchRuntimeConfig;
  }): Promise<ResearchWebDocument | null> {
    if (
      params.runtimeConfig.toolProviders.pageFetch !== "firecrawl" ||
      !this.firecrawlClient.isConfigured()
    ) {
      return null;
    }

    const document = await this.firecrawlClient.scrapeUrl(params.url);
    if (!document) {
      return null;
    }

    return this.mapScrapeDocument(document, params.runtimeConfig);
  }

  private async mapScrapeDocument(
    document: FirecrawlScrapeDocument,
    runtimeConfig: ResearchRuntimeConfig,
  ) {
    const rawContent = document.markdown ?? document.description ?? "";
    const summary = await this.summarizeWebContent(rawContent, runtimeConfig);
    return {
      title: document.title,
      url: document.url,
      snippet: summarizeInlineContent(
        document.description ?? rawContent,
        Math.min(360, runtimeConfig.maxContentCharsPerSource),
      ),
      summary,
      sourceName: new URL(document.url).hostname.replace(/^www\./i, ""),
    } satisfies ResearchWebDocument;
  }

  async getFinancialPack(params: {
    stockCode: string;
    concept?: string;
    runtimeConfig: ResearchRuntimeConfig;
  }): Promise<CompanyResearchPack | null> {
    if (params.runtimeConfig.toolProviders.financialPack !== "python") {
      return null;
    }

    return this.pythonIntelligenceDataClient.getCompanyResearchPack({
      stockCode: params.stockCode,
      concept: params.concept,
    });
  }

  async getThemeNews(params: {
    theme: string;
    days?: number;
    limit?: number;
    runtimeConfig: ResearchRuntimeConfig;
  }): Promise<ThemeNewsItem[]> {
    if (params.runtimeConfig.toolProviders.themeNews !== "python") {
      return [];
    }

    return this.pythonIntelligenceDataClient.getThemeNews({
      theme: params.theme,
      days: params.days,
      limit: params.limit,
    });
  }

  async getCandidateScreening(params: {
    theme: string;
    limit?: number;
    runtimeConfig: ResearchRuntimeConfig;
  }): Promise<IntelligenceCandidateItem[]> {
    if (params.runtimeConfig.toolProviders.candidateScreening !== "python") {
      return [];
    }

    return this.pythonIntelligenceDataClient.getCandidates({
      theme: params.theme,
      limit: params.limit,
    });
  }

  async getCredibilityEvidence(params: {
    theme: string;
    stockCodes: string[];
    runtimeConfig: ResearchRuntimeConfig;
  }): Promise<CompanyEvidence[]> {
    if (params.runtimeConfig.toolProviders.credibilityLookup !== "python") {
      return [];
    }

    return this.pythonIntelligenceDataClient.getEvidenceBatch({
      concept: params.theme,
      stockCodes: params.stockCodes,
    });
  }
}

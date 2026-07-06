import { describe, expect, it, vi } from "vitest";
import { ResearchToolRegistry } from "~/server/application/intelligence/research-tool-registry";

const runtimeConfig = {
  toolProviders: {
    webSearch: "tavily",
    pageFetch: "tavily",
    financialPack: "python",
    themeNews: "python",
    candidateScreening: "python",
    credibilityLookup: "python",
  },
  models: {
    compression: "deepseek-chat",
  },
  maxContentCharsPerSource: 1200,
  maxEvidencePerUnit: 5,
} as never;

const legacyRuntimeConfig = {
  toolProviders: {
    webSearch: "firecrawl",
    pageFetch: "tavily",
    financialPack: "python",
    themeNews: "python",
    candidateScreening: "python",
    credibilityLookup: "python",
  },
  models: {
    compression: "deepseek-chat",
  },
  maxContentCharsPerSource: 1200,
  maxEvidencePerUnit: 5,
} as never;

describe("ResearchToolRegistry", () => {
  it("uses the capability gateway for web search and dedupes urls", async () => {
    const search = vi.fn(async () => [
      {
        title: "Result A",
        url: "https://example.com/path?a=1",
        description: "desc A",
        markdown: "markdown A",
      },
      {
        title: "Result A duplicate",
        url: "https://www.example.com/path?b=2",
        description: "desc B",
        markdown: "markdown B",
      },
    ]);

    const registry = new ResearchToolRegistry({
      deepSeekClient: {
        complete: vi.fn(async (_messages, fallback) => fallback),
      } as never,
      pythonCapabilityGatewayClient: {
        isConfigured: vi.fn(() => true),
        search,
        scrapeUrl: vi.fn(),
      } as never,
      pythonIntelligenceDataClient: {
        getCompanyResearchPack: vi.fn(),
        getThemeNews: vi.fn(),
        getCandidates: vi.fn(),
        getEvidenceBatch: vi.fn(),
      } as never,
    });

    const results = await registry.searchWeb({
      queries: ["compute"],
      runtimeConfig,
      limit: 4,
    });

    expect(search).toHaveBeenCalledWith({
      query: "compute",
      limit: 4,
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.sourceName).toBe("example.com");
  });

  it("uses the capability gateway for page fetch", async () => {
    const scrapeUrl = vi.fn(async () => ({
      title: "Fetched Page",
      url: "https://example.com/page",
      description: "short description",
      markdown: "long markdown body",
    }));

    const registry = new ResearchToolRegistry({
      deepSeekClient: {
        complete: vi.fn(async (_messages, fallback) => fallback),
      } as never,
      pythonCapabilityGatewayClient: {
        isConfigured: vi.fn(() => true),
        search: vi.fn(),
        scrapeUrl,
      } as never,
      pythonIntelligenceDataClient: {
        getCompanyResearchPack: vi.fn(),
        getThemeNews: vi.fn(),
        getCandidates: vi.fn(),
        getEvidenceBatch: vi.fn(),
      } as never,
    });

    const result = await registry.fetchPage({
      url: "https://example.com/page",
      runtimeConfig,
    });

    expect(scrapeUrl).toHaveBeenCalledWith("https://example.com/page");
    expect(result?.title).toBe("Fetched Page");
  });

  it("keeps the legacy firecrawl provider config working through the capability gateway", async () => {
    const search = vi.fn(async () => [
      {
        title: "Result A",
        url: "https://example.com/path",
        description: "desc A",
        markdown: "markdown A",
      },
    ]);

    const registry = new ResearchToolRegistry({
      deepSeekClient: {
        complete: vi.fn(async (_messages, fallback) => fallback),
      } as never,
      pythonCapabilityGatewayClient: {
        isConfigured: vi.fn(() => true),
        search,
        scrapeUrl: vi.fn(),
      } as never,
      pythonIntelligenceDataClient: {
        getCompanyResearchPack: vi.fn(),
        getThemeNews: vi.fn(),
        getCandidates: vi.fn(),
        getEvidenceBatch: vi.fn(),
      } as never,
    });

    const results = await registry.searchWeb({
      queries: ["compute"],
      runtimeConfig: legacyRuntimeConfig,
      limit: 4,
    });

    expect(results).toHaveLength(1);
    expect(search).toHaveBeenCalledTimes(1);
  });
});

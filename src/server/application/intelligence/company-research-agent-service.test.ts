import { describe, expect, it, vi } from "vitest";
import { CompanyResearchAgentService } from "~/server/application/intelligence/company-research-agent-service";
import { createUnavailableConfidenceAnalysis } from "~/server/domain/intelligence/confidence";

function createService(overrides?: {
  scrapeUrl?: ReturnType<typeof vi.fn>;
  search?: ReturnType<typeof vi.fn>;
  deepSeekClient?: {
    completeJson?: ReturnType<typeof vi.fn>;
    completeContract?: ReturnType<typeof vi.fn>;
  };
}) {
  const scrapeUrl =
    overrides?.scrapeUrl ??
    vi.fn(async (url: string) => ({
      title: `Scraped ${url}`,
      url,
      markdown: "supplemental markdown content with richer factual detail",
    }));
  const search = overrides?.search ?? vi.fn(async () => []);
  const deepSeekClient = {
    completeJson:
      overrides?.deepSeekClient?.completeJson ??
      vi.fn(async (_messages, fallback) => fallback),
    completeContract:
      overrides?.deepSeekClient?.completeContract ??
      vi.fn(async (_messages, fallback) => fallback),
  };

  return {
    service: new CompanyResearchAgentService({
      deepSeekClient: deepSeekClient as never,
      pythonCapabilityGatewayClient: {
        isConfigured: vi.fn(() => true),
        scrapeUrl,
        search,
      } as never,
      pythonIntelligenceDataClient: {
        getCompanyResearchPack: vi.fn(),
      } as never,
      confidenceAnalysisService: {
        analyzeCompanyResearch: vi.fn(async () =>
          createUnavailableConfidenceAnalysis(["stub"]),
        ),
      } as never,
    }),
    scrapeUrl,
    search,
  };
}

describe("CompanyResearchAgentService", () => {
  it("grounds first-party and third-party supplemental urls correctly", () => {
    const { service } = createService();

    const grounded = service.groundSources({
      input: {
        companyName: "Example Co",
        officialWebsite: "example.com",
        supplementalUrls: [
          "https://www.example.com/investor",
          "https://www.cninfo.com.cn/disclosure/detail",
          "https://news.example.org/story",
        ],
      },
      brief: {
        companyName: "Example Co",
        officialWebsite: "https://example.com",
        researchGoal: "Validate earnings conversion",
        focusConcepts: ["compute"],
        keyQuestions: [],
      },
    });

    expect(
      grounded.groundedSources.find((item) =>
        item.url.includes("example.com/investor"),
      )?.isFirstParty,
    ).toBe(true);
    expect(
      grounded.groundedSources.find((item) =>
        item.url.includes("cninfo.com.cn"),
      )?.sourceType,
    ).toBe("financial");
    expect(
      grounded.groundedSources.find((item) =>
        item.url.includes("news.example.org"),
      )?.collectorKey,
    ).toBe("news_sources");
  });

  it("prioritizes first-party evidence during curation", () => {
    const { service } = createService();

    const curated = service.curateEvidence({
      brief: {
        companyName: "Example Co",
        researchGoal: "Validate earnings conversion",
        focusConcepts: ["compute"],
        keyQuestions: [],
      },
      questions: [
        {
          question: "Can profits scale?",
          whyImportant: "This decides whether the theme monetizes.",
          targetMetric: "profit contribution",
          dataHint: "read notes",
        },
      ],
      collectedEvidenceByCollector: {
        official_sources: [
          {
            referenceId: "official-ref",
            title: "Official IR note",
            sourceName: "example.com",
            url: "https://example.com/ir",
            sourceType: "official",
            sourceTier: "first_party",
            collectorKey: "official_sources",
            isFirstParty: true,
            snippet: "official note",
            extractedFact: "The official site says orders are stable.",
            relevance: "high",
          },
        ],
        news_sources: [
          {
            referenceId: "news-ref",
            title: "External article",
            sourceName: "media.example",
            url: "https://media.example/story",
            sourceType: "news",
            sourceTier: "third_party",
            collectorKey: "news_sources",
            isFirstParty: false,
            snippet: "media note",
            extractedFact: "External coverage mentions order growth.",
            relevance: "medium",
          },
        ],
      },
      collectorRunInfo: {
        official_sources: {
          collectorKey: "official_sources",
          configured: true,
          queries: [],
          notes: [],
        },
        news_sources: {
          collectorKey: "news_sources",
          configured: true,
          queries: [],
          notes: [],
        },
      },
      collectionNotes: [],
    });

    expect(curated.references[0]?.isFirstParty).toBe(true);
    expect(curated.collectionSummary.totalFirstPartyCount).toBe(1);
    expect(curated.collectionSummary.totalCuratedCount).toBe(2);
  });

  it("only enriches non-financial references that need more content", async () => {
    const { service, scrapeUrl } = createService();

    const enriched = await service.enrichReferences({
      references: [
        {
          id: "ref-official",
          title: "Official",
          sourceName: "example.com",
          snippet: "short",
          extractedFact: "short",
          url: "https://example.com/ir",
          sourceType: "official",
          sourceTier: "first_party",
          collectorKey: "official_sources",
          isFirstParty: true,
        },
        {
          id: "ref-financial",
          title: "Financial snapshot",
          sourceName: "akshare",
          snippet: "short",
          extractedFact: "short",
          sourceType: "financial",
          sourceTier: "third_party",
          collectorKey: "financial_sources",
          isFirstParty: false,
        },
      ],
      evidence: [
        {
          referenceId: "ref-official",
          title: "Official",
          sourceName: "example.com",
          url: "https://example.com/ir",
          sourceType: "official",
          sourceTier: "first_party",
          collectorKey: "official_sources",
          isFirstParty: true,
          snippet: "short",
          extractedFact: "short",
          relevance: "high",
        },
        {
          referenceId: "ref-financial",
          title: "Financial snapshot",
          sourceName: "akshare",
          sourceType: "financial",
          sourceTier: "third_party",
          collectorKey: "financial_sources",
          isFirstParty: false,
          snippet: "short",
          extractedFact: "short",
          relevance: "medium",
        },
      ],
    });

    expect(scrapeUrl).toHaveBeenCalledTimes(1);
    expect(scrapeUrl).toHaveBeenCalledWith("https://example.com/ir");
    expect(enriched.references[0]?.extractedFact).toContain("supplemental");
    expect(enriched.references[1]?.extractedFact).toBe("short");
  });

  it("falls back to a question array when deep-question output is malformed", async () => {
    const completeJson = vi.fn(async () => ({
      questions: [
        {
          question: "Wrapped question",
          whyImportant: "important",
          targetMetric: "metric",
          dataHint: "hint",
        },
      ],
    }));
    const completeContract = vi.fn(async (_messages, fallback) => fallback);
    const { service } = createService({
      deepSeekClient: {
        completeJson,
        completeContract,
      },
    });

    const result = await service.designDeepQuestions({
      brief: {
        companyName: "Example Co",
        officialWebsite: "https://example.com",
        researchGoal: "Validate earnings conversion",
        focusConcepts: ["compute"],
        keyQuestions: ["Can profits scale?"],
      },
      conceptInsights: [
        {
          concept: "compute",
          whyItMatters: "important",
          companyFit: "fit",
          monetizationPath: "path",
          maturity: "核心成熟",
        },
      ],
    });

    expect(completeContract).toHaveBeenCalledOnce();
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]?.question).toBeTruthy();
  });

  it("recovers wrapped question payloads when answering questions", async () => {
    const { service } = createService();

    await expect(
      service.answerQuestions({
        brief: {
          companyName: "Example Co",
          officialWebsite: "https://example.com",
          researchGoal: "Validate earnings conversion",
          focusConcepts: ["compute"],
          keyQuestions: ["Can profits scale?"],
        },
        questions: {
          questions: [
            {
              question: "Can profits scale?",
              whyImportant: "This decides whether the theme monetizes.",
              targetMetric: "profit contribution",
              dataHint: "read notes",
            },
          ],
        } as never,
        evidence: [],
      }),
    ).resolves.toMatchObject([
      {
        question: "Can profits scale?",
      },
    ]);
  });
});

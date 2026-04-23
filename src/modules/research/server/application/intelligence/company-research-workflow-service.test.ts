import { describe, expect, it, vi } from "vitest";
import { CompanyResearchWorkflowService } from "~/modules/research/server/application/intelligence/company-research-workflow-service";

const runtimeConfig = {
  toolProviders: {
    webSearch: "tavily",
    pageFetch: "tavily",
    financialPack: "python",
    themeNews: "python",
    candidateScreening: "python",
    credibilityLookup: "python",
  },
  maxEvidencePerUnit: 3,
  maxContentCharsPerSource: 1200,
  maxConcurrentResearchUnits: 3,
  maxGapIterations: 1,
  maxUnitsPerPlan: 6,
  maxNotesCharsForCompression: 3000,
  allowClarification: true,
  models: {
    clarification: "deepseek-chat",
    planning: "deepseek-chat",
    research: "deepseek-chat",
    compression: "deepseek-chat",
    report: "deepseek-chat",
  },
} as never;

describe("CompanyResearchWorkflowService", () => {
  it("records failed official search units under the matching collector key", async () => {
    const service = new CompanyResearchWorkflowService({
      client: {} as never,
      companyResearchService: {
        groundSources: vi.fn(() => ({
          groundedSources: [],
          notes: [],
        })),
      } as never,
      researchToolRegistry: {
        searchWeb: vi.fn(async () => {
          throw new Error("tavily failed");
        }),
        fetchPage: vi.fn(),
        getFinancialPack: vi.fn(),
      } as never,
    });

    const result = await service.executeCollectorUnit({
      unit: {
        id: "unit_official",
        title: "Official search",
        objective: "Collect official sources",
        keyQuestions: [],
        priority: "high",
        capability: "official_search",
        dependsOn: [],
        role: "collector",
        expectedArtifact: "notes",
        fallbackCapabilities: [],
        acceptanceCriteria: [],
      },
      state: {
        researchInput: {
          companyName: "Example Co",
        },
        groundedSources: [],
        collectionNotes: [],
      } as never,
      runtimeConfig,
    });

    expect(result.collectorRunInfo.official_sources?.collectorKey).toBe(
      "official_sources",
    );
    expect(result.collectorRunInfo.news_sources).toBeUndefined();
    expect(result.researchUnitRuns[0]?.status).toBe("failed");
  });
});

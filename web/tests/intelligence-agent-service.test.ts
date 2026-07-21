import { describe, expect, it, vi } from "vitest";
import { IntelligenceAgentService } from "~/server/application/intelligence/intelligence-agent-service";

describe("IntelligenceAgentService", () => {
  it("没有候选标的时不请求空的批量证据", async () => {
    const getEvidenceBatch = vi.fn();
    const analyzeIndustryResearchCandidates = vi.fn();
    const service = new IntelligenceAgentService({
      deepSeekClient: {} as never,
      dataClient: { getEvidenceBatch } as never,
      confidenceAnalysisService: {
        analyzeIndustryResearchCandidates,
      } as never,
    });

    await expect(service.evaluateCredibility("人工智能", [])).resolves.toEqual({
      credibility: [],
      evidenceList: [],
    });

    expect(getEvidenceBatch).not.toHaveBeenCalled();
    expect(analyzeIndustryResearchCandidates).not.toHaveBeenCalled();
  });
});

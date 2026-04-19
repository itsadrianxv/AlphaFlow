import { describe, expect, it, vi } from "vitest";
import { OpportunityIntelligenceService } from "~/server/application/intelligence/opportunity-intelligence-service";

function buildSnapshot() {
  return {
    asOf: "2026-04-19T08:30:00+08:00",
    status: "partial" as const,
    regime: {
      overallTone: "risk_on" as const,
      growthTone: "expansion" as const,
      liquidityTone: "supportive" as const,
      riskTone: "risk_on" as const,
      summary: "风险偏好修复，主线资金回流。",
      drivers: ["PMI > 50", "北向回流"],
    },
    flow: {
      northboundNetAmount: 1762.62,
      direction: "inflow" as const,
      summary: "北向资金净流入，风险偏好改善。",
    },
    hotThemes: [
      {
        theme: "AI",
        heatScore: 89,
        whyHot: "订单和算力需求共振。",
        conceptMatches: [
          {
            name: "AI 算力",
            code: "C1",
            aliases: [],
            confidence: 0.92,
            reason: "high confidence",
            source: "auto",
          },
        ],
        candidateStocks: [
          {
            stockCode: "603019",
            stockName: "中科曙光",
            concept: "AI",
            reason: "服务器与算力核心受益。",
            heat: 90,
          },
          {
            stockCode: "300308",
            stockName: "中际旭创",
            concept: "AI",
            reason: "光模块订单兑现。",
            heat: 87,
          },
        ],
        topNews: [
          {
            id: "ai-1",
            title: "算力订单持续增长",
            summary: "头部客户扩单。",
            source: "news",
            publishedAt: "2026-04-19T07:00:00+08:00",
            sentiment: "positive",
            relevanceScore: 0.93,
            relatedStocks: ["603019"],
          },
        ],
      },
      {
        theme: "机器人",
        heatScore: 82,
        whyHot: "产业链扩散，零部件景气提升。",
        conceptMatches: [],
        candidateStocks: [
          {
            stockCode: "002050",
            stockName: "三花智控",
            concept: "机器人",
            reason: "执行器环节订单改善。",
            heat: 78,
          },
        ],
        topNews: [
          {
            id: "robot-1",
            title: "机器人产业链催化升温",
            summary: "供应链扩产。",
            source: "news",
            publishedAt: "2026-04-19T06:30:00+08:00",
            sentiment: "positive",
            relevanceScore: 0.84,
            relatedStocks: ["002050"],
          },
        ],
      },
      {
        theme: "创新药",
        heatScore: 76,
        whyHot: "出海BD和临床催化增加。",
        conceptMatches: [],
        candidateStocks: [
          {
            stockCode: "688235",
            stockName: "百济神州",
            concept: "创新药",
            reason: "出海兑现路径清晰。",
            heat: 74,
          },
        ],
        topNews: [
          {
            id: "drug-1",
            title: "创新药出海再获订单",
            summary: "里程碑付款推进。",
            source: "news",
            publishedAt: "2026-04-18T20:30:00+08:00",
            sentiment: "positive",
            relevanceScore: 0.81,
            relatedStocks: ["688235"],
          },
        ],
      },
      {
        theme: "消费电子",
        heatScore: 68,
        whyHot: "新品备货预期抬升。",
        conceptMatches: [],
        candidateStocks: [
          {
            stockCode: "002475",
            stockName: "立讯精密",
            concept: "消费电子",
            reason: "新品链条受益。",
            heat: 67,
          },
        ],
        topNews: [
          {
            id: "ce-1",
            title: "消费电子进入备货窗口",
            summary: "渠道备货预期改善。",
            source: "news",
            publishedAt: "2026-04-18T18:30:00+08:00",
            sentiment: "neutral",
            relevanceScore: 0.73,
            relatedStocks: ["002475"],
          },
        ],
      },
      {
        theme: "低空经济",
        heatScore: 91,
        whyHot: "情绪一致性高，但兑现链条弱。",
        conceptMatches: [],
        candidateStocks: [],
        topNews: [
          {
            id: "air-1",
            title: "低空经济情绪热度再升",
            summary: "短线情绪炒作明显。",
            source: "news",
            publishedAt: "2026-04-19T08:00:00+08:00",
            sentiment: "negative",
            relevanceScore: 0.77,
            relatedStocks: [],
          },
        ],
      },
    ],
    downstreamHints: {
      workflows: {
        summary: "优先研究高景气主线。",
        suggestedQuestion: "围绕 AI 产业链，当前景气扩散到哪些环节？",
        suggestedDraftName: null,
      },
      companyResearch: {
        summary: "优先确认主题兑现路径。",
        suggestedQuestion: null,
        suggestedDraftName: null,
      },
      screening: {
        summary: "优先从热门主题候选股开始缩小范围。",
        suggestedQuestion: null,
        suggestedDraftName: "AI 热门主题候选池",
      },
      timing: {
        summary: "风险偏好较强，可保持进攻观察。",
        suggestedQuestion: null,
        suggestedDraftName: null,
      },
    },
    availability: {
      regime: { available: true, warning: null },
      flow: { available: true, warning: null },
      hotThemes: { available: true, warning: "theme news partially stale" },
    },
  };
}

function createDbMock() {
  return {
    workflowRun: {
      findMany: vi.fn().mockResolvedValue([
        {
          query: "围绕 AI 算力和服务器环节，哪些公司最先兑现订单？",
          input: {
            query: "围绕 AI 算力和服务器环节，哪些公司最先兑现订单？",
            focusConcepts: ["AI", "服务器"],
          },
        },
      ]),
    },
    watchList: {
      findMany: vi.fn().mockResolvedValue([
        {
          stocks: [
            {
              stockCode: "603019",
              stockName: "中科曙光",
            },
          ],
        },
      ]),
    },
    portfolioSnapshot: {
      findFirst: vi.fn().mockResolvedValue({
        positions: [
          {
            stockCode: "300308",
            stockName: "中际旭创",
          },
        ],
      }),
    },
  };
}

describe("OpportunityIntelligenceService", () => {
  it("builds ranked leads with personalization and avoidance items", async () => {
    const db = createDbMock();
    const getSnapshot = vi.fn().mockResolvedValue(buildSnapshot());
    const getEvidence = vi
      .fn()
      .mockImplementation(async (stockCode: string) => ({
        stockCode,
        companyName: stockCode === "603019" ? "中科曙光" : "中际旭创",
        concept: "AI",
        evidenceSummary: "订单验证和收入兑现路径更清晰。",
        catalysts: ["订单", "收入确认"],
        risks: ["估值抬升"],
        credibilityScore: 88,
        updatedAt: "2026-04-19T08:10:00+08:00",
      }));
    const getCompanyResearchPack = vi.fn().mockResolvedValue({
      stockCode: "603019",
      companyName: "中科曙光",
      concept: "AI",
      financialHighlights: ["服务器收入确认提速"],
      referenceItems: [],
      summaryNotes: ["兑现链条聚焦于订单和收入。"],
    });

    const service = new OpportunityIntelligenceService({
      db: db as never,
      marketContextClient: { getSnapshot } as never,
      intelligenceClient: {
        getEvidence,
        getCompanyResearchPack,
      } as never,
    });

    const feed = await service.getFeedForUser("user_1");

    expect(getSnapshot).toHaveBeenCalledWith({ themeLimit: 18 });
    expect(feed.todayTopLeads).toHaveLength(4);
    expect(feed.todayTopLeads[0]?.theme).toBe("AI");
    expect(feed.todayTopLeads[0]?.whyRecommendedForYou).toContain("最近研究");
    expect(feed.todayTopLeads[0]?.whyRecommendedForYou).toContain("自选");
    expect(feed.avoidanceItems[0]?.theme).toBe("低空经济");
    expect(feed.personalization.recentResearchMatchCount).toBe(1);
    expect(feed.personalization.watchlistMatchCount).toBe(1);
    expect(feed.personalization.portfolioMatchCount).toBe(1);
  });

  it("returns a compact summary with the requested limit", async () => {
    const db = createDbMock();
    const getSnapshot = vi.fn().mockResolvedValue(buildSnapshot());
    const service = new OpportunityIntelligenceService({
      db: db as never,
      marketContextClient: { getSnapshot } as never,
      intelligenceClient: {
        getEvidence: vi.fn(),
        getCompanyResearchPack: vi.fn(),
      } as never,
    });

    const summary = await service.getSummaryForUser("user_1", 2);

    expect(getSnapshot).toHaveBeenCalledWith({ themeLimit: 6 });
    expect(summary.leads).toHaveLength(2);
    expect(summary.leads[0]?.title).toContain("AI");
    expect(summary.leads[0]?.href).toContain("/opportunity-intelligence?lead=");
  });
});

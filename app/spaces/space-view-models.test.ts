import { describe, expect, it } from "vitest";
import {
  buildSpaceActionLinks,
  buildSpaceRecentSummaries,
} from "~/app/spaces/space-view-models";
import type { ResearchSpaceRunLink } from "~/contracts/space";

const runLinks: ResearchSpaceRunLink[] = [
  {
    id: "link-1",
    note: "核心 thesis 证据",
    createdAt: "2026-04-10T09:00:00.000Z",
    run: {
      id: "run-1",
      query: "半导体设备国产替代的订单兑现节奏",
      status: "SUCCEEDED",
      progressPercent: 100,
      currentNodeKey: null,
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-04-10T08:00:00.000Z",
      startedAt: "2026-04-10T08:01:00.000Z",
      completedAt: "2026-04-10T08:05:00.000Z",
      templateCode: "quick_industry_research",
      templateVersion: 3,
    },
  },
  {
    id: "link-2",
    note: "还在运行，不应进入最近结论",
    createdAt: "2026-04-11T09:00:00.000Z",
    run: {
      id: "run-2",
      query: "宁德时代海外产能兑现",
      status: "RUNNING",
      progressPercent: 42,
      currentNodeKey: "agent4_synthesis",
      errorCode: null,
      errorMessage: null,
      createdAt: "2026-04-11T08:00:00.000Z",
      startedAt: "2026-04-11T08:01:00.000Z",
      completedAt: null,
      templateCode: "company_research_center",
      templateVersion: 4,
    },
  },
];

describe("buildSpaceRecentSummaries", () => {
  it("derives summaries only from archived successful runs", () => {
    const summaries = buildSpaceRecentSummaries({
      runLinks,
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.runId).toBe("run-1");
    expect(summaries[0]?.note).toContain("核心 thesis");
  });
});

describe("buildSpaceActionLinks", () => {
  it("prefills the four workflow entry points from the space brief and linked targets", () => {
    const links = buildSpaceActionLinks({
      spaceId: "space-1",
      brief: {
        researchGoal: "判断设备订单兑现强度",
        coreThesis: "先进制程扩产推动核心设备订单继续提升",
        keyQuestions: ["国产替代验证是否继续推进"],
        focusDimensions: ["订单", "验证", "毛利率"],
        notes: "优先跟踪北方华创与中微公司",
      },
      stocks: [
        {
          id: "stock-1",
          stockCode: "688012",
          stockName: "中微公司",
          createdAt: "2026-04-10T09:00:00.000Z",
        },
      ],
      watchLists: [
        {
          id: "watchlist-link-1",
          watchListId: "watchlist-1",
          name: "设备观察池",
          description: null,
          createdAt: "2026-04-10T09:00:00.000Z",
        },
      ],
    });

    expect(links.industryResearchHref).toContain("/workflows?");
    expect(links.industryResearchHref).toContain(
      "researchGoal=%E5%88%A4%E6%96%AD%E8%AE%BE%E5%A4%87%E8%AE%A2%E5%8D%95%E5%85%91%E7%8E%B0%E5%BC%BA%E5%BA%A6",
    );
    expect(links.companyResearchHref).toContain("/company-research?");
    expect(links.companyResearchHref).toContain("stockCode=688012");
    expect(links.screeningHref).toContain("/screening?");
    expect(links.screeningHref).toContain("seedStockCodes=688012");
    expect(links.timingHref).toContain("/timing?");
    expect(links.timingHref).toContain("watchListId=watchlist-1");
  });
});

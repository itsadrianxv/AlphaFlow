import { describe, expect, it } from "vitest";
import {
  buildOpportunityLeadActionLinks,
  slugifyOpportunityLead,
} from "~/app/opportunity-intelligence/opportunity-intelligence-links";

describe("opportunity intelligence links", () => {
  it("builds stable slugs from lead titles", () => {
    expect(slugifyOpportunityLead("AI: 订单兑现靠近")).toBe("ai-orders");
    expect(slugifyOpportunityLead("机器人: 产业链扩散")).toMatch(
      /^lead-[a-z0-9]{8}$/,
    );
  });

  it("builds workflow, screening, and company research links from a lead", () => {
    const links = buildOpportunityLeadActionLinks({
      slug: "ai-orders",
      theme: "AI",
      title: "AI: 订单兑现靠近",
      whyNow: "先看订单和收入确认。",
      realizationPath: "算力订单 -> 收入确认 -> 利润兑现",
      candidateStocks: [
        {
          stockCode: "603019",
          stockName: "中科曙光",
          concept: "AI",
          reason: "服务器主受益",
          heat: 88,
        },
      ],
      recommendedQuestion: "围绕 AI 产业链，哪些环节最先兑现订单？",
    });

    expect(links.workflowsHref).toContain("/workflows?");
    expect(links.workflowsHref).toContain("query=");
    expect(links.screeningHref).toContain("/screening?");
    expect(links.screeningHref).toContain("seedStockCodes=603019");
    expect(links.companyResearchHref).toContain("/company-research?");
    expect(links.companyResearchHref).toContain("stockCode=603019");
  });
});

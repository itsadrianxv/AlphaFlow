import { describe, expect, it } from "vitest";
import type { MarketContextSnapshot } from "~/modules/market/contracts/market-context";
import {
  buildMarketContextHref,
  findMatchingHotThemes,
} from "~/modules/market/ui/market-context-links";

const snapshot: MarketContextSnapshot = {
  asOf: "2026-04-18T00:00:00+00:00",
  status: "complete",
  regime: {
    overallTone: "risk_on",
    growthTone: "expansion",
    liquidityTone: "supportive",
    riskTone: "risk_on",
    summary: "景气修复",
    drivers: ["PMI > 50"],
  },
  flow: {
    northboundNetAmount: 1762.62,
    direction: "inflow",
    summary: "北向净流入",
  },
  hotThemes: [
    {
      theme: "AI",
      heatScore: 84,
      whyHot: "催化集中",
      conceptMatches: [],
      candidateStocks: [
        {
          stockCode: "603019",
          stockName: "中科曙光",
          concept: "AI",
          reason: "热点候选",
          heat: 81,
        },
      ],
      topNews: [],
    },
  ],
  downstreamHints: {
    workflows: {
      summary: "优先研究高景气主题。",
      suggestedQuestion: "围绕 AI 产业链，当前景气扩散到哪些环节？",
    },
    companyResearch: {
      summary: "优先确认主题兑现路径。",
    },
    screening: {
      summary: "优先从热门主题候选股开始缩小范围。",
      suggestedDraftName: "AI 热门主题候选池",
    },
    timing: {
      summary: "风险偏好偏强。",
    },
  },
  availability: {
    regime: { available: true },
    flow: { available: true },
    hotThemes: { available: true },
  },
};

describe("market context links", () => {
  it("builds a workflows deep link from a hot theme", () => {
    const firstTheme = snapshot.hotThemes[0];
    if (!firstTheme) {
      throw new Error("expected first hot theme");
    }

    const href = buildMarketContextHref({
      section: "workflows",
      theme: firstTheme,
      snapshot,
    });
    const url = new URL(`https://example.com${href}`);

    expect(href).toContain("/research?");
    expect(url.searchParams.get("query")).toContain("围绕 AI 产业链");
  });

  it("builds a screening deep link with seed stock codes", () => {
    const firstTheme = snapshot.hotThemes[0];
    if (!firstTheme) {
      throw new Error("expected first hot theme");
    }

    const href = buildMarketContextHref({
      section: "screening",
      theme: firstTheme,
      snapshot,
    });
    const url = new URL(`https://example.com${href}`);

    expect(href).toContain("/screening?");
    expect(url.searchParams.get("seedStockCodes")).toBe("603019");
    expect(url.searchParams.get("draftName")).toBe("AI 热门主题候选池");
  });

  it("finds matched hot themes for current stock codes", () => {
    expect(findMatchingHotThemes(snapshot.hotThemes, ["603019"])).toEqual([
      "AI",
    ]);
    expect(findMatchingHotThemes(snapshot.hotThemes, ["600519"])).toEqual([]);
  });
});

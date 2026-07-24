import { describe, expect, it } from "vitest";

import { hotThemeContextSchema } from "~/contracts/market-context";

describe("市场上下文热点概念板块合约", () => {
  it("接受 TuShare 热榜、板块行情和打板证据", () => {
    const result = hotThemeContextSchema.safeParse({
      theme: "算力概念",
      heatScore: 82,
      whyHot: "THS 热榜第 1 名。",
      marketEvidence: {
        boardCode: "885001.TI",
        tradeDate: "20260724",
        rank: 1,
        hot: 100,
        constituentCount: 90,
        latestPctChange: 5.2,
        fiveDayPctChange: 12.4,
        latestTurnoverRate: 4.1,
        limitUpCount: 2,
        continuationCount: 1,
        rushLimitCount: 0,
        brokenLimitCount: 0,
        limitDownCount: 0,
      },
      conceptMatches: [],
      candidateStocks: [
        {
          stockCode: "603019",
          stockName: "中科曙光",
          concept: "算力概念",
          reason: "连板池",
          heat: 88,
          limitType: "连板池",
          limitTag: "3天2板",
          boardRank: 1,
        },
      ],
      topNews: [],
    });

    expect(result.success).toBe(true);
  });
});

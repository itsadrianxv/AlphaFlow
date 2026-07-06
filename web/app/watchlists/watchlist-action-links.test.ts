import { describe, expect, it } from "vitest";
import { buildWatchlistActionLinks } from "~/app/watchlists/watchlist-action-links";

describe("buildWatchlistActionLinks", () => {
  it("returns a single-stock company research href only when exactly one stock is selected", () => {
    const single = buildWatchlistActionLinks({
      watchListId: "watchlist-1",
      watchListName: "设备观察池",
      selectedStocks: [
        {
          stockCode: "688012",
          stockName: "中微公司",
        },
      ],
    });
    const multi = buildWatchlistActionLinks({
      watchListId: "watchlist-1",
      watchListName: "设备观察池",
      selectedStocks: [
        {
          stockCode: "688012",
          stockName: "中微公司",
        },
        {
          stockCode: "002371",
          stockName: "北方华创",
        },
      ],
    });

    expect(single.companyResearchHref).toContain("stockCode=688012");
    expect(multi.companyResearchHref).toBeNull();
  });

  it("uses selected stocks for screening and industry research prefills, and watchlist context for timing/link-space actions", () => {
    const links = buildWatchlistActionLinks({
      watchListId: "watchlist-1",
      watchListName: "设备观察池",
      selectedStocks: [
        {
          stockCode: "688012",
          stockName: "中微公司",
        },
        {
          stockCode: "002371",
          stockName: "北方华创",
        },
      ],
    });

    expect(links.screeningHref).toContain("seedStockCodes=688012%2C002371");
    expect(links.industryResearchHref).toContain("/workflows?");
    expect(links.industryResearchHref).toContain("query=");
    expect(links.timingHref).toContain("watchListId=watchlist-1");
    expect(links.linkSpaceHref).toContain("/spaces?");
    expect(links.linkSpaceHref).toContain("watchListId=watchlist-1");
  });
});

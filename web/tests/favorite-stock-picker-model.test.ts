import { describe, expect, it } from "vitest";
import {
  buildFavoriteStockOptions,
  inferStockMarket,
} from "~/app/_components/favorite-stock-picker-model";

describe("收藏股票选择器数据", () => {
  it("只保留六位公司股票，并展示收藏公司和自选股来源", () => {
    expect(
      buildFavoriteStockOptions([
        {
          targetType: "COMPANY",
          targetKey: "600519",
          source: "SAVED_COMPANY",
          sources: [
            { source: "SAVED_COMPANY" },
            { source: "WATCHLIST", name: "长期观察" },
          ],
          label: "贵州茅台",
        },
        {
          targetType: "INDUSTRY",
          targetKey: "申万:白酒",
          source: "SAVED_INDUSTRY",
          sources: [{ source: "SAVED_INDUSTRY" }],
          label: "白酒",
        },
      ]),
    ).toEqual([
      {
        stockCode: "600519",
        stockName: "贵州茅台",
        market: "SH",
        sources: ["收藏公司", "自选股 · 长期观察"],
      },
    ]);
  });

  it("按股票代码识别沪深北市场", () => {
    expect(inferStockMarket("600519")).toBe("SH");
    expect(inferStockMarket("000001")).toBe("SZ");
    expect(inferStockMarket("830799")).toBe("BJ");
  });
});

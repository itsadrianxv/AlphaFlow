import { describe, expect, it } from "vitest";
import {
  buildMarketHeatmapOption,
  getHeatmapColor,
} from "~/app/heatmap/market-heatmap-client";

const snapshot = {
  tradeDate: "2026-07-24",
  marketCapAsOf: "2026-07-23",
  priceSource: "rt_min" as const,
  concepts: [
    {
      conceptCode: "885001.TI",
      conceptName: "算力",
      hotRank: 1,
      hotScore: 100,
      marketCap: 12000,
      changePercent: 2.5,
      stocks: [
        { stockCode: "000001", stockName: "平安银行", marketCap: 10000, changePercent: 3 },
        { stockCode: "300024", stockName: "机器人", marketCap: 2000, changePercent: -2 },
      ],
    },
  ],
};

describe("A 股概念热力图", () => {
  it("用绿色表达下跌、粉色表达上涨、灰色表达平盘", () => {
    expect(getHeatmapColor(-3, "dark")).toBe("#47765a");
    expect(getHeatmapColor(3, "dark")).toBe("#9a5e70");
    expect(getHeatmapColor(0, "dark")).toBe("#44484a");
  });

  it("按概念和市值生成嵌套 Treemap 数据", () => {
    const option = buildMarketHeatmapOption(snapshot, "dark");
    const series = option.series[0] as { data: Array<{ children: Array<{ itemStyle: { color: string } }> }> };

    expect(series.data).toHaveLength(1);
    expect(series.data[0]?.children).toHaveLength(2);
    expect(series.data[0]?.children[0]?.itemStyle.color).toBe("#9a5e70");
    expect(series.data[0]?.children[1]?.itemStyle.color).toBe("#47765a");
  });

  it("在上游出现重复概念时只保留首次出现的概念", () => {
    const firstConcept = snapshot.concepts[0]!;
    const option = buildMarketHeatmapOption(
      {
        ...snapshot,
        concepts: [...snapshot.concepts, { ...firstConcept, hotRank: 2 }],
      },
      "dark",
    );
    const series = option.series[0] as { data: Array<{ name: string }> };

    expect(series.data).toHaveLength(1);
    expect(series.data[0]?.name).toBe("算力");
  });
});

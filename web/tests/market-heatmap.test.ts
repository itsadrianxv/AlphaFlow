import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildMarketHeatmapOption,
  buildHeatmapPreviewKlineOption,
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

const heatmapSource = readFileSync(
  "app/heatmap/market-heatmap-client.tsx",
  "utf8",
);

describe("A 股概念热力图", () => {
  it("用绿色表达下跌、粉色表达上涨、灰色表达平盘", () => {
    expect(getHeatmapColor(-3, "dark")).toBe("#61914d");
    expect(getHeatmapColor(3, "dark")).toBe("#ae6470");
    expect(getHeatmapColor(0, "dark")).toBe("#44484a");
  });

  it("按概念和市值生成嵌套 Treemap 数据", () => {
    const option = buildMarketHeatmapOption(snapshot, "dark");
    const series = option.series[0] as {
      data: Array<{ children: Array<{ itemStyle: { color: string } }> }>;
      left: number;
      top: number;
      right: number;
      bottom: number;
    };

    expect(series.data).toHaveLength(1);
    expect(series.data[0]?.children).toHaveLength(2);
    expect(series.data[0]?.children[0]?.itemStyle.color).toBe("#ae6470");
    expect(series.data[0]?.children[1]?.itemStyle.color).toBe("#61914d");
    expect(series.left).toBe(0);
    expect(series.top).toBe(0);
    expect(series.right).toBe(0);
    expect(series.bottom).toBe(0);
    expect(option.tooltip).toEqual({ show: false });
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

  it("为悬停卡片生成最近日线的 K 线序列", () => {
    const option = buildHeatmapPreviewKlineOption(
      [
        { tradeDate: "2026-07-23", open: 10, high: 11, low: 9.8, close: 10.5 },
        { tradeDate: "2026-07-24", open: 10.5, high: 10.8, low: 10.1, close: 10.2 },
      ],
      "dark",
    );
    const series = option.series[0] as { type: string; data: number[][] };

    expect(series.type).toBe("candlestick");
    expect(series.data).toEqual([[10, 10.5, 9.8, 11], [10.5, 10.2, 10.1, 10.8]]);
  });

  it("概览模式固定展示最多 15 个概念且不渲染标题或展开工具", () => {
    expect(heatmapSource).toContain(").slice(0, 15)");
    expect(heatmapSource).not.toContain("A 股概念热力图");
    expect(heatmapSource).not.toContain("展开至 15 个概念");
    expect(heatmapSource).not.toContain("setExpanded");
    expect(heatmapSource).toContain("useHomePageSnapshot()");
  });
});

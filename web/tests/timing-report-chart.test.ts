import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildTimingReportChartOption } from "~/app/timing/reports/[cardId]/timing-report-chart";

const chartSource = readFileSync(
  "app/timing/reports/[cardId]/timing-report-chart.tsx",
  "utf8",
);

const chartLevels = {
  ema5: [],
  ema20: [],
  ema60: [],
  ema120: [],
  recentHigh60d: 12,
  recentLow20d: 8,
  avgVolume20: 100,
  volumeSpikeDates: [],
};

describe("择时报告多周期 KLine", () => {
  it("按周线生成周期化高低点标签", () => {
    const option = buildTimingReportChartOption({
      timeframe: "WEEKLY",
      bars: [
        {
          tradeDate: "2026-07-03",
          open: 10,
          high: 12,
          low: 8,
          close: 11,
          volume: 100,
        },
      ],
      chartLevels,
      showBollinger: false,
      showVolume: true,
      showMovingAverages: {
        ema5: false,
        ema20: false,
        ema60: false,
        ema120: false,
      },
    });

    const seriesNames = (option.series as Array<{ name: string }>).map(
      (series) => series.name,
    );

    expect(seriesNames).toContain("60周高点");
    expect(seriesNames).toContain("20周低点");
  });

  it("浅色主题只替换图表颜色，不改变数据系列", () => {
    const input = {
      timeframe: "DAILY" as const,
      bars: [
        {
          tradeDate: "2026-07-03",
          open: 10,
          high: 12,
          low: 8,
          close: 11,
          volume: 100,
        },
      ],
      chartLevels,
      showBollinger: true,
      showVolume: true,
      showMovingAverages: {
        ema5: true,
        ema20: true,
        ema60: false,
        ema120: false,
      },
    };
    const darkOption = buildTimingReportChartOption(input, "dark");
    const lightOption = buildTimingReportChartOption(input, "light");

    expect(lightOption.series).toHaveLength(darkOption.series.length);
    expect(lightOption.series).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          itemStyle: expect.objectContaining({ color: "#1a7f37" }),
        }),
      ]),
    );
    expect(lightOption.tooltip).toEqual(
      expect.objectContaining({ backgroundColor: "rgba(255, 255, 255, 0.98)" }),
    );
  });

  it("模型预测只保留风险区间填充，不延伸填充至图表顶部", () => {
    const option = buildTimingReportChartOption({
      timeframe: "DAILY",
      bars: [
        {
          tradeDate: "2026-07-03",
          open: 10,
          high: 12,
          low: 8,
          close: 11,
          volume: 100,
        },
      ],
      chartLevels,
      showBollinger: false,
      showVolume: false,
      showMovingAverages: {
        ema5: false,
        ema20: false,
        ema60: false,
        ema120: false,
      },
      forecast: {
        modelName: "模型预测",
        predictionLength: 1,
        warnings: [],
        summary: {
          expectedReturnPct: 0,
          maxDrawdownPct: 0,
          upsidePct: 0,
          volatilityProxy: 0,
          direction: "neutral",
          confidence: 0,
        },
        points: [
          {
            tradeDate: "2026-07-04",
            open: 11,
            high: 14,
            low: 9,
            close: 12,
          },
        ],
      },
    });

    const series = option.series as Array<{
      name: string;
      areaStyle?: unknown;
    }>;
    const riskBase = series.find((item) => item.name === "模型风险区间");
    const riskBand = series.find((item) => item.name === "模型预测高点");

    expect(riskBase).not.toHaveProperty("areaStyle");
    expect(riskBand).toHaveProperty("areaStyle");
  });

  it("不显示 K 线下方的指标标签行", () => {
    expect(chartSource).not.toContain("60${timeframeUnit(timeframe)}高点");
    expect(chartSource).not.toContain("20${timeframeUnit(timeframe)}低点");
    expect(chartSource).not.toContain("20${timeframeUnit(timeframe)}均量");
    expect(chartSource).not.toContain("放量日期 ${chartLevels.volumeSpikeDates.length}");
    expect(chartSource).not.toContain("模型预测不可用");
  });
});

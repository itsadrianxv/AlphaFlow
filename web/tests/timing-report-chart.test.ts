import { describe, expect, it } from "vitest";
import { buildTimingReportChartOption } from "~/app/timing/reports/[cardId]/timing-report-chart";

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
});

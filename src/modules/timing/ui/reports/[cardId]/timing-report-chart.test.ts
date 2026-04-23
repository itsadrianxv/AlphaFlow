import { describe, expect, it, vi } from "vitest";
import {
  buildTimingReportChartOption,
  syncTimingReportChart,
} from "~/modules/timing/ui/reports/[cardId]/timing-report-chart";

const sampleInput = {
  bars: [
    {
      tradeDate: "2026-03-05",
      open: 1660,
      high: 1684,
      low: 1652,
      close: 1674,
      volume: 1800,
    },
    {
      tradeDate: "2026-03-06",
      open: 1676,
      high: 1692,
      low: 1668,
      close: 1680,
      volume: 2600,
    },
  ],
  chartLevels: {
    ema5: [
      { tradeDate: "2026-03-05", value: 1662 },
      { tradeDate: "2026-03-06", value: 1668 },
    ],
    ema20: [
      { tradeDate: "2026-03-05", value: 1618 },
      { tradeDate: "2026-03-06", value: 1628 },
    ],
    ema60: [
      { tradeDate: "2026-03-05", value: 1534 },
      { tradeDate: "2026-03-06", value: 1542 },
    ],
    ema120: [
      { tradeDate: "2026-03-05", value: 1480 },
      { tradeDate: "2026-03-06", value: 1488 },
    ],
    recentHigh60d: 1692,
    recentLow20d: 1604,
    avgVolume20: 1840,
    volumeSpikeDates: ["2026-03-06"],
  },
  showBollinger: true,
  showVolume: true,
  showMovingAverages: {
    ema5: true,
    ema20: true,
    ema60: false,
    ema120: false,
  },
};

describe("timing report chart helpers", () => {
  it("builds a chart option with candlesticks, volume, and overlays", () => {
    const option = buildTimingReportChartOption(sampleInput);

    expect(option.series).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "candlestick" }),
        expect.objectContaining({ name: "成交量", type: "bar" }),
        expect.objectContaining({ name: "EMA 5", type: "line" }),
      ]),
    );
  });

  it("applies chart updates and disposes cleanly through the imperative sync helper", () => {
    const setOption = vi.fn();
    const resize = vi.fn();
    const dispose = vi.fn();
    const chart = { setOption, resize, dispose };
    const init = vi.fn().mockReturnValue(chart);

    const cleanup = syncTimingReportChart({
      init,
      element: { id: "chart-root" },
      input: sampleInput,
    });

    expect(init).toHaveBeenCalled();
    expect(setOption).toHaveBeenCalledTimes(1);

    cleanup();

    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

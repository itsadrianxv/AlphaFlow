"use client";

/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React, { useEffect, useRef, useState } from "react";
import { type ThemeMode, useTheme } from "~/app/_components/theme-provider";
import type {
  TimingBar,
  TimingChartLevels,
  TimingChartLinePoint,
  TimingKronosForecast,
  TimingTimeframe,
} from "~/server/domain/timing/types";

type MovingAverageVisibility = {
  ema5: boolean;
  ema20: boolean;
  ema60: boolean;
  ema120: boolean;
};

const MISSING_DATA = "-" as const;
type MissingData = typeof MISSING_DATA;

export type TimingReportChartColors = {
  up: string;
  down: string;
  volume: string;
  ema5: string;
  ema20: string;
  ema60: string;
  ema120: string;
  bollingerStrong: string;
  bollingerSoft: string;
  levelHigh: string;
  levelLow: string;
  forecast: string;
  forecastArea: string;
  text: string;
  textMuted: string;
  surface: string;
  border: string;
  axis: string;
  grid: string;
};

export function getTimingReportChartColors(
  theme: ThemeMode = "dark",
): TimingReportChartColors {
  if (theme === "light") {
    return {
      up: "#1a7f37",
      down: "#cf222e",
      volume: "#0969da",
      ema5: "#9a6700",
      ema20: "#0969da",
      ema60: "#8250df",
      ema120: "#57606a",
      bollingerStrong: "rgba(87, 96, 106, 0.46)",
      bollingerSoft: "rgba(87, 96, 106, 0.3)",
      levelHigh: "rgba(154, 103, 0, 0.86)",
      levelLow: "rgba(207, 34, 46, 0.82)",
      forecast: "#0f766e",
      forecastArea: "rgba(15, 118, 110, 0.14)",
      text: "#24292f",
      textMuted: "rgba(87, 96, 106, 0.78)",
      surface: "rgba(255, 255, 255, 0.98)",
      border: "rgba(31, 35, 40, 0.18)",
      axis: "rgba(87, 96, 106, 0.42)",
      grid: "rgba(87, 96, 106, 0.18)",
    };
  }

  return {
    up: "#11ff99",
    down: "#ff2047",
    volume: "#3b9eff",
    ema5: "#ffc53d",
    ema20: "#3b9eff",
    ema60: "#9a77ff",
    ema120: "#ffffff",
    bollingerStrong: "rgba(255, 255, 255, 0.34)",
    bollingerSoft: "rgba(255, 255, 255, 0.24)",
    levelHigh: "rgba(255, 197, 61, 0.78)",
    levelLow: "rgba(255, 32, 71, 0.76)",
    forecast: "#14b8a6",
    forecastArea: "rgba(20, 184, 166, 0.16)",
    text: "#f0f0f0",
    textMuted: "rgba(240, 240, 240, 0.62)",
    surface: "rgba(8, 11, 16, 0.96)",
    border: "rgba(214, 235, 253, 0.19)",
    axis: "rgba(214, 235, 253, 0.16)",
    grid: "rgba(214, 235, 253, 0.08)",
  };
}

export type TimingReportChartInput = {
  timeframe?: TimingTimeframe;
  bars: Pick<
    TimingBar,
    "tradeDate" | "open" | "high" | "low" | "close" | "volume"
  >[];
  chartLevels: Pick<
    TimingChartLevels,
    | "ema5"
    | "ema20"
    | "ema60"
    | "ema120"
    | "recentHigh60d"
    | "recentLow20d"
    | "avgVolume20"
    | "volumeSpikeDates"
  >;
  showBollinger: boolean;
  showVolume: boolean;
  showMovingAverages: MovingAverageVisibility;
  forecast?: Pick<
    TimingKronosForecast,
    "points" | "summary" | "warnings" | "modelName" | "predictionLength"
  >;
};

function calculateSimpleMovingAverage(values: number[], windowSize: number) {
  return values.map((_value, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const window = values.slice(start, index + 1);
    const average =
      window.reduce((sum, item) => sum + item, 0) / Math.max(window.length, 1);

    return Math.round(average * 10_000) / 10_000;
  });
}

function calculateStandardDeviation(values: number[], windowSize: number) {
  return values.map((_value, index) => {
    const start = Math.max(0, index - windowSize + 1);
    const window = values.slice(start, index + 1);
    const mean =
      window.reduce((sum, item) => sum + item, 0) / Math.max(window.length, 1);
    const variance =
      window.reduce((sum, item) => sum + (item - mean) ** 2, 0) /
      Math.max(window.length, 1);

    return Math.sqrt(variance);
  });
}

function lineSeriesData(
  line: TimingChartLinePoint[],
  dates: string[],
): Array<number | MissingData> {
  const valueByDate = new Map(line.map((item) => [item.tradeDate, item.value]));
  return dates.map((date) => valueByDate.get(date) ?? MISSING_DATA);
}

function buildHorizontalLine(
  name: string,
  value: number,
  length: number,
  color: string,
) {
  return {
    name,
    type: "line",
    data: Array.from({ length }, () => value),
    symbol: "none",
    lineStyle: {
      type: "dashed",
      color,
      width: 1,
    },
    itemStyle: {
      color,
    },
  };
}

const timeframeLabels: Record<TimingTimeframe, string> = {
  DAILY: "日线",
  WEEKLY: "周线",
  MONTHLY: "月线",
  MINUTE_60: "60分",
  MINUTE_30: "30分",
  MINUTE_15: "15分",
  MINUTE_1: "1分",
};

function timeframeUnit(timeframe: TimingTimeframe) {
  if (timeframe === "DAILY") return "日";
  if (timeframe === "WEEKLY") return "周";
  if (timeframe === "MONTHLY") return "月";
  return "分";
}

function missingValues(length: number) {
  return Array.from({ length }, () => MISSING_DATA);
}

function finiteNumbers(values: Array<number | null | undefined>) {
  return values.filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value),
  );
}

function buildHistoricalPriceAxisBounds(input: TimingReportChartInput) {
  const values = finiteNumbers([
    ...input.bars.flatMap((bar) => [bar.high, bar.low, bar.open, bar.close]),
    input.chartLevels.recentHigh60d,
    input.chartLevels.recentLow20d,
    ...input.chartLevels.ema5.map((point) => point.value),
    ...input.chartLevels.ema20.map((point) => point.value),
    ...input.chartLevels.ema60.map((point) => point.value),
    ...input.chartLevels.ema120.map((point) => point.value),
  ]);

  if (values.length === 0) {
    return {};
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, Math.abs(max) * 0.02, 1);
  const padding = range * 0.12;

  return {
    min: Math.max(0, Math.floor((min - padding) * 100) / 100),
    max: Math.ceil((max + padding) * 100) / 100,
  };
}

export function buildTimingReportChartOption(
  input: TimingReportChartInput,
  theme: ThemeMode = "dark",
) {
  const colors = getTimingReportChartColors(theme);
  const timeframe = input.timeframe ?? "DAILY";
  const unit = timeframeUnit(timeframe);
  const dates = input.bars.map((bar) => bar.tradeDate);
  const forecastDates =
    input.forecast?.points.map((point) => point.tradeDate) ?? [];
  const allDates = [...new Set([...dates, ...forecastDates])];
  const priceAxisBounds = buildHistoricalPriceAxisBounds(input);
  const closeValues = input.bars.map((bar) => bar.close);
  const bollingerMiddle = calculateSimpleMovingAverage(closeValues, 20);
  const bollingerStd = calculateStandardDeviation(closeValues, 20);
  const bollingerUpper = bollingerMiddle.map(
    (value, index) =>
      Math.round((value + (bollingerStd[index] ?? 0) * 2) * 10_000) / 10_000,
  );
  const bollingerLower = bollingerMiddle.map(
    (value, index) =>
      Math.round((value - (bollingerStd[index] ?? 0) * 2) * 10_000) / 10_000,
  );

  const series = [
    {
      name: "价格",
      type: "candlestick",
      data: allDates.map((date) => {
        const bar = input.bars.find((item) => item.tradeDate === date);
        return bar ? [bar.open, bar.close, bar.low, bar.high] : MISSING_DATA;
      }),
      itemStyle: {
        color: colors.up,
        color0: colors.down,
        borderColor: colors.up,
        borderColor0: colors.down,
      },
      xAxisIndex: 0,
      yAxisIndex: 0,
    },
    ...(input.showVolume
      ? [
          {
            name: "成交量",
            type: "bar",
            data: allDates.map(
              (date) =>
                input.bars.find((bar) => bar.tradeDate === date)?.volume ??
                MISSING_DATA,
            ),
            xAxisIndex: 1,
            yAxisIndex: 1,
            itemStyle: {
              color: colors.volume,
              opacity: 0.72,
            },
          },
        ]
      : []),
    ...(input.showMovingAverages.ema5
      ? [
          {
            name: "EMA 5",
            type: "line",
            data: lineSeriesData(input.chartLevels.ema5, allDates),
            symbol: "none",
            lineStyle: { color: colors.ema5, width: 1.5 },
          },
        ]
      : []),
    ...(input.showMovingAverages.ema20
      ? [
          {
            name: "EMA 20",
            type: "line",
            data: lineSeriesData(input.chartLevels.ema20, allDates),
            symbol: "none",
            lineStyle: { color: colors.ema20, width: 1.5 },
          },
        ]
      : []),
    ...(input.showMovingAverages.ema60
      ? [
          {
            name: "EMA 60",
            type: "line",
            data: lineSeriesData(input.chartLevels.ema60, allDates),
            symbol: "none",
            lineStyle: { color: colors.ema60, width: 1.2 },
          },
        ]
      : []),
    ...(input.showMovingAverages.ema120
      ? [
          {
            name: "EMA 120",
            type: "line",
            data: lineSeriesData(input.chartLevels.ema120, allDates),
            symbol: "none",
            lineStyle: { color: colors.ema120, width: 1.2, opacity: 0.72 },
          },
        ]
      : []),
    ...(input.showBollinger
      ? [
          {
            name: "BOLL 上轨",
            type: "line",
            data: [
              ...bollingerUpper,
              ...missingValues(allDates.length - dates.length),
            ],
            symbol: "none",
            lineStyle: { color: colors.bollingerStrong, width: 1 },
          },
          {
            name: "BOLL 中轨",
            type: "line",
            data: [
              ...bollingerMiddle,
              ...missingValues(allDates.length - dates.length),
            ],
            symbol: "none",
            lineStyle: { color: colors.bollingerSoft, width: 1 },
          },
          {
            name: "BOLL 下轨",
            type: "line",
            data: [
              ...bollingerLower,
              ...missingValues(allDates.length - dates.length),
            ],
            symbol: "none",
            lineStyle: { color: colors.bollingerStrong, width: 1 },
          },
        ]
      : []),
    buildHorizontalLine(
      `60${unit}高点`,
      input.chartLevels.recentHigh60d,
      allDates.length,
      colors.levelHigh,
    ),
    buildHorizontalLine(
      `20${unit}低点`,
      input.chartLevels.recentLow20d,
      allDates.length,
      colors.levelLow,
    ),
    ...(input.forecast
      ? [
          {
            name: "模型风险区间",
            type: "line",
            data: allDates.map((date) => {
              const point = input.forecast?.points.find(
                (item) => item.tradeDate === date,
              );
              return point ? point.low : MISSING_DATA;
            }),
            symbol: "none",
            lineStyle: { opacity: 0 },
            stack: "kronos-band",
          },
          {
            name: "模型预测高点",
            type: "line",
            data: allDates.map((date) => {
              const point = input.forecast?.points.find(
                (item) => item.tradeDate === date,
              );
              return point ? point.high - point.low : MISSING_DATA;
            }),
            symbol: "none",
            lineStyle: { opacity: 0 },
            areaStyle: {
              color: colors.forecastArea,
              origin: "start",
            },
            stack: "kronos-band",
          },
          {
            name: "模型预测收盘",
            type: "line",
            data: allDates.map((date) => {
              const point = input.forecast?.points.find(
                (item) => item.tradeDate === date,
              );
              return point ? point.close : MISSING_DATA;
            }),
            symbol: "none",
            lineStyle: {
              color: colors.forecast,
              width: 1.8,
              type: "dashed",
            },
          },
        ]
      : []),
  ];

  return {
    animation: false,
    backgroundColor: "transparent",
    legend: {
      top: 0,
      left: 0,
      textStyle: {
        color: colors.textMuted,
      },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "cross",
      },
      backgroundColor: colors.surface,
      borderColor: colors.border,
      textStyle: {
        color: colors.text,
      },
    },
    grid: [
      {
        left: 18,
        right: 18,
        top: 36,
        height: input.showVolume ? "62%" : "78%",
      },
      {
        left: 18,
        right: 18,
        top: input.showVolume ? "76%" : "86%",
        height: input.showVolume ? "16%" : 0,
      },
    ],
    xAxis: [
      {
        type: "category",
        data: allDates,
        boundaryGap: true,
        axisLine: {
          lineStyle: {
            color: colors.axis,
          },
        },
        axisLabel: {
          color: colors.textMuted,
          hideOverlap: true,
        },
      },
      {
        type: "category",
        data: allDates,
        boundaryGap: true,
        gridIndex: 1,
        axisLine: {
          lineStyle: {
            color: colors.axis,
          },
        },
        axisLabel: {
          show: false,
        },
        axisTick: {
          show: false,
        },
      },
    ],
    yAxis: [
      {
        scale: true,
        ...priceAxisBounds,
        axisLine: {
          lineStyle: {
            color: colors.axis,
          },
        },
        splitLine: {
          lineStyle: {
            color: colors.grid,
          },
        },
        axisLabel: {
          color: colors.textMuted,
        },
      },
      {
        scale: true,
        gridIndex: 1,
        splitNumber: 2,
        axisLine: {
          lineStyle: {
            color: colors.axis,
          },
        },
        splitLine: {
          show: false,
        },
        axisLabel: {
          color: colors.textMuted,
        },
      },
    ],
    dataZoom: [
      {
        type: "inside",
        xAxisIndex: [0, 1],
      },
    ],
    series,
  };
}

export function syncTimingReportChart(params: {
  init: (element: unknown) => {
    setOption: (option: unknown, notMerge?: boolean) => void;
    resize?: () => void;
    dispose: () => void;
  };
  element: unknown;
  input: TimingReportChartInput;
  theme?: ThemeMode;
}) {
  const chart = params.init(params.element);
  const option = buildTimingReportChartOption(params.input, params.theme);
  let disposed = false;
  let frameId: number | undefined;

  const applyOption = () => {
    if (disposed) {
      return;
    }
    chart.setOption(option, true);
  };

  if (typeof window !== "undefined") {
    frameId = window.requestAnimationFrame(applyOption);
  } else {
    applyOption();
  }

  const handleResize = () => {
    chart.resize?.();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("resize", handleResize);
  }

  return () => {
    disposed = true;
    if (typeof window !== "undefined") {
      if (frameId !== undefined) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("resize", handleResize);
    }
    chart.dispose();
  };
}

export function TimingReportChart(props: {
  bars: TimingBar[];
  chartLevels: TimingChartLevels;
  forecast?: TimingReportChartInput["forecast"];
  timeframe?: TimingTimeframe;
  onTimeframeChange?: (timeframe: TimingTimeframe) => void;
  seriesLoading?: boolean;
}) {
  const {
    bars,
    chartLevels,
    forecast,
    timeframe = "DAILY",
    onTimeframeChange,
    seriesLoading = false,
  } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { theme } = useTheme();
  const [showBollinger, setShowBollinger] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showMovingAverages, setShowMovingAverages] =
    useState<MovingAverageVisibility>({
      ema5: true,
      ema20: true,
      ema60: false,
      ema120: false,
    });

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    async function renderChart() {
      if (!containerRef.current) {
        return;
      }

      const [{ init, use }, charts, components, renderers] = await Promise.all([
        import("echarts/core"),
        import("echarts/charts"),
        import("echarts/components"),
        import("echarts/renderers"),
      ]);

      if (cancelled || !containerRef.current) {
        return;
      }

      use([
        charts.BarChart,
        charts.CandlestickChart,
        charts.LineChart,
        components.DataZoomComponent,
        components.GridComponent,
        components.LegendComponent,
        components.TooltipComponent,
        renderers.CanvasRenderer,
      ]);

      cleanup = syncTimingReportChart({
        init: (element) => init(element as HTMLDivElement),
        element: containerRef.current,
        input: {
          bars,
          chartLevels,
          showBollinger,
          showVolume,
          showMovingAverages,
          forecast,
          timeframe,
        },
        theme,
      });
    }

    void renderChart();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [
    bars,
    chartLevels,
    forecast,
    timeframe,
    showBollinger,
    showMovingAverages,
    showVolume,
    theme,
  ]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center border-b border-[var(--app-border-soft)]">
          {(
            [
              "DAILY",
              "WEEKLY",
              "MONTHLY",
              "MINUTE_60",
              "MINUTE_30",
              "MINUTE_15",
              "MINUTE_1",
            ] as const
          ).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onTimeframeChange?.(item)}
              className={`border-b-2 px-3 py-2 text-sm transition-colors ${
                timeframe === item
                  ? "border-[var(--app-accent)] text-[var(--app-text)]"
                  : "border-transparent text-[var(--app-text-muted)] hover:text-[var(--app-text)]"
              }`}
            >
              {timeframeLabels[item]}
            </button>
          ))}
        </div>
        {seriesLoading ? (
          <span className="text-xs text-[var(--app-text-muted)]">加载中</span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setShowVolume((current) => !current)}
          className="app-button"
        >
          {showVolume ? "隐藏成交量" : "显示成交量"}
        </button>
        <button
          type="button"
          onClick={() => setShowBollinger((current) => !current)}
          className="app-button"
        >
          {showBollinger ? "隐藏 BOLL" : "显示 BOLL"}
        </button>
        {(["ema5", "ema20", "ema60", "ema120"] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() =>
              setShowMovingAverages((current) => ({
                ...current,
                [key]: !current[key],
              }))
            }
            className="app-button"
          >
            {showMovingAverages[key]
              ? `隐藏 ${key.toUpperCase()}`
              : `显示 ${key.toUpperCase()}`}
          </button>
        ))}
      </div>

      <div
        ref={containerRef}
        className="h-[420px] w-full rounded-[8px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)]"
      />
    </div>
  );
}

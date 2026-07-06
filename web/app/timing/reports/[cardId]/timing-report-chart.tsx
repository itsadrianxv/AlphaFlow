"use client";

/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React, { useEffect, useRef, useState } from "react";
import { StatusPill } from "~/app/_components/ui";
import type {
  TimingBar,
  TimingChartLevels,
  TimingChartLinePoint,
  TimingKronosForecast,
} from "~/server/domain/timing/types";

type MovingAverageVisibility = {
  ema5: boolean;
  ema20: boolean;
  ema60: boolean;
  ema120: boolean;
};

export type TimingReportChartInput = {
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
): Array<number | null> {
  const valueByDate = new Map(line.map((item) => [item.tradeDate, item.value]));
  return dates.map((date) => valueByDate.get(date) ?? null);
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

function nulls(length: number) {
  return Array.from({ length }, () => null);
}

export function buildTimingReportChartOption(input: TimingReportChartInput) {
  const dates = input.bars.map((bar) => bar.tradeDate);
  const forecastDates =
    input.forecast?.points.map((point) => point.tradeDate) ?? [];
  const allDates = [...dates, ...forecastDates];
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
        return bar ? [bar.open, bar.close, bar.low, bar.high] : null;
      }),
      itemStyle: {
        color: "#11ff99",
        color0: "#ff2047",
        borderColor: "#11ff99",
        borderColor0: "#ff2047",
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
                null,
            ),
            xAxisIndex: 1,
            yAxisIndex: 1,
            itemStyle: {
              color: "#3b9eff",
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
            lineStyle: { color: "#ffc53d", width: 1.5 },
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
            lineStyle: { color: "#3b9eff", width: 1.5 },
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
            lineStyle: { color: "#9a77ff", width: 1.2 },
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
            lineStyle: { color: "#ffffff", width: 1.2, opacity: 0.72 },
          },
        ]
      : []),
    ...(input.showBollinger
      ? [
          {
            name: "BOLL 上轨",
            type: "line",
            data: [...bollingerUpper, ...nulls(forecastDates.length)],
            symbol: "none",
            lineStyle: { color: "rgba(255,255,255,0.34)", width: 1 },
          },
          {
            name: "BOLL 中轨",
            type: "line",
            data: [...bollingerMiddle, ...nulls(forecastDates.length)],
            symbol: "none",
            lineStyle: { color: "rgba(255,255,255,0.24)", width: 1 },
          },
          {
            name: "BOLL 下轨",
            type: "line",
            data: [...bollingerLower, ...nulls(forecastDates.length)],
            symbol: "none",
            lineStyle: { color: "rgba(255,255,255,0.34)", width: 1 },
          },
        ]
      : []),
    buildHorizontalLine(
      "60日高点",
      input.chartLevels.recentHigh60d,
      allDates.length,
      "rgba(255, 197, 61, 0.78)",
    ),
    buildHorizontalLine(
      "20日低点",
      input.chartLevels.recentLow20d,
      allDates.length,
      "rgba(255, 32, 71, 0.76)",
    ),
    ...(input.forecast
      ? [
          {
            name: "Kronos 风险区间",
            type: "line",
            data: allDates.map((date) => {
              const point = input.forecast?.points.find(
                (item) => item.tradeDate === date,
              );
              return point ? point.low : null;
            }),
            symbol: "none",
            lineStyle: { opacity: 0 },
            areaStyle: {
              color: "rgba(20, 184, 166, 0.16)",
              origin: "end",
            },
            stack: "kronos-band",
          },
          {
            name: "Kronos 预测 high",
            type: "line",
            data: allDates.map((date) => {
              const point = input.forecast?.points.find(
                (item) => item.tradeDate === date,
              );
              return point ? point.high - point.low : null;
            }),
            symbol: "none",
            lineStyle: { opacity: 0 },
            areaStyle: {
              color: "rgba(20, 184, 166, 0.16)",
              origin: "start",
            },
            stack: "kronos-band",
          },
          {
            name: "Kronos 预测 close",
            type: "line",
            data: allDates.map((date) => {
              const point = input.forecast?.points.find(
                (item) => item.tradeDate === date,
              );
              return point ? point.close : null;
            }),
            symbol: "none",
            lineStyle: {
              color: "#14b8a6",
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
        color: "rgba(240, 240, 240, 0.62)",
      },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: {
        type: "cross",
      },
      backgroundColor: "rgba(8, 11, 16, 0.96)",
      borderColor: "rgba(214, 235, 253, 0.19)",
      textStyle: {
        color: "#f0f0f0",
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
            color: "rgba(214, 235, 253, 0.16)",
          },
        },
        axisLabel: {
          color: "rgba(240, 240, 240, 0.38)",
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
            color: "rgba(214, 235, 253, 0.16)",
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
        axisLine: {
          lineStyle: {
            color: "rgba(214, 235, 253, 0.16)",
          },
        },
        splitLine: {
          lineStyle: {
            color: "rgba(214, 235, 253, 0.08)",
          },
        },
        axisLabel: {
          color: "rgba(240, 240, 240, 0.48)",
        },
      },
      {
        scale: true,
        gridIndex: 1,
        splitNumber: 2,
        axisLine: {
          lineStyle: {
            color: "rgba(214, 235, 253, 0.16)",
          },
        },
        splitLine: {
          show: false,
        },
        axisLabel: {
          color: "rgba(240, 240, 240, 0.38)",
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
}) {
  const chart = params.init(params.element);
  const option = buildTimingReportChartOption(params.input);
  chart.setOption(option, true);

  const handleResize = () => {
    chart.resize?.();
  };

  if (typeof window !== "undefined") {
    window.addEventListener("resize", handleResize);
  }

  return () => {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", handleResize);
    }
    chart.dispose();
  };
}

export function TimingReportChart(props: {
  bars: TimingBar[];
  chartLevels: TimingChartLevels;
  forecast?: TimingReportChartInput["forecast"];
}) {
  const { bars, chartLevels, forecast } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
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
        },
      });
    }

    void renderChart();

    return () => {
      cleanup?.();
    };
  }, [
    bars,
    chartLevels,
    forecast,
    showBollinger,
    showMovingAverages,
    showVolume,
  ]);

  return (
    <div className="grid gap-4">
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

      <div className="flex flex-wrap gap-2">
        <StatusPill
          label={`60日高点 ${chartLevels.recentHigh60d.toFixed(2)}`}
        />
        <StatusPill label={`20日低点 ${chartLevels.recentLow20d.toFixed(2)}`} />
        <StatusPill
          label={`20日均量 ${Math.round(chartLevels.avgVolume20)}`}
          tone="info"
        />
        <StatusPill
          label={`放量日期 ${chartLevels.volumeSpikeDates.length}`}
          tone="warning"
        />
        <StatusPill
          label={
            forecast
              ? `Kronos 预测 ${forecast.modelName} / ${forecast.predictionLength}日`
              : "Kronos 预测不可用"
          }
          tone={forecast ? "info" : "warning"}
        />
      </div>
    </div>
  );
}

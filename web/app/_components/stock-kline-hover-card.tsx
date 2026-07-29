"use client";

import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import type { ThemeMode } from "~/app/_components/theme-provider";
import { buildTimingReportChartOption } from "~/app/timing/reports/[cardId]/timing-report-chart";

export type StockKlineBar = {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export function buildStockKlinePreviewOption(
  bars: StockKlineBar[],
  theme: ThemeMode,
) {
  const closes = bars.map((bar) => bar.close);
  const recent20 = bars.slice(-20);
  const average = (windowSize: number) =>
    bars.map((bar, index) => ({
      tradeDate: bar.tradeDate,
      value:
        closes
          .slice(Math.max(0, index - windowSize + 1), index + 1)
          .reduce((total, value) => total + value, 0) /
        Math.min(index + 1, windowSize),
    }));
  const option = buildTimingReportChartOption(
    {
      bars: bars.map((bar) => ({ ...bar, volume: 0 })),
      timeframe: "DAILY",
      chartLevels: {
        ema5: average(5),
        ema20: average(20),
        ema60: [],
        ema120: [],
        recentHigh60d: Math.max(...bars.map((bar) => bar.high), 0),
        recentLow20d:
          recent20.length > 0 ? Math.min(...recent20.map((bar) => bar.low)) : 0,
        avgVolume20: 0,
        volumeSpikeDates: [],
      },
      showBollinger: true,
      showVolume: false,
      showMovingAverages: {
        ema5: true,
        ema20: true,
        ema60: false,
        ema120: false,
      },
    },
    theme,
  );

  return {
    ...option,
    legend: { show: false },
    grid: [
      { left: 8, right: 8, top: 8, bottom: 18, height: "82%" },
      { show: false },
    ],
    xAxis: option.xAxis.map((axis, index) =>
      index === 0
        ? { ...axis, axisLabel: { ...axis.axisLabel, fontSize: 9 } }
        : { ...axis, show: false },
    ),
    yAxis: option.yAxis.map((axis) => ({
      ...axis,
      axisLabel: { ...axis.axisLabel, fontSize: 9 },
    })),
  };
}

export function StockKlineHoverCard(props: {
  stockCode: string;
  stockName: string;
  bars: StockKlineBar[];
  loading: boolean;
  theme: ThemeMode;
  className?: string;
  style?: CSSProperties;
  onOpen?: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const chartElement = useRef<HTMLDivElement>(null);
  const latestBars = useMemo(() => props.bars.slice(-30), [props.bars]);

  useEffect(() => {
    if (!chartElement.current || latestBars.length === 0) return;
    let chart:
      | {
          dispose: () => void;
          setOption: (option: unknown, replace?: boolean) => void;
          resize: () => void;
        }
      | undefined;
    let disposed = false;

    void (async () => {
      const [{ init, use }, charts, components, renderers] = await Promise.all([
        import("echarts/core"),
        import("echarts/charts"),
        import("echarts/components"),
        import("echarts/renderers"),
      ]);
      if (disposed || !chartElement.current) return;
      use([
        charts.CandlestickChart,
        charts.LineChart,
        components.DataZoomComponent,
        components.GridComponent,
        components.TooltipComponent,
        renderers.CanvasRenderer,
      ]);
      chart = init(chartElement.current);
      chart.setOption(
        buildStockKlinePreviewOption(latestBars, props.theme),
        true,
      );
      const observer = new ResizeObserver(() => chart?.resize());
      observer.observe(chartElement.current);
      const dispose = chart.dispose.bind(chart);
      chart.dispose = () => {
        observer.disconnect();
        dispose();
      };
    })();

    return () => {
      disposed = true;
      chart?.dispose();
    };
  }, [latestBars, props.theme]);

  // 悬浮卡本身需要接收鼠标事件，以便用户能从标的名称移动到 K 线图。
  const card = (
    // biome-ignore lint/a11y/noStaticElementInteractions: 悬浮卡由标的名称触发，交互语义通过 role 和键盘事件提供。
    <div
      className={[
        "z-30 w-[280px] border border-[var(--app-border)] bg-[var(--app-panel)] p-3 text-left shadow-[0_4px_12px_rgba(0,0,0,0.18)]",
        props.className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={props.style}
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
      onClick={props.onOpen}
      role={props.onOpen ? "button" : undefined}
      tabIndex={props.onOpen ? 0 : undefined}
      onKeyDown={(event) => {
        if (props.onOpen && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          props.onOpen();
        }
      }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--app-text-strong)]">
          {props.stockName}
        </span>
        <span className="app-data shrink-0 text-xs text-[var(--app-text-muted)]">
          {props.stockCode}
        </span>
      </div>
      <div className="mt-3 h-[152px] border border-[var(--app-border-soft)]">
        {props.loading ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--app-text-muted)]">
            正在读取日线行情
          </div>
        ) : null}
        {!props.loading && latestBars.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-[var(--app-text-muted)]">
            暂无日线行情
          </div>
        ) : null}
        <div
          ref={chartElement}
          className={latestBars.length > 0 ? "h-full w-full" : "hidden"}
        />
      </div>
    </div>
  );

  return card;
}

"use client";

/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { type ThemeMode, useTheme } from "~/app/_components/theme-provider";
import type { MarketHeatmapSnapshot } from "~/contracts/market-heatmap";
import { api } from "~/trpc/react";

type TreeMapDatum = {
  name: string;
  value: number;
  stockCode?: string;
  stockName?: string;
  conceptName?: string;
  changePercent?: number | null;
  itemStyle?: { color: string };
  children?: TreeMapDatum[];
};

const HEATMAP_COLORS = {
  dark: {
    negative: ["#385b3d", "#2d733d", "#219653"],
    neutral: "#3a3d40",
    positive: ["#8d4058", "#bb4e70", "#df6688"],
    text: "#f4f5f6",
    border: "#151719",
  },
  light: {
    negative: ["#c7dfc8", "#8fc798", "#4f9a60"],
    neutral: "#d4d8dc",
    positive: ["#f2c7d3", "#e895ad", "#c9587b"],
    text: "#18201a",
    border: "#ffffff",
  },
} as const;

export function getHeatmapColor(
  changePercent: number | null | undefined,
  theme: ThemeMode,
): string {
  const colors = HEATMAP_COLORS[theme];
  if (
    changePercent === null ||
    changePercent === undefined ||
    Math.abs(changePercent) < 0.1
  )
    return colors.neutral;
  const intensity = Math.min(2, Math.floor(Math.abs(changePercent) / 2));
  return changePercent < 0
    ? (colors.negative[intensity] ?? colors.neutral)
    : (colors.positive[intensity] ?? colors.neutral);
}

export function buildMarketHeatmapOption(
  snapshot: MarketHeatmapSnapshot,
  theme: ThemeMode,
) {
  const colors = HEATMAP_COLORS[theme];
  const data: TreeMapDatum[] = snapshot.concepts.map((concept) => ({
    name: concept.conceptName,
    value: concept.marketCap,
    conceptName: concept.conceptName,
    changePercent: concept.changePercent,
    children: concept.stocks.map((stock) => ({
      name: stock.stockName,
      stockName: stock.stockName,
      stockCode: stock.stockCode,
      conceptName: concept.conceptName,
      value: stock.marketCap,
      changePercent: stock.changePercent,
      itemStyle: { color: getHeatmapColor(stock.changePercent, theme) },
    })),
  }));
  return {
    animationDuration: 180,
    tooltip: {
      backgroundColor: theme === "dark" ? "#16191d" : "#ffffff",
      borderColor: theme === "dark" ? "#34383d" : "#c8ccd0",
      textStyle: { color: colors.text, fontFamily: "var(--font-body)" },
      formatter: (params: { data?: TreeMapDatum }) => {
        const item = params.data;
        if (!item?.stockCode) return item?.name ?? "";
        const change =
          item.changePercent == null
            ? "--"
            : `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`;
        return `<strong>${item.stockName}</strong><br/>${item.stockCode}<br/>市值：${formatMarketCap(item.value)}<br/>涨跌幅：${change}<br/>概念：${item.conceptName}`;
      },
    },
    series: [
      {
        type: "treemap",
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        visibleMin: 9,
        label: {
          show: true,
          color: theme === "dark" ? "#f7f8f9" : "#17191b",
          fontSize: 12,
          lineHeight: 16,
          overflow: "truncate",
          formatter: (params: { data?: TreeMapDatum }) => {
            const item = params.data;
            if (!item?.stockCode || item.value < 1500) return "";
            const change =
              item.changePercent == null
                ? "--"
                : `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`;
            return `{name|${item.stockName}}\n{change|${change}}`;
          },
          rich: { name: { fontWeight: 600 }, change: { fontSize: 11 } },
        },
        upperLabel: {
          show: true,
          height: 26,
          color: colors.text,
          fontSize: 14,
          fontWeight: 600,
          formatter: (params: { data?: TreeMapDatum }) => {
            const item = params.data;
            const change =
              item?.changePercent == null
                ? "--"
                : `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`;
            return `${item?.name ?? ""} ${change}`;
          },
        },
        itemStyle: { borderColor: colors.border, borderWidth: 2, gapWidth: 2 },
        levels: [
          {
            itemStyle: {
              borderColor: colors.border,
              borderWidth: 4,
              gapWidth: 4,
            },
          },
        ],
        data,
      },
    ],
  };
}

function formatMarketCap(value: number) {
  return `${(value / 10_000).toFixed(value >= 10_000 ? 0 : 1)} 亿元`;
}

function formatSnapshotTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function MarketHeatmapClient() {
  const { theme } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const chartElement = useRef<HTMLDivElement>(null);
  const query = api.heatmap.getSnapshot.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const snapshot = useMemo(
    () =>
      query.data
        ? {
            ...query.data,
            concepts: query.data.concepts.slice(0, expanded ? 15 : 8),
          }
        : null,
    [expanded, query.data],
  );
  const legendColors = HEATMAP_COLORS[theme];

  useEffect(() => {
    if (!chartElement.current || !snapshot) return;
    let disposed = false;
    let cleanup = () => {};
    void (async () => {
      const [{ init, use }, charts, components, renderers] = await Promise.all([
        import("echarts/core"),
        import("echarts/charts"),
        import("echarts/components"),
        import("echarts/renderers"),
      ]);
      if (disposed || !chartElement.current) return;
      use([
        charts.TreemapChart,
        components.TooltipComponent,
        renderers.CanvasRenderer,
      ]);
      const chart = init(chartElement.current);
      chart.setOption(buildMarketHeatmapOption(snapshot, theme), true);
      const observer = new ResizeObserver(() => chart.resize());
      observer.observe(chartElement.current);
      cleanup = () => {
        observer.disconnect();
        chart.dispose();
      };
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [snapshot, theme]);

  return (
    <section className="pt-2">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--app-border-soft)] pb-5">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-[var(--app-text-strong)]">
            A 股概念热力图
          </h1>
          {snapshot ? (
            <p className="mt-1 text-sm text-[var(--app-text-muted)]">
              {snapshot.priceSource === "rt_min" ? "盘中分钟行情" : "收盘行情"}{" "}
              ·{" "}
              {formatSnapshotTime(
                query.dataUpdatedAt
                  ? new Date(query.dataUpdatedAt).toISOString()
                  : new Date().toISOString(),
              )}{" "}
              更新
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="app-button inline-flex items-center gap-2"
          onClick={() => setExpanded((value) => !value)}
          disabled={!query.data}
        >
          {expanded ? "收起至 8 个概念" : "展开至 15 个概念"}
        </button>
      </div>
      {query.isLoading ? (
        <div className="flex min-h-[680px] items-center justify-center text-sm text-[var(--app-text-muted)]">
          正在读取市场快照…
        </div>
      ) : null}
      {query.error ? (
        <div className="flex min-h-[680px] items-center justify-center text-sm text-[var(--app-danger-text)]">
          {query.error.message}
        </div>
      ) : null}
      {snapshot ? (
        <div className="pt-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--app-text-muted)]">
            <span>
              {snapshot.concepts.length} 个概念 · 市值按{" "}
              {snapshot.marketCapAsOf} 数据计算
            </span>
            <div
              className="flex items-center gap-2"
              role="img"
              aria-label="涨跌幅色阶：绿色下跌，粉色上涨"
            >
              <span className="text-xs">下跌</span>
              <i
                className="h-3 w-6"
                style={{ backgroundColor: legendColors.negative[2] }}
              />
              <i
                className="h-3 w-6"
                style={{ backgroundColor: legendColors.negative[0] }}
              />
              <i
                className="h-3 w-6"
                style={{ backgroundColor: legendColors.neutral }}
              />
              <i
                className="h-3 w-6"
                style={{ backgroundColor: legendColors.positive[1] }}
              />
              <i
                className="h-3 w-6"
                style={{ backgroundColor: legendColors.positive[2] }}
              />
              <span className="text-xs">上涨</span>
            </div>
          </div>
          <div
            ref={chartElement}
            className="min-h-[680px] w-full overflow-hidden border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)]"
          />
        </div>
      ) : null}
    </section>
  );
}

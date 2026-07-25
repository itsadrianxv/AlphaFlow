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

type TreeMapLabelLayoutParams = {
  rect?: { width: number; height: number };
  text?: string;
};

const HEATMAP_COLORS = {
  dark: {
    negative: ["#5d7356", "#61914d", "#62A344"],
    neutral: "#44484a",
    positive: ["#805a64", "#ae6470", "#D25D72"],
    text: "#f4f5f6",
    border: "#151719",
  },
  light: {
    negative: ["#d1ddd1", "#aacb9c", "#88bc74"],
    neutral: "#daddde",
    positive: ["#e6d0d6", "#dfa7b4", "#e58d9d"],
    text: "#18201a",
    border: "#ffffff",
  },
} as const;

const MIN_LABEL_FONT_SIZE = 11;
const MAX_LABEL_FONT_SIZE = 18;

function getTextUnits(value: string) {
  return Array.from(value).reduce(
    (total, character) =>
      total + ((character.codePointAt(0) ?? 0) > 0xff ? 1 : 0.58),
    0,
  );
}

function layoutTreeMapLabel(params: TreeMapLabelLayoutParams) {
  const width = Math.max(0, (params.rect?.width ?? 0) - 10);
  const height = Math.max(0, (params.rect?.height ?? 0) - 8);
  const lines = (params.text ?? "").split("\n");
  const widestLine = Math.max(...lines.map(getTextUnits), 1);
  const fontSize = Math.floor(
    Math.min(
      MAX_LABEL_FONT_SIZE,
      width / widestLine,
      height / (lines.length * 1.35),
    ),
  );

  if (fontSize < MIN_LABEL_FONT_SIZE) {
    return { fontSize: 0, lineHeight: 0, width: 0, height: 0 };
  }
  return {
    fontSize,
    lineHeight: Math.round(fontSize * 1.25),
    width,
    height,
  };
}

function getUniqueConcepts(concepts: MarketHeatmapSnapshot["concepts"]) {
  const conceptCodes = new Set<string>();
  const conceptNames = new Set<string>();
  return concepts.filter((concept) => {
    const conceptName = concept.conceptName
      .trim()
      .replace(/\s+/g, "")
      .toLocaleLowerCase("zh-CN");
    if (
      conceptCodes.has(concept.conceptCode) ||
      conceptNames.has(conceptName)
    ) {
      return false;
    }
    conceptCodes.add(concept.conceptCode);
    conceptNames.add(conceptName);
    return true;
  });
}

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
  const data: TreeMapDatum[] = getUniqueConcepts(snapshot.concepts).map(
    (concept) => ({
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
    }),
  );
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
          formatter: (params: { data?: TreeMapDatum }) => {
            const item = params.data;
            if (!item?.stockCode || item.value < 1500) return "";
            const change =
              item.changePercent == null
                ? "--"
                : `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`;
            return `${item.stockName}\n${change}`;
          },
        },
        labelLayout: layoutTreeMapLabel,
        upperLabel: {
          show: true,
          height: 26,
          color: colors.text,
          fontSize: 14,
          fontWeight: 600,
          formatter: (params: { data?: TreeMapDatum }) => {
            const item = params.data;
            if (!item?.conceptName) return "";
            const change =
              item?.changePercent == null
                ? "--"
                : `${item.changePercent >= 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`;
            return `${item?.name ?? ""} ${change}`;
          },
        },
        itemStyle: { borderColor: colors.border, borderWidth: 1, gapWidth: 0 },
        levels: [
          {
            itemStyle: {
              borderColor: colors.border,
              borderWidth: 1,
              gapWidth: 1,
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
            concepts: getUniqueConcepts(query.data.concepts).slice(
              0,
              expanded ? 15 : 8,
            ),
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
          <div className="mb-4 flex justify-end text-sm text-[var(--app-text-muted)]">
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

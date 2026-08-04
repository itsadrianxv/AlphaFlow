"use client";

import { useRouter } from "next/navigation";
/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useHomePageSnapshot } from "~/app/_components/home-page-snapshot-provider";
import {
  buildStockKlinePreviewOption,
  StockKlineHoverCard,
} from "~/app/_components/stock-kline-hover-card";
import { type ThemeMode, useTheme } from "~/app/_components/theme-provider";
import { companyOverviewHref } from "~/app/company-research/company-overview-link";
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

type HoveredStock = {
  stockCode: string;
  stockName: string;
  x: number;
  y: number;
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

const MIN_LABEL_FONT_SIZE = 5;
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
    tooltip: { show: false },
    series: [
      {
        type: "treemap",
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
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

export function buildHeatmapPreviewKlineOption(
  bars: Array<{
    tradeDate: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }>,
  theme: ThemeMode,
) {
  return buildStockKlinePreviewOption(bars, theme);
}

export function MarketHeatmapClient() {
  const router = useRouter();
  const { theme } = useTheme();
  const [hoveredStock, setHoveredStock] = useState<HoveredStock | null>(null);
  const clearHoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const chartElement = useRef<HTMLDivElement>(null);
  const query = useHomePageSnapshot();
  const snapshot = useMemo(
    () =>
      query.data?.payload.heatmap
        ? {
            ...query.data.payload.heatmap,
            concepts: getUniqueConcepts(
              query.data.payload.heatmap.concepts,
            ).slice(0, 15),
          }
        : null,
    [query.data],
  );
  const legendColors = HEATMAP_COLORS[theme];
  const previewBars = api.companyOverview.bars.useQuery(
    {
      stockCode: hoveredStock?.stockCode ?? "000001",
      timeframe: "DAILY",
      adjust: "",
    },
    {
      enabled: Boolean(hoveredStock),
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
  );

  const cancelClearHover = useCallback(() => {
    if (clearHoverTimer.current) clearTimeout(clearHoverTimer.current);
  }, []);
  const scheduleClearHover = useCallback(() => {
    cancelClearHover();
    clearHoverTimer.current = setTimeout(() => setHoveredStock(null), 120);
  }, [cancelClearHover]);

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
      chart.on("mouseover", (params) => {
        const datum = params.data as TreeMapDatum | undefined;
        const event = params.event as unknown as
          | { offsetX?: number; offsetY?: number }
          | undefined;
        if (!datum?.stockCode || !datum.stockName || !datum.conceptName) return;
        cancelClearHover();
        const containerWidth = chartElement.current?.clientWidth ?? 0;
        const containerHeight = chartElement.current?.clientHeight ?? 0;
        setHoveredStock({
          stockCode: datum.stockCode,
          stockName: datum.stockName,
          x: Math.min(
            Math.max(event?.offsetX ?? 12, 12),
            Math.max(12, containerWidth - 292),
          ),
          y: Math.min(
            Math.max(event?.offsetY ?? 12, 12),
            Math.max(12, containerHeight - 190),
          ),
        });
      });
      chart.on("globalout", scheduleClearHover);
      chart.on("click", (params) => {
        const datum = params.data as TreeMapDatum | undefined;
        if (datum?.stockCode) {
          router.push(companyOverviewHref(datum.stockCode));
        }
      });
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
  }, [cancelClearHover, router, scheduleClearHover, snapshot, theme]);

  return (
    <section className="px-4 pt-4 md:px-6">
      {query.isLoading ? (
        <div className="flex min-h-[680px] items-center justify-center text-sm text-[var(--app-text-muted)]">
          正在读取市场快照…
        </div>
      ) : null}
      {query.isError ? (
        <div className="flex min-h-[680px] items-center justify-center text-sm text-[var(--app-danger-text)]">
          市场快照暂不可用。
        </div>
      ) : null}
      {snapshot ? (
        <div>
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
          <div className="relative" onPointerLeave={scheduleClearHover}>
            <div
              ref={chartElement}
              className="min-h-[680px] w-full overflow-hidden bg-[var(--app-bg-inset)]"
            />
            {hoveredStock ? (
              <StockKlineHoverCard
                stockCode={hoveredStock.stockCode}
                stockName={hoveredStock.stockName}
                bars={previewBars.data?.bars ?? []}
                loading={previewBars.isLoading}
                theme={theme}
                style={{
                  left: hoveredStock.x,
                  top: hoveredStock.y,
                  position: "absolute",
                }}
                onOpen={() =>
                  router.push(companyOverviewHref(hoveredStock.stockCode))
                }
                onPointerEnter={cancelClearHover}
                onPointerLeave={scheduleClearHover}
              />
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

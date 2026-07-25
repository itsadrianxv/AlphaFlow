"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { companyOverviewHref } from "~/app/company-research/company-overview-link";
import { api } from "~/trpc/react";

function amount(value: unknown, unit = "元") {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return "--";
  const absolute = Math.abs(number);
  if (absolute >= 100_000_000) return `${(number / 100_000_000).toFixed(1)}亿`;
  if (absolute >= 10_000) return `${(number / 10_000).toFixed(0)}万`;
  return `${number.toFixed(0)}${unit}`;
}

function signed(value: unknown, digits = 1) {
  const number = Number(value);
  return Number.isFinite(number)
    ? `${number >= 0 ? "+" : ""}${number.toFixed(digits)}`
    : "--";
}

function dateLabel(value: string | null | undefined) {
  return value && /^\d{8}$/.test(value)
    ? `${value.slice(4, 6)}-${value.slice(6, 8)}`
    : "--";
}

function MarketChart({ history }: { history: Array<Record<string, unknown>> }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!element.current || !history.length) return;
    let disposed = false;
    let chart: {
      setOption: (option: unknown, replace?: boolean) => void;
      dispose: () => void;
      resize: () => void;
    } | null = null;
    void (async () => {
      const [{ init, use }, charts, components, renderers] = await Promise.all([
        import("echarts/core"),
        import("echarts/charts"),
        import("echarts/components"),
        import("echarts/renderers"),
      ]);
      if (disposed || !element.current) return;
      use([
        charts.BarChart,
        components.GridComponent,
        components.TooltipComponent,
        components.AxisPointerComponent,
        renderers.CanvasRenderer,
      ]);
      chart = init(element.current);
      chart.setOption(
        {
          grid: { left: 4, right: 4, top: 8, bottom: 16 },
          xAxis: {
            type: "category",
            data: history.map((row) => dateLabel(String(row.tradeDate))),
            axisLabel: { color: "#a1a4a5", fontSize: 9 },
            axisLine: { lineStyle: { color: "rgba(255,255,255,.12)" } },
          },
          yAxis: { type: "value", show: false },
          tooltip: {
            trigger: "axis",
            confine: true,
            formatter: (params: Array<{ dataIndex: number }>) => {
              const row = history[params[0]?.dataIndex ?? 0];
              if (!row) return "";
              return [
                `${dateLabel(String(row.tradeDate))} 主力净额 ${amount(row.netAmount)}`,
                `超大单 ${amount(row.buyElgAmount)}`,
                `大单 ${amount(row.buyLgAmount)}`,
                `中单 ${amount(row.buyMdAmount)}`,
                `小单 ${amount(row.buySmAmount)}`,
              ].join("<br/>");
            },
          },
          series: [
            {
              type: "bar",
              barMaxWidth: 12,
              data: history.map((row) => ({
                value: Number(row.netAmount) || 0,
                itemStyle: {
                  color:
                    (Number(row.netAmount) || 0) >= 0 ? "#d25d72" : "#62a344",
                },
              })),
            },
          ],
        },
        true,
      );
      const observer = new ResizeObserver(() => chart?.resize());
      observer.observe(element.current);
      return () => {
        observer.disconnect();
        chart?.dispose();
      };
    })();
    return () => {
      disposed = true;
      chart?.dispose();
    };
  }, [history]);
  return (
    <div
      ref={element}
      className="h-24 w-full"
      role="img"
      aria-label="近十个交易日大盘主力净流入趋势"
    />
  );
}

export function MoneyFlowPanel() {
  const query = api.overviewInsights.getMoneyFlow.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 6 * 60 * 60 * 1000,
  });
  const [direction, setDirection] = useState<"inflows" | "outflows">("inflows");
  if (query.isLoading)
    return (
      <section className="border-t border-[var(--app-border-soft)] px-4 py-5">
        <h2 className="text-sm font-semibold text-[var(--app-text-strong)]">
          资金流向
        </h2>
        <p className="mt-3 text-sm text-[var(--app-text-muted)]">
          正在读取盘后资金数据。
        </p>
      </section>
    );
  if (query.isError || !query.data)
    return (
      <section className="border-t border-[var(--app-border-soft)] px-4 py-5">
        <h2 className="text-sm font-semibold text-[var(--app-text-strong)]">
          资金流向
        </h2>
        <p className="mt-3 text-sm text-[var(--app-text-muted)]">
          资金流向暂不可用。
        </p>
      </section>
    );
  const { market, concepts, stocks } = query.data;
  const marketLatest = market.history.at(-1);
  const conceptRows = concepts[direction] as Array<Record<string, unknown>>;
  const stockRows = stocks[direction] as Array<Record<string, unknown>>;
  return (
    <section className="border-t border-[var(--app-border-soft)] px-4 py-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--app-text-strong)]">
          资金流向
        </h2>
        <span className="text-xs text-[var(--app-text-subtle)]">
          {dateLabel(market.asOf)}
        </span>
      </div>
      {marketLatest ? (
        <>
          <div className="mt-3 flex items-end justify-between gap-2">
            <div>
              <p className="text-xs text-[var(--app-text-muted)]">
                大盘主力净额
              </p>
              <p
                className={`app-data mt-1 text-lg ${Number(marketLatest.netAmount) >= 0 ? "text-[var(--app-success-text)]" : "text-[var(--app-danger-text)]"}`}
              >
                {amount(marketLatest.netAmount)}
              </p>
            </div>
            <p className="text-right text-xs leading-5 text-[var(--app-text-muted)]">
              上证 {signed(marketLatest.pctChangeSh)}%<br />
              深证 {signed(marketLatest.pctChangeSz)}%
            </p>
          </div>
          <MarketChart
            history={market.history as Array<Record<string, unknown>>}
          />
        </>
      ) : (
        <p className="mt-3 text-sm text-[var(--app-text-muted)]">
          大盘数据暂无。
        </p>
      )}
      <div
        className="mt-3 flex border-b border-[var(--app-border-soft)]"
        role="tablist"
        aria-label="资金流向方向"
      >
        <button
          type="button"
          role="tab"
          aria-selected={direction === "inflows"}
          onClick={() => setDirection("inflows")}
          className={`border-b-2 px-2 py-2 text-xs ${direction === "inflows" ? "border-[var(--app-accent-strong)] text-[var(--app-text-strong)]" : "border-transparent text-[var(--app-text-muted)]"}`}
        >
          净流入
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={direction === "outflows"}
          onClick={() => setDirection("outflows")}
          className={`border-b-2 px-2 py-2 text-xs ${direction === "outflows" ? "border-[var(--app-accent-strong)] text-[var(--app-text-strong)]" : "border-transparent text-[var(--app-text-muted)]"}`}
        >
          净流出
        </button>
      </div>
      <p className="mt-4 text-xs text-[var(--app-text-muted)]">
        概念板块 · {dateLabel(concepts.asOf)}
      </p>
      <div className="mt-1 divide-y divide-[var(--app-border-soft)]">
        {conceptRows.length ? (
          conceptRows.map((row) => (
            <div key={String(row.tsCode)} className="py-2">
              <div className="flex justify-between gap-2 text-sm">
                <span className="truncate text-[var(--app-text-strong)]">
                  {String(row.name)}
                </span>
                <span
                  className={
                    Number(row.netAmount) >= 0
                      ? "text-[var(--app-success-text)]"
                      : "text-[var(--app-danger-text)]"
                  }
                >
                  {amount(row.netAmount)}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--app-text-subtle)]">
                {String(row.leadStock)} · {signed(row.pctChange)}%
              </p>
            </div>
          ))
        ) : (
          <p className="py-2 text-sm text-[var(--app-text-muted)]">
            暂无数据。
          </p>
        )}
      </div>
      <p className="mt-4 text-xs text-[var(--app-text-muted)]">
        个股异动 · {dateLabel(stocks.asOf)}
      </p>
      <div className="mt-1 divide-y divide-[var(--app-border-soft)]">
        {stockRows.length ? (
          stockRows.map((row) => (
            <div key={String(row.tsCode)} className="py-2">
              <div className="flex justify-between gap-2 text-sm">
                <Link
                  href={companyOverviewHref(String(row.stockCode))}
                  className="truncate text-[var(--app-text-strong)] hover:underline"
                >
                  {String(row.name)}
                </Link>
                <span
                  className={
                    Number(row.netAmount) >= 0
                      ? "text-[var(--app-success-text)]"
                      : "text-[var(--app-danger-text)]"
                  }
                >
                  {amount(row.netAmount)}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--app-text-subtle)]">
                涨跌 {signed(row.pctChange)}%
                {row.netD5Amount != null
                  ? ` · 5日 ${amount(row.netD5Amount)}`
                  : ""}
              </p>
            </div>
          ))
        ) : (
          <p className="py-2 text-sm text-[var(--app-text-muted)]">
            暂无数据。
          </p>
        )}
      </div>
    </section>
  );
}

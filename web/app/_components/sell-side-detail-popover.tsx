"use client";

import { type ReactNode, useEffect, useState } from "react";
import { api } from "~/trpc/react";

function signed(value: number | null, digits = 1) {
  if (value == null) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function number(value: number | null, digits = 2) {
  return value == null ? "--" : value.toFixed(digits);
}

function priceRange(min: number | null, max: number | null) {
  if (min == null && max == null) return "--";
  if (min == null) return `最高 ${number(max)}`;
  if (max == null) return `最低 ${number(min)}`;
  return `${number(min)} - ${number(max)}`;
}

export function SellSideDetailPopover(props: {
  stockCode: string;
  stockName: string;
  children: ReactNode;
}) {
  const { stockCode, stockName, children } = props;
  const [open, setOpen] = useState(false);
  const query = api.overviewInsights.getSellSideForecastDetail.useQuery(
    { stockCode },
    { enabled: open, staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false },
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div
      className="relative"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setOpen(false);
      }}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <button
          type="button"
          aria-label={`查看${stockName}卖方预测明细`}
          aria-expanded={open}
          className="shrink-0 text-xs text-[var(--app-text-subtle)] transition-colors hover:text-[var(--app-text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent-strong)]"
          onClick={() => setOpen((value) => !value)}
        >
          详情
        </button>
      </div>
      {open ? (
        <div
          role="dialog"
          aria-label={`${stockName}卖方预测明细`}
          className="absolute right-full top-0 z-30 mr-3 w-[min(34rem,calc(100vw-2rem))] border border-[var(--app-border-strong)] bg-[var(--app-panel-strong)] p-3 shadow-[var(--app-shadow-lg)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border-soft)] pb-2">
            <div className="min-w-0 text-sm font-semibold text-[var(--app-text-strong)]">
              {stockName}{" "}
              <span className="app-data text-xs text-[var(--app-text-subtle)]">
                {stockCode}
              </span>
            </div>
            <button
              type="button"
              className="text-xs text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent-strong)]"
              onClick={() => setOpen(false)}
            >
              关闭
            </button>
          </div>
          {query.isLoading ? (
            <p className="py-4 text-sm text-[var(--app-text-muted)]">
              正在加载机构预测。
            </p>
          ) : null}
          {query.isError ? (
            <p className="py-4 text-sm text-[var(--app-text-muted)]">
              预测明细暂不可用。
            </p>
          ) : null}
          {query.data && query.data.periods.length === 0 ? (
            <p className="py-4 text-sm text-[var(--app-text-muted)]">
              暂无有效预测期的机构明细。
            </p>
          ) : null}
          {query.data?.periods.length ? (
            <div className="app-scroll max-h-[26rem] overflow-y-auto pt-2">
              {query.data.periods.map((period) => (
                <section
                  key={period.quarter}
                  className="border-b border-[var(--app-border-soft)] py-3 last:border-b-0"
                >
                  <h3 className="text-xs font-medium text-[var(--app-text-strong)]">
                    {period.quarter}
                  </h3>
                  <div className="mt-2 grid gap-2">
                    {period.forecasts.map((forecast) => (
                      <article
                        key={forecast.orgName}
                        className="border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-2.5 py-2"
                      >
                        <div className="flex items-start justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <p className="truncate font-medium text-[var(--app-text-strong)]">
                              {forecast.orgName}
                            </p>
                            <p className="mt-0.5 text-[var(--app-text-subtle)]">
                              {forecast.reportDate}
                              {forecast.rating ? ` · ${forecast.rating}` : ""}
                            </p>
                          </div>
                          <span className="shrink-0 text-[var(--app-text-muted)]">
                            目标价{" "}
                            {priceRange(forecast.minPrice, forecast.maxPrice)}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[var(--app-text-muted)]">
                          <span>EPS {number(forecast.eps, 3)}</span>
                          <span
                            className={
                              forecast.epsChangePct != null &&
                              forecast.epsChangePct > 0
                                ? "text-[var(--app-success-text)]"
                                : undefined
                            }
                          >
                            较前次 {signed(forecast.epsChangePct)}
                          </span>
                          <span>净利润 {number(forecast.netProfit)}</span>
                          <span
                            className={
                              forecast.netProfitChangePct != null &&
                              forecast.netProfitChangePct > 0
                                ? "text-[var(--app-success-text)]"
                                : undefined
                            }
                          >
                            较前次 {signed(forecast.netProfitChangePct)}
                          </span>
                        </div>
                        {forecast.reportTitle ? (
                          <p
                            className="mt-2 truncate text-xs text-[var(--app-text-subtle)]"
                            title={forecast.reportTitle}
                          >
                            {forecast.reportTitle}
                          </p>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ChipDetailPopover(props: {
  item: {
    stockCode: string;
    stockName: string;
    asOfDate: string;
    close: number;
    cost15: number;
    cost50: number;
    cost85: number;
    weightAvg: number;
    winnerRate: number;
    winnerRateChange5d: number;
    weightAvgChange5d: number;
  };
  children: ReactNode;
}) {
  const { item, children } = props;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);
  return (
    <div
      className="relative"
      onPointerEnter={(event) => event.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(event) =>
        event.pointerType === "mouse" && setOpen(false)
      }
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={(event) =>
        !event.currentTarget.contains(event.relatedTarget) && setOpen(false)
      }
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <button
          type="button"
          aria-label={`查看${item.stockName}筹码明细`}
          aria-expanded={open}
          className="shrink-0 text-xs text-[var(--app-text-subtle)] transition-colors hover:text-[var(--app-text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent-strong)]"
          onClick={() => setOpen((value) => !value)}
        >
          详情
        </button>
      </div>
      {open ? (
        <div
          role="dialog"
          aria-label={`${item.stockName}筹码明细`}
          className="absolute right-full top-0 z-30 mr-3 w-[min(20rem,calc(100vw-2rem))] border border-[var(--app-border-strong)] bg-[var(--app-panel-strong)] p-3 shadow-[var(--app-shadow-lg)]"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--app-border-soft)] pb-2">
            <div className="text-sm font-semibold text-[var(--app-text-strong)]">
              {item.stockName}{" "}
              <span className="app-data text-xs text-[var(--app-text-subtle)]">
                {item.stockCode}
              </span>
            </div>
            <button
              type="button"
              className="text-xs text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
              onClick={() => setOpen(false)}
            >
              关闭
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--app-text-subtle)]">
            数据日期 {item.asOfDate}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <dt className="text-xs text-[var(--app-text-subtle)]">
                复权收盘价
              </dt>
              <dd className="mt-0.5 text-[var(--app-text-strong)]">
                {number(item.close)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--app-text-subtle)]">
                当前胜率
              </dt>
              <dd className="mt-0.5 text-[var(--app-text-strong)]">
                {item.winnerRate.toFixed(1)}%
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--app-text-subtle)]">
                15% 成本
              </dt>
              <dd className="mt-0.5 text-[var(--app-text)]">
                {number(item.cost15)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--app-text-subtle)]">
                50% 成本
              </dt>
              <dd className="mt-0.5 text-[var(--app-text)]">
                {number(item.cost50)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--app-text-subtle)]">
                85% 成本
              </dt>
              <dd className="mt-0.5 text-[var(--app-text)]">
                {number(item.cost85)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--app-text-subtle)]">
                加权平均成本
              </dt>
              <dd className="mt-0.5 text-[var(--app-text)]">
                {number(item.weightAvg)}
              </dd>
            </div>
          </dl>
          <div className="mt-3 border-t border-[var(--app-border-soft)] pt-2 text-xs text-[var(--app-text-muted)]">
            5 日胜率 {signed(item.winnerRateChange5d)} · 加权成本{" "}
            {item.weightAvgChange5d >= 0 ? "+" : ""}
            {item.weightAvgChange5d.toFixed(2)}
          </div>
        </div>
      ) : null}
    </div>
  );
}

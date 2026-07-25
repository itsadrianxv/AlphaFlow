"use client";

import Link from "next/link";
import {
  ChipDetailPopover,
  SellSideDetailPopover,
} from "~/app/_components/sell-side-detail-popover";
import { companyOverviewHref } from "~/app/company-research/company-overview-link";
import { api } from "~/trpc/react";
import { MoneyFlowPanel } from "~/app/_components/money-flow-panel";

function signed(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

export function OverviewInsightsPanel() {
  const query = api.overviewInsights.get.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  if (query.isLoading)
    return (
      <aside className="hidden px-4 py-5 xl:block">
        <p className="text-sm text-[var(--app-text-muted)]">
          正在整理卖方预期与筹码数据。
        </p>
      </aside>
    );
  if (query.isError || !query.data)
    return (
      <aside className="hidden px-4 py-5 xl:block">
        <p className="text-sm leading-6 text-[var(--app-text-muted)]">
          概览洞察暂不可用。
        </p>
      </aside>
    );
  const { sellSide, chips } = query.data;
  return (
    <aside className="hidden xl:block">
      <section className="px-4 py-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--app-text-strong)]">
            卖方预期
          </h2>
        </div>
        <div className="mt-4">
          <p className="text-xs text-[var(--app-text-muted)]">盈利预期上修</p>
          {sellSide.revisions.length ? (
            <div className="mt-2 divide-y divide-[var(--app-border-soft)]">
              {sellSide.revisions.map((item) => (
                <SellSideDetailPopover
                  key={`${item.stockCode}-${item.quarter}`}
                  stockCode={item.stockCode}
                  stockName={item.stockName}
                >
                  <div className="py-2.5">
                    <div className="flex justify-between gap-2 text-sm">
                      <Link
                        href={companyOverviewHref(item.stockCode)}
                        className="min-w-0 truncate text-[var(--app-text-strong)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent-strong)]"
                      >
                        {item.stockName}
                      </Link>
                      <span className="shrink-0 text-[var(--app-success-text)]">
                        EPS {signed(item.revisionPct)}%
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--app-text-subtle)]">
                      {item.quarter} · 覆盖 {item.coverageCount} 家
                    </p>
                    {item.latestRating ? (
                      <p className="mt-1 truncate text-xs text-[var(--app-text-muted)]">
                        {item.latestRating}
                      </p>
                    ) : null}
                  </div>
                </SellSideDetailPopover>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
              {sellSide.status === "pending"
                ? "正在积累预测变化数据。"
                : "暂无满足条件的预期上修。"}
            </p>
          )}
          {sellSide.revisions.length ? (
            <Link
              href="/sell-side-expectations"
              className="mt-3 inline-flex text-xs text-[var(--app-text-muted)] transition-colors hover:text-[var(--app-text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent-strong)]"
            >
              查看更多
            </Link>
          ) : null}
        </div>
      </section>
      <section className="px-4 py-5">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--app-text-strong)]">
            筹码位置
          </h2>
          <span className="text-xs text-[var(--app-text-subtle)]">
            {chips.source}
          </span>
        </div>
        {chips.error ? (
          <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
            {chips.error}
          </p>
        ) : chips.items.length ? (
          <div className="mt-3 divide-y divide-[var(--app-border-soft)]">
            {chips.items
              .slice(0, chips.source === "热门板块代表股" ? 6 : 4)
              .map((item) => (
                <ChipDetailPopover key={item.stockCode} item={item}>
                  <div className="py-3">
                    <div className="flex justify-between gap-2 text-sm">
                      <Link
                        href={companyOverviewHref(item.stockCode)}
                        className="min-w-0 truncate text-[var(--app-text-strong)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent-strong)]"
                      >
                        {item.stockName}
                      </Link>
                      <span className="shrink-0 text-[var(--app-text-muted)]">
                        胜率 {item.winnerRate.toFixed(0)}%
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
                      {item.signal}
                    </p>
                    <p className="mt-1 text-xs text-[var(--app-text-subtle)]">
                      5 日胜率 {signed(item.winnerRateChange5d)}% · 均价{" "}
                      {signed(item.weightAvgChange5d)}
                    </p>
                  </div>
                </ChipDetailPopover>
              ))}
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
            暂无可分析的股票。
          </p>
        )}
      </section>
      <MoneyFlowPanel />
    </aside>
  );
}

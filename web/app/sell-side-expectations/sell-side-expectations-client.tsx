"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SellSideDetailPopover } from "~/app/_components/sell-side-detail-popover";
import { WorkspaceShell } from "~/app/_components/ui";
import { companyOverviewHref } from "~/app/company-research/company-overview-link";
import type { SellSideRevision } from "~/server/application/overview/sell-side-overview-service";
import { api } from "~/trpc/react";

function priceRange(min: number | null, max: number | null) {
  if (min == null && max == null) return "--";
  if (min == null && max != null) return `最高 ${max.toFixed(2)}`;
  if (max == null && min != null) return `最低 ${min.toFixed(2)}`;
  if (min == null || max == null) return "--";
  return `${min.toFixed(2)} - ${max.toFixed(2)}`;
}

export function SellSideExpectationsClient() {
  const [cursor, setCursor] = useState(0);
  const [items, setItems] = useState<SellSideRevision[]>([]);
  const query = api.overviewInsights.listSellSideRevisions.useQuery(
    { cursor, limit: 20 },
    { staleTime: 5 * 60 * 1000, refetchOnWindowFocus: false },
  );

  useEffect(() => {
    if (!query.data) return;
    setItems((current) =>
      cursor === 0
        ? query.data.items
        : [
            ...current,
            ...query.data.items.filter(
              (item) =>
                !current.some(
                  (existing) =>
                    existing.stockCode === item.stockCode &&
                    existing.quarter === item.quarter,
                ),
            ),
          ],
    );
  }, [cursor, query.data]);
  const nextCursor = query.data?.nextCursor;

  return (
    <WorkspaceShell
      section="companyResearch"
      title="卖方预期"
      titleSize="compact"
      description="按机构 EPS 上修中位数排序，仅展示仍在有效预测期内的公司。"
    >
      <section className="border border-[var(--app-border-soft)] bg-[var(--app-surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--app-border-soft)] px-4 py-3 text-sm">
          <span className="text-[var(--app-text-muted)]">盈利预期上修</span>
          <span className="text-xs text-[var(--app-text-subtle)]">
            {query.data?.forecastDate
              ? `预测快照 ${query.data.forecastDate}`
              : "预测快照待更新"}
          </span>
        </div>
        {query.isLoading && items.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[var(--app-text-muted)]">
            正在整理卖方预测。
          </p>
        ) : null}
        {query.isError ? (
          <p className="px-4 py-8 text-sm text-[var(--app-text-muted)]">
            卖方预期暂不可用。
          </p>
        ) : null}
        {!query.isLoading && !query.isError && items.length === 0 ? (
          <p className="px-4 py-8 text-sm text-[var(--app-text-muted)]">
            {query.data?.status === "pending"
              ? "正在积累预测变化数据。"
              : "暂无满足条件的预期上修。"}
          </p>
        ) : null}
        {items.length ? (
          <div className="divide-y divide-[var(--app-border-soft)]">
            {items.map((item) => (
              <SellSideDetailPopover
                key={`${item.stockCode}-${item.quarter}`}
                stockCode={item.stockCode}
                stockName={item.stockName}
              >
                <div className="grid gap-2 py-4 sm:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,1fr))] sm:items-center">
                  <div className="min-w-0">
                    <Link
                      href={companyOverviewHref(item.stockCode)}
                      className="font-medium text-[var(--app-text-strong)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent-strong)]"
                    >
                      {item.stockName}
                    </Link>
                    <p className="app-data mt-1 text-xs text-[var(--app-text-subtle)]">
                      {item.stockCode}
                    </p>
                  </div>
                  <div className="text-sm text-[var(--app-text-muted)]">
                    <span className="block text-xs text-[var(--app-text-subtle)]">
                      预测期
                    </span>
                    {item.quarter}
                  </div>
                  <div className="text-sm text-[var(--app-success-text)]">
                    <span className="block text-xs text-[var(--app-text-subtle)]">
                      EPS 上修中位数
                    </span>
                    +{item.revisionPct.toFixed(1)}%
                  </div>
                  <div className="text-sm text-[var(--app-text-muted)]">
                    <span className="block text-xs text-[var(--app-text-subtle)]">
                      覆盖机构
                    </span>
                    {item.coverageCount} 家
                  </div>
                  <div className="min-w-0 text-sm text-[var(--app-text-muted)]">
                    <span className="block text-xs text-[var(--app-text-subtle)]">
                      目标价 / 最新评级
                    </span>
                    <span className="block truncate">
                      {priceRange(item.targetPriceMin, item.targetPriceMax)}
                      {item.latestRating ? ` · ${item.latestRating}` : ""}
                    </span>
                  </div>
                </div>
              </SellSideDetailPopover>
            ))}
          </div>
        ) : null}
        {nextCursor != null ? (
          <div className="border-t border-[var(--app-border-soft)] px-4 py-3">
            <button
              type="button"
              className="text-sm text-[var(--app-text-muted)] transition-colors hover:text-[var(--app-text-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent-strong)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={query.isFetching}
              onClick={() => setCursor(nextCursor)}
            >
              {query.isFetching ? "正在加载" : "加载更多"}
            </button>
          </div>
        ) : null}
      </section>
    </WorkspaceShell>
  );
}

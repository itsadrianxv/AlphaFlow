"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  EmptyState,
  InlineNotice,
  LoadingSkeleton,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { buildTimingReportHistoryItems } from "~/app/_components/workspace-history";
import { TimingReportView } from "~/app/timing/reports/[cardId]/timing-report-view";
import { api } from "~/trpc/react";

function formatDate(value?: Date | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function sourceTypeLabel(sourceType?: string) {
  switch (sourceType) {
    case "single":
      return "单股";
    case "watchlist":
      return "自选股";
    case "screening":
      return "筛选联动";
    default:
      return "择时";
  }
}

export function TimingHistoryClient() {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const cardsQuery = api.timing.listTimingCards.useQuery(
    { limit: 100 },
    { refetchOnWindowFocus: false },
  );
  const filteredCards = useMemo(() => {
    const cards = cardsQuery.data ?? [];
    if (!deferredSearch) {
      return cards;
    }

    return cards.filter((card) => {
      const stockCode = card.stockCode.toLowerCase();
      const stockName = card.stockName.toLowerCase();
      return (
        stockCode.includes(deferredSearch) || stockName.includes(deferredSearch)
      );
    });
  }, [cardsQuery.data, deferredSearch]);
  const historyItems = useMemo(
    () => buildTimingReportHistoryItems(filteredCards),
    [filteredCards],
  );

  useEffect(() => {
    if (filteredCards.length === 0) {
      setSelectedCardId(null);
      return;
    }

    if (
      !selectedCardId ||
      !filteredCards.some((card) => card.id === selectedCardId)
    ) {
      setSelectedCardId(filteredCards[0]?.id ?? null);
    }
  }, [filteredCards, selectedCardId]);

  const reportQuery = api.timing.getTimingReport.useQuery(
    { cardId: selectedCardId ?? "" },
    {
      enabled: Boolean(selectedCardId),
      refetchOnWindowFocus: false,
    },
  );

  return (
    <WorkspaceShell
      section="timing"
      sectionView="history"
      contentWidth="wide"
      historyItems={historyItems}
      historyHref="/timing/history"
      activeHistoryId={selectedCardId ?? undefined}
      historyLoading={cardsQuery.isLoading}
      historyEmptyText="还没有择时报告"
      eyebrow="择时报告历史"
      title="择时报告历史"
      description="按时间回看每张单股择时报告，直接在历史页预览报告内容，再决定是否进入完整报告页。"
      actions={
        <>
          <Link href="/timing" className="app-button app-button-primary">
            返回择时组合
          </Link>
          <Link
            href="/screening/history"
            className="app-button app-button-success"
          >
            机会池历史
          </Link>
        </>
      }
    >
      <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="app-panel p-4 sm:p-5">
          <div className="border-b border-[var(--app-border)] pb-4">
            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              搜索择时报告
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="搜索股票代码或股票名称"
                className="app-input"
              />
            </label>
            <p className="mt-3 text-xs leading-5 text-[var(--app-text-soft)]">
              左侧按时间倒序排列，右侧直接预览选中的单股报告。
            </p>
          </div>

          {cardsQuery.error ? (
            <InlineNotice
              tone="danger"
              title="报告历史加载失败"
              description={cardsQuery.error.message}
            />
          ) : null}

          <div className="mt-4 grid gap-3">
            {cardsQuery.isLoading ? (
              <LoadingSkeleton rows={4} />
            ) : filteredCards.length === 0 ? (
              <EmptyState title="还没有可查看的择时报告" />
            ) : (
              filteredCards.map((card) => {
                const active = card.id === selectedCardId;

                return (
                  <button
                    key={card.id}
                    type="button"
                    onClick={() => setSelectedCardId(card.id)}
                    className={`rounded-[16px] border px-4 py-4 text-left transition-colors ${
                      active
                        ? "border-[var(--app-border-strong)] bg-[var(--app-panel-strong)]"
                        : "border-[var(--app-border)] bg-[var(--app-panel)] hover:border-[var(--app-border-strong)] hover:bg-[var(--app-panel-strong)]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill
                        label={sourceTypeLabel(card.sourceType)}
                        tone="info"
                      />
                      <StatusPill label={card.actionBias} tone="neutral" />
                    </div>
                    <p className="mt-3 text-sm font-medium leading-6 text-[var(--app-text)]">
                      {card.stockName} · {card.stockCode}
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--app-text-muted)]">
                      {card.summary}
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--app-text-soft)]">
                      <span>{formatDate(card.createdAt)}</span>
                      <span>置信度 {card.confidence}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section className="app-panel p-4 sm:p-6">
          {!selectedCardId ? (
            <EmptyState
              title="选择一份择时报告"
              description="左侧会保留最新报告历史，选中后可在这里直接预览完整报告。"
            />
          ) : reportQuery.isLoading ? (
            <LoadingSkeleton rows={5} />
          ) : reportQuery.error ? (
            <EmptyState
              title="这份报告暂时无法读取"
              description={reportQuery.error.message}
            />
          ) : !reportQuery.data ? (
            <EmptyState title="未找到对应的择时报告" />
          ) : (
            <div className="grid gap-5">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--app-border)] pb-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      label={sourceTypeLabel(reportQuery.data.card.sourceType)}
                      tone="info"
                    />
                    <StatusPill
                      label={reportQuery.data.card.actionBias}
                      tone="neutral"
                    />
                  </div>
                  <h2 className="mt-4 text-2xl font-medium tracking-[-0.02em] text-[var(--app-text)]">
                    {reportQuery.data.card.stockName} ·{" "}
                    {reportQuery.data.card.stockCode}
                  </h2>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--app-text-muted)]">
                    {reportQuery.data.card.summary}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/timing/reports/${selectedCardId}`}
                    className="app-button app-button-primary"
                  >
                    打开完整报告
                  </Link>
                  <Link href="/timing" className="app-button">
                    返回择时工作台
                  </Link>
                </div>
              </div>

              <TimingReportView report={reportQuery.data} />
            </div>
          )}
        </section>
      </section>
    </WorkspaceShell>
  );
}

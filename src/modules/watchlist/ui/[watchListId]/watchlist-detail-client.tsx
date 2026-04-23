"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import {
  buildWatchlistActionLinks,
  type WatchlistSelectedStock,
} from "~/modules/watchlist/ui/watchlist-action-links";
import { api } from "~/platform/trpc/react";
import {
  ActionStrip,
  EmptyState,
  InlineNotice,
  SectionCard,
  WorkspaceShell,
} from "~/shared/ui/primitives/ui";

type WatchlistDetailClientProps = {
  watchListId: string;
};

function asWatchedStock(
  value: Record<string, unknown>,
): WatchlistSelectedStock & {
  note: string;
  tags: string[];
} {
  return {
    stockCode: String(value.stockCode ?? ""),
    stockName: String(value.stockName ?? value.stockCode ?? ""),
    note: typeof value.note === "string" ? value.note : "",
    tags: Array.isArray(value.tags)
      ? value.tags.map((item) => String(item))
      : [],
  };
}

export function WatchlistDetailClient({
  watchListId,
}: WatchlistDetailClientProps) {
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword.trim());
  const [selectedStockCodes, setSelectedStockCodes] = useState<string[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [tagDrafts, setTagDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const utils = api.useUtils();

  const detailQuery = api.watchlist.getDetail.useQuery(
    { id: watchListId },
    { refetchOnWindowFocus: false },
  );
  const searchStocksQuery = api.screening.searchStocks.useQuery(
    {
      keyword: deferredKeyword,
      limit: 12,
    },
    {
      enabled: deferredKeyword.length > 0,
      refetchOnWindowFocus: false,
    },
  );

  const addStockMutation = api.watchlist.addStock.useMutation({
    onSuccess: async () => {
      setNotice("股票已加入列表。");
      await utils.watchlist.getDetail.invalidate({ id: watchListId });
    },
  });
  const removeStockMutation = api.watchlist.removeStock.useMutation({
    onSuccess: async () => {
      await utils.watchlist.getDetail.invalidate({ id: watchListId });
    },
  });
  const updateNoteMutation = api.watchlist.updateStockNote.useMutation({
    onSuccess: async () => {
      await utils.watchlist.getDetail.invalidate({ id: watchListId });
    },
  });
  const updateTagsMutation = api.watchlist.updateStockTags.useMutation({
    onSuccess: async () => {
      await utils.watchlist.getDetail.invalidate({ id: watchListId });
    },
  });

  const stocks = useMemo(
    () =>
      (detailQuery.data?.stocks ?? []).map((item) =>
        asWatchedStock(item as Record<string, unknown>),
      ),
    [detailQuery.data?.stocks],
  );
  const selectedStocks = useMemo(
    () => stocks.filter((item) => selectedStockCodes.includes(item.stockCode)),
    [selectedStockCodes, stocks],
  );
  const actionLinks = useMemo(
    () =>
      detailQuery.data
        ? buildWatchlistActionLinks({
            watchListId,
            watchListName: detailQuery.data.name,
            selectedStocks,
          })
        : null,
    [detailQuery.data, selectedStocks, watchListId],
  );

  useEffect(() => {
    const nextNotes: Record<string, string> = {};
    const nextTags: Record<string, string> = {};

    for (const stock of stocks) {
      nextNotes[stock.stockCode] = stock.note;
      nextTags[stock.stockCode] = stock.tags.join(", ");
    }

    setNoteDrafts(nextNotes);
    setTagDrafts(nextTags);
  }, [stocks]);

  function toggleSelected(stockCode: string) {
    setSelectedStockCodes((current) =>
      current.includes(stockCode)
        ? current.filter((item) => item !== stockCode)
        : [...current, stockCode],
    );
  }

  return (
    <WorkspaceShell
      section="watchlists"
      eyebrow="Watchlist Detail"
      title={detailQuery.data?.name ?? "自选股列表"}
      description={
        detailQuery.data?.description ??
        "在这里多选股票并发起筛选、行业研究、公司研究、择时或链接到 Space。"
      }
      showWatchlistsAction={false}
      actions={
        <>
          <Link href="/watchlists" className="app-button">
            返回列表总览
          </Link>
          <Link href="/research/spaces" className="app-button">
            打开研究空间
          </Link>
        </>
      }
    >
      {notice ? <InlineNotice tone="success" description={notice} /> : null}

      {selectedStocks.length > 0 && actionLinks ? (
        <ActionStrip
          title={`已选择 ${selectedStocks.length} 只股票`}
          description="顶部 action bar 是 v1 的主交互：从选中的股票直接发起跨模块动作。"
          actions={
            <>
              <Link href={actionLinks.screeningHref} className="app-button">
                筛选
              </Link>
              <Link
                href={actionLinks.industryResearchHref}
                className="app-button"
              >
                行业研究
              </Link>
              {actionLinks.companyResearchHref ? (
                <Link
                  href={actionLinks.companyResearchHref}
                  className="app-button"
                >
                  公司研究
                </Link>
              ) : (
                <button type="button" disabled className="app-button">
                  公司研究（需单选）
                </button>
              )}
              <Link href={actionLinks.timingHref} className="app-button">
                择时
              </Link>
              <Link
                href={actionLinks.linkSpaceHref}
                className="app-button app-button-primary"
              >
                Link to Space
              </Link>
            </>
          }
        />
      ) : null}

      {!detailQuery.data ? (
        <EmptyState
          title={detailQuery.isLoading ? "正在加载列表" : "未找到该列表"}
          description={detailQuery.error?.message}
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="grid gap-6">
            <SectionCard title="添加股票">
              <div className="grid gap-3">
                <input
                  value={keyword}
                  onChange={(event) => setKeyword(event.target.value)}
                  placeholder="按代码或名称搜索股票"
                  className="app-input"
                />
                {searchStocksQuery.data?.map((item) => (
                  <div
                    key={`${item.stockCode}-${item.stockName}`}
                    className="flex items-center justify-between gap-3 rounded-[12px] border border-[var(--app-border-soft)] px-3 py-2"
                  >
                    <span className="text-sm text-[var(--app-text)]">
                      {item.stockName} · {item.stockCode}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        void addStockMutation.mutateAsync({
                          watchListId,
                          stockCode: item.stockCode,
                          stockName: item.stockName,
                        })
                      }
                      className="app-button"
                    >
                      加入
                    </button>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          <SectionCard
            title="股票明细"
            description="勾选后触发顶部 action bar；备注和标签都可以直接在这里维护。"
          >
            {stocks.length === 0 ? (
              <EmptyState title="当前列表还没有股票" />
            ) : (
              <div className="grid gap-3">
                {stocks.map((stock) => (
                  <article
                    key={stock.stockCode}
                    className="rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <label className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedStockCodes.includes(stock.stockCode)}
                          onChange={() => toggleSelected(stock.stockCode)}
                        />
                        <div>
                          <div className="text-base text-[var(--app-text-strong)]">
                            {stock.stockName}
                          </div>
                          <div className="text-sm text-[var(--app-text-muted)]">
                            {stock.stockCode}
                          </div>
                        </div>
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          void removeStockMutation.mutateAsync({
                            watchListId,
                            stockCode: stock.stockCode,
                          })
                        }
                        className="app-button"
                      >
                        移除
                      </button>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <textarea
                        value={noteDrafts[stock.stockCode] ?? ""}
                        onChange={(event) =>
                          setNoteDrafts((current) => ({
                            ...current,
                            [stock.stockCode]: event.target.value,
                          }))
                        }
                        placeholder="备注"
                        className="app-textarea min-h-[90px]"
                      />
                      <textarea
                        value={tagDrafts[stock.stockCode] ?? ""}
                        onChange={(event) =>
                          setTagDrafts((current) => ({
                            ...current,
                            [stock.stockCode]: event.target.value,
                          }))
                        }
                        placeholder="标签，逗号分隔"
                        className="app-textarea min-h-[90px]"
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void updateNoteMutation.mutateAsync({
                            watchListId,
                            stockCode: stock.stockCode,
                            note: noteDrafts[stock.stockCode] ?? "",
                          })
                        }
                        className="app-button"
                      >
                        保存备注
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void updateTagsMutation.mutateAsync({
                            watchListId,
                            stockCode: stock.stockCode,
                            tags: (tagDrafts[stock.stockCode] ?? "")
                              .split(",")
                              .map((item) => item.trim())
                              .filter(Boolean),
                          })
                        }
                        className="app-button"
                      >
                        保存标签
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </WorkspaceShell>
  );
}

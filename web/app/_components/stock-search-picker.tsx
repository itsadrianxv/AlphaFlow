"use client";

import { useDeferredValue } from "react";
import { cn, InlineNotice, StatusPill } from "~/app/_components/ui";
import { api, type RouterOutputs } from "~/trpc/react";

export type StockSearchPickerItem =
  RouterOutputs["screening"]["searchStocks"][number];

export type StockSearchPickerSelection = {
  stockCode: string;
  stockName: string;
  market: string;
};

export function StockSearchPicker(props: {
  label: string;
  keyword: string;
  onKeywordChange: (value: string) => void;
  selectedStocks: StockSearchPickerSelection[];
  onToggleStock: (stock: StockSearchPickerSelection) => void;
  placeholder?: string;
  emptyHint?: string;
  maxSelection?: number;
  className?: string;
}) {
  const {
    label,
    keyword,
    onKeywordChange,
    selectedStocks,
    onToggleStock,
    placeholder = "输入股票代码或名称",
    emptyHint = "输入关键词后开始搜索。",
    maxSelection,
    className,
  } = props;
  const deferredKeyword = useDeferredValue(keyword.trim());
  const searchStocksQuery = api.screening.searchStocks.useQuery(
    {
      keyword: deferredKeyword,
      limit: 20,
    },
    {
      enabled: deferredKeyword.length > 0,
      refetchOnWindowFocus: false,
    },
  );

  return (
    <div className={cn("grid gap-3", className)}>
      <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
        <span>
          {label}
          {maxSelection ? (
            <span className="ml-2 text-xs text-[var(--app-text-soft)]">
              已选 {selectedStocks.length}/{maxSelection}
            </span>
          ) : null}
        </span>
        <input
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          placeholder={placeholder}
          className="app-input"
        />
      </label>

      {selectedStocks.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {selectedStocks.map((stock) => (
            <button
              key={stock.stockCode}
              type="button"
              onClick={() => onToggleStock(stock)}
              className="cursor-pointer rounded-full border border-[var(--app-border-soft)] px-3 py-1 text-xs text-[var(--app-text)] transition-colors hover:border-[var(--app-border-strong)] hover:bg-[var(--app-panel-soft)]"
            >
              {stock.stockName} {stock.stockCode}
            </button>
          ))}
        </div>
      ) : null}

      <div className="max-h-[280px] overflow-auto rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-surface)]">
        {deferredKeyword.length === 0 ? (
          <div className="p-4 text-sm leading-6 text-[var(--app-text-muted)]">
            {emptyHint}
          </div>
        ) : searchStocksQuery.isLoading ? (
          <div className="p-4 text-sm text-[var(--app-text-muted)]">
            搜索中...
          </div>
        ) : searchStocksQuery.isError ? (
          <div className="p-4">
            <InlineNotice
              tone="danger"
              description={searchStocksQuery.error.message}
            />
          </div>
        ) : (searchStocksQuery.data?.length ?? 0) === 0 ? (
          <div className="p-4 text-sm text-[var(--app-text-muted)]">
            未找到匹配的股票。
          </div>
        ) : (
          <div className="grid">
            {(searchStocksQuery.data ?? []).map((stock) => {
              const selected = selectedStocks.some(
                (item) => item.stockCode === stock.stockCode,
              );

              return (
                <button
                  key={stock.stockCode}
                  type="button"
                  onClick={() =>
                    onToggleStock({
                      stockCode: stock.stockCode,
                      stockName: stock.stockName,
                      market: stock.market,
                    })
                  }
                  className="cursor-pointer border-b border-[var(--app-border-soft)] px-4 py-3 text-left text-sm transition-colors last:border-b-0 hover:bg-[var(--app-panel-soft)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-[var(--app-text)]">
                        {stock.stockName} {stock.stockCode}
                      </div>
                      <div className="mt-1 text-xs text-[var(--app-text-subtle)]">
                        {stock.market} ·{" "}
                        {stock.matchField === "CODE" ? "代码命中" : "名称命中"}
                      </div>
                    </div>
                    <StatusPill
                      label={selected ? "已选" : "添加"}
                      tone={selected ? "success" : "info"}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

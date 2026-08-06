"use client";

import { useId, useMemo, useState } from "react";
import { cn, InlineNotice } from "~/app/_components/ui";
import { api } from "~/trpc/react";
import {
  buildFavoriteStockOptions,
  type FavoriteStockOption,
} from "./favorite-stock-picker-model";

export function FavoriteStockPicker(props: {
  selectedStockCodes: string[];
  onToggleStock: (stock: FavoriteStockOption) => void;
  maxSelection?: number;
  className?: string;
}) {
  const { selectedStockCodes, onToggleStock, maxSelection, className } = props;
  const radioGroupName = useId();
  const [keyword, setKeyword] = useState("");
  const candidatesQuery = api.researchPreference.importCandidates.useQuery(
    undefined,
    { refetchOnWindowFocus: false },
  );
  const options = useMemo(
    () => buildFavoriteStockOptions(candidatesQuery.data ?? []),
    [candidatesQuery.data],
  );
  const normalizedKeyword = keyword.trim().toLowerCase();
  const visibleOptions = normalizedKeyword
    ? options.filter(
        (option) =>
          option.stockCode.includes(normalizedKeyword) ||
          option.stockName.toLowerCase().includes(normalizedKeyword) ||
          option.sources.some((source) =>
            source.toLowerCase().includes(normalizedKeyword),
          ),
      )
    : options;
  const selectedCodes = new Set(selectedStockCodes);
  const limitReached = Boolean(
    maxSelection && selectedCodes.size >= maxSelection,
  );
  const singleSelection = maxSelection === 1;

  return (
    <div className={cn("grid gap-2", className)}>
      <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
        <span>
          从收藏公司与自选股选择
          {maxSelection ? (
            <span className="ml-2 text-xs text-[var(--app-text-soft)]">
              已选 {selectedCodes.size}/{maxSelection}
            </span>
          ) : null}
        </span>
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          className="app-input"
          placeholder="筛选公司、代码或自选股名称"
        />
      </label>

      <div className="max-h-[280px] overflow-auto border border-[var(--app-border-soft)] bg-[var(--app-surface)]">
        {candidatesQuery.isLoading ? (
          <div className="p-4 text-sm text-[var(--app-text-muted)]">
            正在读取收藏与自选股...
          </div>
        ) : candidatesQuery.isError ? (
          <div className="p-4">
            <InlineNotice
              tone="danger"
              description={candidatesQuery.error.message}
            />
          </div>
        ) : options.length === 0 ? (
          <div className="p-4 text-sm leading-6 text-[var(--app-text-muted)]">
            暂无收藏公司或自选股成员。
          </div>
        ) : visibleOptions.length === 0 ? (
          <div className="p-4 text-sm text-[var(--app-text-muted)]">
            没有匹配的收藏股票。
          </div>
        ) : (
          <div className="divide-y divide-[var(--app-border-soft)]">
            {visibleOptions.map((option) => {
              const selected = selectedCodes.has(option.stockCode);
              const disabled = !singleSelection && !selected && limitReached;
              return (
                <label
                  key={option.stockCode}
                  className={cn(
                    "grid grid-cols-[20px_minmax(0,1fr)] gap-3 px-4 py-3 text-sm transition-colors",
                    disabled
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-pointer hover:bg-[var(--app-panel-soft)]",
                  )}
                >
                  <input
                    type={singleSelection ? "radio" : "checkbox"}
                    name={singleSelection ? radioGroupName : undefined}
                    checked={selected}
                    disabled={disabled}
                    onChange={() => onToggleStock(option)}
                    className="mt-0.5 h-4 w-4 accent-[var(--app-primary)]"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-medium text-[var(--app-text-strong)]">
                        {option.stockName}
                      </span>
                      <span className="font-mono text-xs text-[var(--app-text-subtle)]">
                        {option.stockCode}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-xs text-[var(--app-text-muted)]">
                      {option.sources.join("；")}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

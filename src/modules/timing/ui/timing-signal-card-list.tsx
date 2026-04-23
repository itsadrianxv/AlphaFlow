"use client";

import Link from "next/link";
/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React from "react";
import { StatusPill } from "~/shared/ui/primitives/ui";

type SignalIndicators = {
  rsi?: { value: number };
  macd?: { histogram: number };
  volumeRatio20?: number;
};

export type TimingSignalCardListItem = {
  id: string;
  stockCode: string;
  stockName: string;
  actionBias: string;
  sourceType: string;
  summary: string;
  confidence: number;
  createdAt?: Date | null;
  riskFlags?: string[];
  signalSnapshot?: {
    asOfDate?: string;
    indicators?: SignalIndicators;
  };
};

const actionToneMap: Record<
  string,
  "neutral" | "info" | "success" | "warning"
> = {
  WATCH: "neutral",
  PROBE: "warning",
  ADD: "success",
  HOLD: "info",
  TRIM: "warning",
  EXIT: "warning",
};

const actionLabelMap: Record<string, string> = {
  WATCH: "观察",
  PROBE: "试仓",
  ADD: "加仓",
  HOLD: "持有",
  TRIM: "减仓",
  EXIT: "退出",
};

const sourceLabelMap: Record<string, string> = {
  single: "单股",
  watchlist: "自选股",
  screening: "筛选联动",
};

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

export function TimingSignalCardList(props: {
  cards: TimingSignalCardListItem[];
}) {
  const { cards } = props;

  return (
    <div className="grid gap-4">
      {cards.map((card) => {
        const indicators = card.signalSnapshot?.indicators;

        return (
          <article
            key={card.id}
            className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-lg font-semibold text-[var(--app-text)]">
                    {card.stockName}
                  </h3>
                  <span className="text-sm text-[var(--app-text-soft)]">
                    {card.stockCode}
                  </span>
                  <StatusPill
                    label={actionLabelMap[card.actionBias] ?? card.actionBias}
                    tone={actionToneMap[card.actionBias] ?? "neutral"}
                  />
                  <StatusPill
                    label={sourceLabelMap[card.sourceType] ?? card.sourceType}
                    tone="info"
                  />
                </div>
                <p className="mt-3 max-w-4xl text-sm leading-6 text-[var(--app-text-muted)]">
                  {card.summary}
                </p>
              </div>
              <div className="flex min-w-[180px] flex-col items-end gap-2 text-right text-xs text-[var(--app-text-soft)]">
                <p>写入时间 {formatDate(card.createdAt)}</p>
                <p>信号日期 {card.signalSnapshot?.asOfDate ?? "-"}</p>
                <Link
                  href={`/timing/reports/${card.id}`}
                  className="inline-flex min-h-9 items-center rounded-[10px] border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-text)] transition-colors hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-strong)]"
                >
                  查看报告
                </Link>
              </div>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-4">
              <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-3">
                <div className="text-xs text-[var(--app-text-soft)]">
                  置信度
                </div>
                <div className="mt-2 text-xl text-[var(--app-text)]">
                  {card.confidence}
                </div>
              </div>
              <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-3">
                <div className="text-xs text-[var(--app-text-soft)]">RSI</div>
                <div className="mt-2 text-xl text-[var(--app-text)]">
                  {indicators?.rsi?.value?.toFixed(1) ?? "-"}
                </div>
              </div>
              <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-3">
                <div className="text-xs text-[var(--app-text-soft)]">
                  MACD 柱值
                </div>
                <div className="mt-2 text-xl text-[var(--app-text)]">
                  {indicators?.macd?.histogram?.toFixed(2) ?? "-"}
                </div>
              </div>
              <div className="rounded-[10px] border border-[var(--app-border)] bg-[var(--app-panel-soft)] px-4 py-3">
                <div className="text-xs text-[var(--app-text-soft)]">
                  量比 20D
                </div>
                <div className="mt-2 text-xl text-[var(--app-text)]">
                  {indicators?.volumeRatio20?.toFixed(2) ?? "-"}
                </div>
              </div>
            </div>

            {card.riskFlags && card.riskFlags.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {card.riskFlags.map((flag) => (
                  <StatusPill key={flag} label={flag} tone="warning" />
                ))}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

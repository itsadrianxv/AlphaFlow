"use client";

import Link from "next/link";
import { InlineNotice, SectionCard } from "~/app/_components/ui";
import {
  buildMarketContextHref,
  findMatchingHotThemes,
  type MarketContextSectionTarget,
} from "~/app/market-context/market-context-links";
import type { MarketContextSnapshot } from "~/contracts/market-context";
import { api } from "~/trpc/react";

const actionLabelMap: Record<MarketContextSectionTarget, string> = {
  home: "发起行业研究",
  workflows: "发起行业研究",
  companyResearch: "打开公司研究",
  screening: "导入种子池",
  timing: "打开择时",
};

function uniqueHotThemes(hotThemes: MarketContextSnapshot["hotThemes"]) {
  const seenBoardCodes = new Set<string>();
  return hotThemes.filter((theme) => {
    if (seenBoardCodes.has(theme.marketEvidence.boardCode)) {
      return false;
    }
    seenBoardCodes.add(theme.marketEvidence.boardCode);
    return true;
  });
}

function removeHeatText(text: string) {
  return text
    .replace(/[，,]?\s*热度\s*[\d,.]+\s*[；;]?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function MarketContextSection(props: {
  section: MarketContextSectionTarget;
  currentStockCodes?: string[];
}) {
  const { section, currentStockCodes = [] } = props;
  const snapshotQuery = api.marketContext.getSnapshot.useQuery(
    {},
    {
      refetchOnWindowFocus: false,
    },
  );

  if (snapshotQuery.isLoading) {
    return (
      <SectionCard
        title="宏观分析"
        description="正在读取宏观慢变量、资金方向和热门主题。"
        className="!rounded-none !border-0 !bg-transparent !shadow-none"
      >
        <div className="text-sm leading-6 text-[var(--app-text-muted)]">
          正在整理当前市场环境。
        </div>
      </SectionCard>
    );
  }

  if (snapshotQuery.isError || !snapshotQuery.data) {
    return (
      <SectionCard
        title="宏观分析"
        description="当前未能获取完整宏观分析。"
        className="!rounded-none !border-0 !bg-transparent !shadow-none"
      >
        <InlineNotice
          tone="warning"
          description={snapshotQuery.error?.message ?? "宏观分析暂不可用。"}
        />
      </SectionCard>
    );
  }

  const snapshot = snapshotQuery.data;
  const hotThemes = uniqueHotThemes(snapshot.hotThemes).slice(0, 5);
  const matchedThemes = findMatchingHotThemes(hotThemes, currentStockCodes);

  return (
    <SectionCard
      title="宏观分析"
      className="!rounded-none !border-0 !bg-transparent !shadow-none"
    >
      <div className="grid gap-4">
        {matchedThemes.length > 0 ? (
          <InlineNotice
            tone="info"
            description={`当前选择命中热门主题：${matchedThemes.join("、")}。`}
          />
        ) : null}

        {hotThemes.length === 0 ? (
          <InlineNotice
            tone="warning"
            description="当前没有可用的热门主题结果。"
          />
        ) : (
          <div className="grid gap-3 xl:grid-cols-3">
            {hotThemes.map((theme) => (
              <div
                key={theme.theme}
                className="rounded-lg border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg leading-7 text-[var(--app-text-strong)]">
                      {theme.theme}
                    </div>
                  </div>
                </div>
                {removeHeatText(theme.whyHot) ? (
                  <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                    {removeHeatText(theme.whyHot)}
                  </p>
                ) : null}
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs leading-5 text-[var(--app-text-subtle)]">
                  <span>成分股 {theme.marketEvidence.constituentCount}</span>
                  <span>
                    换手{" "}
                    {theme.marketEvidence.latestTurnoverRate?.toFixed(2) ?? "-"}
                    %
                  </span>
                  <span>连板 {theme.marketEvidence.continuationCount}</span>
                  <span>涨停 {theme.marketEvidence.limitUpCount}</span>
                </div>
                <div className="mt-3 text-xs leading-5 text-[var(--app-text-subtle)]">
                  候选股：
                  {theme.candidateStocks.length > 0
                    ? ` ${theme.candidateStocks
                        .slice(0, 3)
                        .map((item) => item.stockName)
                        .join("、")}`
                    : " 暂无"}
                </div>
                <div className="mt-4">
                  <Link
                    href={buildMarketContextHref({
                      section,
                      theme,
                      snapshot,
                    })}
                    className="app-button app-button-primary"
                  >
                    {actionLabelMap[section]}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </SectionCard>
  );
}

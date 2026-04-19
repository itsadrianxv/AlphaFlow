"use client";

import Link from "next/link";
import { InlineNotice, SectionCard, StatusPill } from "~/app/_components/ui";
import { api } from "~/trpc/react";

function formatAsOf(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

const stageLabelMap = {
  warming: "观察中",
  catalyst: "催化增强",
  expanding: "扩散中",
  near_realization: "兑现更近",
  validating: "验证中",
  cooling: "先别追",
} as const;

const stageToneMap = {
  warming: "neutral",
  catalyst: "info",
  expanding: "info",
  near_realization: "success",
  validating: "warning",
  cooling: "warning",
} as const;

export function OpportunityIntelligenceSummary(props: { limit?: 2 | 3 }) {
  const { limit = 3 } = props;
  const summaryQuery = api.opportunityIntelligence.getSummary.useQuery(
    { limit },
    {
      refetchOnWindowFocus: false,
    },
  );

  if (summaryQuery.isLoading) {
    return (
      <SectionCard
        title="机会研判"
        description="正在整理今天更值得先研究的机会线索。"
        actions={
          <Link href="/opportunity-intelligence" className="app-button">
            打开机会研判
          </Link>
        }
      >
        <div className="text-sm leading-6 text-[var(--app-text-muted)]">
          正在读取市场主线与个性化命中。
        </div>
      </SectionCard>
    );
  }

  if (summaryQuery.isError || !summaryQuery.data) {
    return (
      <SectionCard
        title="机会研判"
        description="当前未能整理完整机会线索。"
        actions={
          <Link href="/opportunity-intelligence" className="app-button">
            打开机会研判
          </Link>
        }
      >
        <InlineNotice
          tone="warning"
          description={summaryQuery.error?.message ?? "机会研判暂不可用。"}
        />
      </SectionCard>
    );
  }

  const summary = summaryQuery.data;

  return (
    <SectionCard
      title="机会研判"
      description="从市场噪音里筛出更值得继续研究的机会线索。"
      actions={
        <Link
          href={summary.leads[0]?.href ?? "/opportunity-intelligence"}
          className="app-button app-button-primary"
        >
          打开机会研判
        </Link>
      }
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <StatusPill
            label={summary.status === "partial" ? "部分数据" : "机会线索"}
            tone={summary.status === "partial" ? "warning" : "info"}
          />
          <StatusPill
            label={`截至 ${formatAsOf(summary.asOf)}`}
            tone="neutral"
          />
          {summary.personalizationHitCount > 0 ? (
            <StatusPill
              label={`命中 ${summary.personalizationHitCount} 条个性化线索`}
              tone="success"
            />
          ) : null}
        </div>

        <div className="grid gap-3 xl:grid-cols-3">
          {summary.leads.map((lead) => (
            <Link
              key={lead.slug}
              href={lead.href}
              className="rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-4 transition-colors hover:border-[var(--app-border-strong)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-medium text-[var(--app-text-strong)]">
                  {lead.title}
                </div>
                <StatusPill
                  label={stageLabelMap[lead.stage]}
                  tone={stageToneMap[lead.stage]}
                />
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                {lead.whyNow}
              </p>
              {lead.whyRecommendedForYou ? (
                <div className="mt-3 text-xs leading-5 text-[var(--app-text-subtle)]">
                  {lead.whyRecommendedForYou}
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

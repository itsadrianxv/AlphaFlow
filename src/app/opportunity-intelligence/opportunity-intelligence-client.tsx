"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ActionStrip,
  EmptyState,
  InlineNotice,
  SectionCard,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { formatOpportunityAsOf } from "~/app/opportunity-intelligence/format-as-of";
import { buildOpportunityLeadActionLinks } from "~/app/opportunity-intelligence/opportunity-intelligence-links";
import type { OpportunityLead } from "~/contracts/opportunity-intelligence";
import { api } from "~/trpc/react";

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

function formatAsOf(value: string) {
  return formatOpportunityAsOf(value);
}

function LeadCard(props: {
  lead: OpportunityLead;
  expanded: boolean;
  onToggle: () => void;
  featured?: boolean;
}) {
  const { lead, expanded, onToggle, featured = false } = props;
  const links = buildOpportunityLeadActionLinks(lead);

  return (
    <article
      className={`rounded-[16px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-5 ${
        featured ? "shadow-[var(--app-shadow-sm)]" : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              label={stageLabelMap[lead.stage]}
              tone={stageToneMap[lead.stage]}
            />
            <StatusPill
              label={`热度 ${lead.heatScore.toFixed(0)}`}
              tone="neutral"
            />
          </div>
          <div className="mt-3 text-xl leading-8 text-[var(--app-text-strong)]">
            {lead.title}
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
            {lead.whyNow}
          </p>
          {lead.whyRecommendedForYou ? (
            <p className="mt-2 text-xs leading-5 text-[var(--app-text-subtle)]">
              {lead.whyRecommendedForYou}
            </p>
          ) : null}
        </div>
        <button type="button" onClick={onToggle} className="app-button">
          {expanded ? "收起" : "展开"}
        </button>
      </div>

      {expanded ? (
        <div className="mt-5 grid gap-4 border-t border-[var(--app-border-soft)] pt-5 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="grid gap-4">
            <div>
              <div className="text-xs tracking-[0.08em] text-[var(--app-text-subtle)]">
                线索判断
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                {lead.whyRanked}
              </p>
            </div>
            <div>
              <div className="text-xs tracking-[0.08em] text-[var(--app-text-subtle)]">
                催化与阶段
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                {lead.catalystSummary}
              </p>
            </div>
            <div>
              <div className="text-xs tracking-[0.08em] text-[var(--app-text-subtle)]">
                兑现路径
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                {lead.realizationPath}
              </p>
            </div>
            <div>
              <div className="text-xs tracking-[0.08em] text-[var(--app-text-subtle)]">
                优先研究环节
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {lead.prioritySegments.map((item) => (
                  <StatusPill key={item} label={item} tone="info" />
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4">
            <div>
              <div className="text-xs tracking-[0.08em] text-[var(--app-text-subtle)]">
                候选标的
              </div>
              <div className="mt-2 grid gap-2">
                {lead.candidateStocks.slice(0, 3).map((stock) => (
                  <div
                    key={stock.stockCode}
                    className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-3 py-2 text-sm leading-6 text-[var(--app-text-muted)]"
                  >
                    {stock.stockName} / {stock.stockCode}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={links.workflowsHref}
                className="app-button app-button-primary"
              >
                进入主题研究
              </Link>
              <Link href={links.screeningHref} className="app-button">
                生成候选池
              </Link>
              <Link href={links.companyResearchHref} className="app-button">
                发起公司研究
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function OpportunityIntelligenceClient() {
  const searchParams = useSearchParams();
  const feedQuery = api.opportunityIntelligence.getFeed.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const leadParam = searchParams.get("lead");
  const [expandedLeadSlug, setExpandedLeadSlug] = useState<string | null>(
    leadParam,
  );

  useEffect(() => {
    if (leadParam) {
      setExpandedLeadSlug(leadParam);
      return;
    }

    if (!expandedLeadSlug && feedQuery.data?.todayTopLeads[0]?.slug) {
      setExpandedLeadSlug(feedQuery.data.todayTopLeads[0].slug);
    }
  }, [expandedLeadSlug, feedQuery.data?.todayTopLeads, leadParam]);

  return (
    <WorkspaceShell
      section="opportunityIntelligence"
      title="机会研判"
      description="先判断现在最值得研究什么，再把动作送进筛选、公司研究和后续执行。"
      actions={
        <>
          <Link href="/" className="app-button">
            返回概览
          </Link>
          <Link href="/workflows" className="app-button">
            行业研究
          </Link>
          <Link href="/screening" className="app-button">
            股票筛选
          </Link>
        </>
      }
    >
      {feedQuery.isLoading ? (
        <SectionCard
          title="机会研判"
          description="正在整理今天的优先研究线索。"
        >
          <div className="text-sm leading-6 text-[var(--app-text-muted)]">
            正在读取市场主线、候选股和个性化命中。
          </div>
        </SectionCard>
      ) : feedQuery.isError || !feedQuery.data ? (
        <SectionCard title="机会研判" description="当前未能整理完整机会线索。">
          <InlineNotice
            tone="warning"
            description={feedQuery.error?.message ?? "机会研判暂不可用。"}
          />
        </SectionCard>
      ) : (
        <>
          <ActionStrip
            title={feedQuery.data.marketSummary.todayConclusion}
            description={`截至 ${formatAsOf(feedQuery.data.asOf)}，${feedQuery.data.marketSummary.regimeSummary}`}
            tone={feedQuery.data.status === "partial" ? "warning" : "info"}
          />

          <div className="grid gap-4 xl:grid-cols-3">
            <SectionCard
              title="今日结论"
              description={feedQuery.data.marketSummary.flowSummary}
            >
              <div className="flex flex-wrap gap-2">
                <StatusPill
                  label={`最近研究命中 ${feedQuery.data.personalization.recentResearchMatchCount}`}
                  tone="info"
                />
                <StatusPill
                  label={`自选命中 ${feedQuery.data.personalization.watchlistMatchCount}`}
                  tone="success"
                />
                <StatusPill
                  label={`持仓命中 ${feedQuery.data.personalization.portfolioMatchCount}`}
                  tone="neutral"
                />
              </div>
            </SectionCard>
            <SectionCard
              title="市场状态"
              description={feedQuery.data.marketSummary.regimeSummary}
            >
              <div className="text-sm leading-6 text-[var(--app-text-muted)]">
                {feedQuery.data.marketSummary.flowSummary}
              </div>
            </SectionCard>
            <SectionCard title="风险回避" description="先不追的高热线索。">
              {feedQuery.data.avoidanceItems.length === 0 ? (
                <div className="text-sm leading-6 text-[var(--app-text-muted)]">
                  当前没有明显需要回避的高热线索。
                </div>
              ) : (
                <div className="grid gap-3">
                  {feedQuery.data.avoidanceItems.map((item) => (
                    <div
                      key={item.slug}
                      className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-3"
                    >
                      <div className="text-sm font-medium text-[var(--app-text-strong)]">
                        {item.title}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                        {item.reason}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          <SectionCard
            title="今日优先级 4 条"
            description="先判断哪条线索更值得优先研究。"
          >
            {feedQuery.data.todayTopLeads.length === 0 ? (
              <EmptyState title="当前没有可用机会线索" />
            ) : (
              <div className="grid gap-4">
                {feedQuery.data.todayTopLeads.map((lead, index) => (
                  <LeadCard
                    key={lead.slug}
                    lead={lead}
                    featured={index === 0}
                    expanded={expandedLeadSlug === lead.slug}
                    onToggle={() =>
                      setExpandedLeadSlug((current) =>
                        current === lead.slug ? null : lead.slug,
                      )
                    }
                  />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="持续追踪池"
            description="这段时间仍值得跟踪的研究线索。"
          >
            {feedQuery.data.trackingLeads.length === 0 ? (
              <EmptyState title="持续追踪池还没有线索" />
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {feedQuery.data.trackingLeads.map((lead) => (
                  <LeadCard
                    key={lead.slug}
                    lead={lead}
                    expanded={expandedLeadSlug === lead.slug}
                    onToggle={() =>
                      setExpandedLeadSlug((current) =>
                        current === lead.slug ? null : lead.slug,
                      )
                    }
                  />
                ))}
              </div>
            )}
          </SectionCard>
        </>
      )}
    </WorkspaceShell>
  );
}

"use client";

import Link from "next/link";
/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React, { useState } from "react";

import { MarkdownContent } from "~/app/_components/markdown-content";
import { Panel, StatusPill } from "~/app/_components/ui";
import { WorkflowStageSwitcher } from "~/app/_components/workflow-stage-switcher";
import type {
  IndustryConclusionClaim,
  IndustryConclusionSectionId,
  IndustryConclusionViewModel,
} from "~/app/workflows/[runId]/industry-conclusion-view-model";
import { formatRuntimeIssueLabel } from "~/app/workflows/detail-labels";

export type { IndustryConclusionViewModel } from "~/app/workflows/[runId]/industry-conclusion-view-model";

function toneClasses(tone: string) {
  if (tone === "success") {
    return "border-[var(--app-success-border)] bg-[var(--app-success-surface)] text-[var(--app-text-strong)]";
  }
  if (tone === "warning") {
    return "border-[var(--app-warning-border)] bg-[var(--app-warning-surface)] text-[var(--app-text-strong)]";
  }
  if (tone === "danger") {
    return "border-[var(--app-danger-border)] bg-[var(--app-danger-surface)] text-[var(--app-danger)]";
  }
  return "border-[var(--app-info-border)] bg-[var(--app-info-surface)] text-[var(--app-text-strong)]";
}

function DetailList(props: { items: string[]; emptyText: string }) {
  if (props.items.length === 0) {
    return (
      <p className="text-sm leading-7 text-[var(--app-text-subtle)]">
        {props.emptyText}
      </p>
    );
  }

  return (
    <ul className="grid gap-0">
      {props.items.map((item, index) => (
        <li
          key={`${item}-${index + 1}`}
          className="border-b border-[var(--app-border-soft)] py-2.5 text-sm leading-6 text-[var(--app-text-muted)] last:border-b-0"
        >
          <MarkdownContent content={item} compact />
        </li>
      ))}
    </ul>
  );
}

function ActionLinks(props: { model: IndustryConclusionViewModel }) {
  const formatActionLabel = (label: string) =>
    label
      .replaceAll("Space", "研究空间")
      .replaceAll("Report", "报告")
      .replaceAll("Debug", "调试");

  return (
    <div className="flex flex-wrap gap-2">
      {props.model.overviewActions.map((action) => (
        <Link
          key={`${action.label}-${action.href}`}
          href={action.href}
          className={
            action.variant === "primary"
              ? "app-button app-button-primary"
              : "app-button"
          }
        >
          {formatActionLabel(action.label)}
        </Link>
      ))}
    </div>
  );
}

function NoticeList(props: { model: IndustryConclusionViewModel }) {
  if (props.model.notices.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {props.model.notices.map((notice, index) => (
        <div
          key={`${notice.title}-${index + 1}`}
          className={`rounded-[12px] border px-4 py-3 ${toneClasses(notice.tone)}`}
        >
          <div className="text-sm font-medium text-[var(--app-text-strong)]">
            {notice.title}
          </div>
          <MarkdownContent
            content={notice.description}
            compact
            className="mt-2"
          />
          {notice.actions.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {notice.actions.map((action) => (
                <Link
                  key={`${action.label}-${action.href}`}
                  href={action.href}
                  className="app-button"
                >
                  {action.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function MetricStrip(props: { model: IndustryConclusionViewModel }) {
  return (
    <dl className="grid border-y border-[var(--app-border-soft)] sm:grid-cols-2 xl:grid-cols-5">
      {props.model.metricStrip.map((metric, index) => (
        <div
          key={`${metric.label}-${metric.value}`}
          className={`py-3 ${index > 0 ? "border-t border-[var(--app-border-soft)] sm:border-t-0 sm:border-l sm:px-4" : "sm:pr-4"} ${index === 0 ? "" : "px-0"}`}
        >
          <dt className="text-xs text-[var(--app-text-subtle)]">
            {metric.label}
          </dt>
          <dd className="app-data mt-1.5 text-2xl leading-none text-[var(--app-text-strong)]">
            {metric.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type ClaimCategoryId = "insufficient" | "supported" | "contradicted";

const claimCategories: Array<{
  id: ClaimCategoryId;
  label: string;
}> = [
  { id: "insufficient", label: "证据不足" },
  { id: "supported", label: "证据支持" },
  { id: "contradicted", label: "存在冲突" },
];

function ClaimList(props: { claims: IndustryConclusionClaim[] }) {
  if (props.claims.length === 0) {
    return (
      <p className="py-3 text-sm leading-6 text-[var(--app-text-subtle)]">
        当前分类暂无断言。
      </p>
    );
  }

  return (
    <div className="grid gap-0">
      {props.claims.map((item) => (
        <div
          key={item.claimId}
          className="border-b border-[var(--app-border-soft)] py-3 last:border-b-0"
        >
          <p className="text-sm leading-6 text-[var(--app-text-strong)]">
            {item.claimText}
          </p>
          <MarkdownContent
            content={item.explanation}
            compact
            className="mt-2"
          />
        </div>
      ))}
    </div>
  );
}

function ClaimPanel(props: { claims: IndustryConclusionClaim[] }) {
  const [expanded, setExpanded] = useState(false);
  const [activeCategoryId, setActiveCategoryId] =
    useState<ClaimCategoryId>("insufficient");
  const activeClaims = props.claims.filter(
    (claim) => claim.label === activeCategoryId,
  );

  return (
    <Panel
      title="结论断言"
      surface="inset"
      density="compact"
      actions={
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="app-button"
        >
          {expanded ? "收起" : "展开"}
        </button>
      }
    >
      {expanded ? (
        props.claims.length === 0 ? (
          <p className="text-sm leading-6 text-[var(--app-text-subtle)]">
            暂无结构化断言。
          </p>
        ) : (
          <div className="grid gap-3">
            <div className="flex flex-wrap gap-2">
              {claimCategories.map((category) => {
                const active = category.id === activeCategoryId;
                const count = props.claims.filter(
                  (claim) => claim.label === category.id,
                ).length;

                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => setActiveCategoryId(category.id)}
                    className={
                      active
                        ? "rounded-[10px] border border-[var(--app-border-strong)] bg-[var(--app-panel-strong)] px-3 py-2 text-sm text-[var(--app-text-strong)]"
                        : "rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-3 py-2 text-sm text-[var(--app-text-muted)] transition-colors hover:border-[var(--app-border-strong)] hover:text-[var(--app-text-strong)]"
                    }
                  >
                    {category.label} {count}
                  </button>
                );
              })}
            </div>
            <ClaimList claims={activeClaims} />
          </div>
        )
      ) : null}
    </Panel>
  );
}

function OverviewSection(props: { model: IndustryConclusionViewModel }) {
  return (
    <div className="grid gap-4">
      <Panel title="摘要总览" surface="inset" density="compact">
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill
              label={props.model.verdictLabel}
              tone={props.model.verdictTone}
            />
            <StatusPill label={props.model.statusLabel} tone="info" />
            <StatusPill
              label={`生成于 ${props.model.generatedAtLabel}`}
              tone="neutral"
            />
            {props.model.modePills.map((item) => (
              <StatusPill key={item} label={item} tone="info" />
            ))}
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
            <div className="min-w-0">
              <div className="text-sm text-[var(--app-text-muted)]">
                {props.model.query || "行业研究结论"}
              </div>
              <h2 className="mt-1.5 font-[family-name:var(--font-heading)] text-2xl leading-tight text-[var(--app-text-strong)] sm:text-[28px]">
                {props.model.headline}
              </h2>
              <MarkdownContent
                content={props.model.summary}
                compact
                className="mt-3 max-w-4xl"
              />
            </div>
            <div className="xl:justify-self-end">
              <ActionLinks model={props.model} />
            </div>
          </div>

          <MetricStrip model={props.model} />
        </div>
      </Panel>

      <NoticeList model={props.model} />

      <Panel title="摘要要点" surface="inset" density="compact">
        <DetailList
          items={props.model.overviewPoints}
          emptyText="暂无额外摘要。"
        />
      </Panel>
    </div>
  );
}

function LogicSection(props: { model: IndustryConclusionViewModel }) {
  return (
    <div className="grid gap-4">
      {props.model.logic.fullReportMarkdown ? (
        <Panel title="研究正文" surface="inset" density="compact">
          <MarkdownContent content={props.model.logic.fullReportMarkdown} />
        </Panel>
      ) : null}

      <Panel title="行业驱动" surface="inset" density="compact">
        <DetailList
          items={props.model.logic.industryDrivers}
          emptyText="暂无结构化行业驱动。"
        />
      </Panel>

      <Panel title="竞争格局" surface="inset" density="compact">
        <MarkdownContent
          content={props.model.logic.competitionSummary}
          compact
        />
      </Panel>

      <Panel title="重点标的" surface="inset" density="compact">
        {props.model.logic.topPicks.length === 0 ? (
          <p className="text-sm leading-7 text-[var(--app-text-subtle)]">
            暂无足够相关标的。
          </p>
        ) : (
          <div className="grid gap-0">
            {props.model.logic.topPicks.map((item) => (
              <div
                key={`${item.stockCode}-${item.stockName}`}
                className="grid gap-3 border-b border-[var(--app-border-soft)] py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div>
                  <div className="font-[family-name:var(--font-heading)] text-base leading-none text-[var(--app-text-strong)]">
                    {item.stockName}
                  </div>
                  <div className="mt-1.5 text-xs text-[var(--app-text-subtle)]">
                    {item.stockCode}
                  </div>
                  <MarkdownContent
                    content={item.reason}
                    compact
                    className="mt-2"
                  />
                </div>
                <div className="md:self-start">
                  <Link href={item.href} className="app-button">
                    进入公司判断
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function EvidenceSection(props: { model: IndustryConclusionViewModel }) {
  return (
    <div className="grid gap-4">
      <Panel title="证据校验" surface="inset" density="compact">
        <dl className="grid border-y border-[var(--app-border-soft)] sm:grid-cols-2 xl:grid-cols-4">
          <div className="border-b border-[var(--app-border-soft)] py-3 xl:border-r xl:border-b-0 xl:pr-4">
            <dt className="text-xs text-[var(--app-text-subtle)]">可信度</dt>
            <dd className="mt-1.5 font-[family-name:var(--font-data)] text-2xl leading-none text-[var(--app-text-strong)]">
              {props.model.evidence.scoreLabel}
            </dd>
          </div>
          <div className="border-b border-[var(--app-border-soft)] py-3 sm:border-l sm:px-4 xl:border-r xl:border-b-0">
            <dt className="text-xs text-[var(--app-text-subtle)]">等级</dt>
            <dd className="mt-1.5 font-[family-name:var(--font-data)] text-2xl leading-none text-[var(--app-text-strong)]">
              {props.model.evidence.levelLabel}
            </dd>
          </div>
          <div className="border-b border-[var(--app-border-soft)] py-3 xl:border-r xl:border-b-0 xl:px-4">
            <dt className="text-xs text-[var(--app-text-subtle)]">覆盖率</dt>
            <dd className="mt-1.5 font-[family-name:var(--font-data)] text-2xl leading-none text-[var(--app-text-strong)]">
              {props.model.evidence.coverageLabel}
            </dd>
          </div>
          <div className="py-3 sm:border-l sm:px-4 xl:border-l-0">
            <dt className="text-xs text-[var(--app-text-subtle)]">
              支持/不足/冲突
            </dt>
            <dd className="mt-1.5 font-[family-name:var(--font-data)] text-2xl leading-none text-[var(--app-text-strong)]">
              {props.model.evidence.tripletLabel}
            </dd>
          </div>
        </dl>
      </Panel>

      {props.model.evidence.qualityFlags.length > 0 ||
      props.model.evidence.missingRequirements.length > 0 ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="质量标记" surface="inset" density="compact">
            <DetailList
              items={props.model.evidence.qualityFlags.map((item) =>
                formatRuntimeIssueLabel(item),
              )}
              emptyText="暂无质量标记。"
            />
          </Panel>
          <Panel title="待补要求" surface="inset" density="compact">
            <DetailList
              items={props.model.evidence.missingRequirements.map((item) =>
                formatRuntimeIssueLabel(item),
              )}
              emptyText="暂无待补要求。"
            />
          </Panel>
        </div>
      ) : null}

      <ClaimPanel claims={props.model.evidence.claims} />
    </div>
  );
}

function RisksSection(props: { model: IndustryConclusionViewModel }) {
  return (
    <div className="grid gap-4">
      <Panel title="风险判断" surface="inset" density="compact">
        <MarkdownContent content={props.model.risks.summary} compact />
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div>
            <div className="mb-3 text-sm font-medium text-[var(--app-text-strong)]">
              缺口
            </div>
            <DetailList
              items={props.model.risks.missingAreas}
              emptyText="暂无结构化缺口。"
            />
          </div>
          <div>
            <div className="mb-3 text-sm font-medium text-[var(--app-text-strong)]">
              风险信号
            </div>
            <DetailList
              items={props.model.risks.riskSignals}
              emptyText="暂无额外风险信号。"
            />
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="待回答问题" surface="inset" density="compact">
          <DetailList
            items={props.model.risks.unansweredQuestions}
            emptyText="暂无待回答问题。"
          />
        </Panel>
        <Panel title="下一步动作" surface="inset" density="compact">
          <DetailList
            items={props.model.risks.nextActions}
            emptyText="暂无后续动作。"
          />
        </Panel>
      </div>
    </div>
  );
}

export function IndustryConclusionDetail(props: {
  model: IndustryConclusionViewModel;
  initialSectionId?: IndustryConclusionSectionId;
}) {
  const { model, initialSectionId } = props;
  const [activeSectionId, setActiveSectionId] =
    useState<IndustryConclusionSectionId>(
      initialSectionId ?? model.activeSectionId,
    );

  return (
    <div
      data-industry-conclusion-detail="true"
      data-active-section={activeSectionId}
      className="grid gap-4"
    >
      <WorkflowStageSwitcher
        tabs={model.sections}
        activeTabId={activeSectionId}
        onChange={(sectionId) =>
          setActiveSectionId(sectionId as IndustryConclusionSectionId)
        }
        panels={{
          overview: <OverviewSection model={model} />,
          logic: <LogicSection model={model} />,
          evidence: <EvidenceSection model={model} />,
          risks: <RisksSection model={model} />,
        }}
      />
    </div>
  );
}

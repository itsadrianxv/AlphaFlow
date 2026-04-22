"use client";

import Link from "next/link";
/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React, { type ReactNode, useState } from "react";

import { MarkdownContent } from "~/app/_components/markdown-content";
import { StatusPill } from "~/app/_components/ui";
import type { WorkflowStageTab } from "~/app/_components/workflow-stage-config";
import { WorkflowStageSwitcher } from "~/app/_components/workflow-stage-switcher";
import type {
  IndustryConclusionSectionId,
  IndustryConclusionViewModel,
} from "~/app/workflows/[runId]/industry-conclusion-view-model";
import {
  formatClaimLabel,
  formatResearchCapabilityLabel,
  formatResearchStatusLabel,
  formatRuntimeIssueLabel,
} from "~/app/workflows/detail-labels";
import { WorkflowAgentStep } from "~/app/workflows/workflow-agent-step";
import type { WorkflowDiagramRunDetail } from "~/app/workflows/workflow-diagram-runtime";

export type { IndustryConclusionViewModel } from "~/app/workflows/[runId]/industry-conclusion-view-model";

const industryConclusionTabs: Array<
  WorkflowStageTab & { id: "agent" | IndustryConclusionSectionId }
> = [
  {
    id: "agent",
    label: "Agent 鐘舵€佸浘",
    summary: "先看 Agent 状态图、运行摘要和研究执行状态。",
  },
  {
    id: "overview",
    label: "鎬昏",
    summary: "缁撹銆佹憳瑕併€佸姩浣?",
  },
  {
    id: "logic",
    label: "鏍稿績閫昏緫",
    summary: "琛屼笟椹卞姩涓庨噸鐐规爣鐨?",
  },
  {
    id: "evidence",
    label: "璇佹嵁涓庡彲淇″害",
    summary: "鏀寔/涓嶈冻/鍐茬獊",
  },
  {
    id: "risks",
    label: "椋庨櫓涓庝笅涓€姝?",
    summary: "缂哄彛銆佸弽渚嬪拰鍔ㄤ綔",
  },
];

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

function SectionHeading(props: { title: string; description?: ReactNode }) {
  return (
    <div className="border-b border-[var(--app-border-soft)] pb-4">
      <h3 className="font-[family-name:var(--font-heading)] text-[22px] leading-none text-[var(--app-text-strong)]">
        {props.title}
      </h3>
      {props.description ? (
        typeof props.description === "string" ||
        typeof props.description === "number" ? (
          <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--app-text-muted)]">
            {props.description}
          </p>
        ) : (
          <div className="mt-3 max-w-3xl text-sm leading-7 text-[var(--app-text-muted)]">
            {props.description}
          </div>
        )
      ) : null}
    </div>
  );
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
          className="border-b border-[var(--app-border-soft)] py-3 text-sm leading-7 text-[var(--app-text-muted)] last:border-b-0"
        >
          <MarkdownContent content={item} compact />
        </li>
      ))}
    </ul>
  );
}

function ActionLinks(props: { model: IndustryConclusionViewModel }) {
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
          {action.label.replace("Space", "鐮旂┒绌洪棿")}
        </Link>
      ))}
    </div>
  );
}

function OverviewSection(props: { model: IndustryConclusionViewModel }) {
  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
      <section className="grid gap-5">
        <SectionHeading
          title="鏈疆缁撹"
          description={
            <MarkdownContent content={props.model.summary} compact />
          }
        />
        <DetailList
          items={props.model.overviewPoints}
          emptyText="鏆傛棤棰濆鎽樿銆?"
        />
      </section>
      <section className="grid content-start gap-5 border-t border-[var(--app-border-soft)] pt-5 xl:border-t-0 xl:border-l xl:pl-6 xl:pt-0">
        <SectionHeading title="涓嬩竴姝?" />
        <ActionLinks model={props.model} />
      </section>
    </div>
  );
}

function LogicSection(props: { model: IndustryConclusionViewModel }) {
  return (
    <div className="grid gap-8">
      <section className="grid gap-5">
        <SectionHeading
          title="琛屼笟椹卞姩"
          description="鍏堣琛屼笟鍙樺寲銆佸厬鐜拌矾寰勫拰绔炰簤鏍煎眬锛屽啀钀藉埌鍏蜂綋鏍囩殑銆?"
        />
        <DetailList
          items={props.model.logic.industryDrivers}
          emptyText="鏆傛棤缁撴瀯鍖栬涓氶┍鍔ㄣ€?"
        />
      </section>

      <section className="grid gap-4 border-t border-[var(--app-border-soft)] pt-6">
        <SectionHeading title="绔炰簤鏍煎眬" />
        <MarkdownContent
          content={props.model.logic.competitionSummary}
          compact
        />
      </section>

      <section className="grid gap-4 border-t border-[var(--app-border-soft)] pt-6">
        <SectionHeading title="閲嶇偣鏍囩殑" />
        {props.model.logic.topPicks.length === 0 ? (
          <p className="text-sm leading-7 text-[var(--app-text-subtle)]">
            鏆傛棤閲嶇偣鏍囩殑銆?
          </p>
        ) : (
          <div className="grid gap-0">
            {props.model.logic.topPicks.map((item) => (
              <div
                key={`${item.stockCode}-${item.stockName}`}
                className="grid gap-3 border-b border-[var(--app-border-soft)] py-4 last:border-b-0 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div>
                  <div className="font-[family-name:var(--font-heading)] text-lg leading-none text-[var(--app-text-strong)]">
                    {item.stockName}
                  </div>
                  <div className="mt-2 text-xs tracking-[0.1em] text-[var(--app-text-subtle)]">
                    {item.stockCode}
                  </div>
                  <MarkdownContent
                    content={item.reason}
                    compact
                    className="mt-3"
                  />
                </div>
                <div className="md:self-start">
                  <Link href={item.href} className="app-button">
                    杩涘叆鍏徃鍒ゆ柇
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function EvidenceSection(props: { model: IndustryConclusionViewModel }) {
  return (
    <div className="grid gap-8">
      <section className="grid gap-5">
        <SectionHeading
          title="璇佹嵁鏍￠獙"
          description="鍏堢湅鏀寔/涓嶈冻/鍐茬獊鍜岃鐩栫巼锛屽啀鎸夐渶涓嬬湅鏂█涓庣爺绌跺崟鍏冦€?"
        />
        <dl className="grid border border-[var(--app-border-soft)] sm:grid-cols-2 xl:grid-cols-4">
          <div className="border-b border-[var(--app-border-soft)] px-4 py-4 xl:border-r xl:border-b-0">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--app-text-subtle)]">
              鍙俊搴?
            </dt>
            <dd className="mt-3 font-[family-name:var(--font-data)] text-[28px] leading-none text-[var(--app-text-strong)]">
              {props.model.evidence.scoreLabel}
            </dd>
          </div>
          <div className="border-b border-[var(--app-border-soft)] px-4 py-4 sm:border-l xl:border-r xl:border-b-0">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--app-text-subtle)]">
              绛夌骇
            </dt>
            <dd className="mt-3 font-[family-name:var(--font-data)] text-[28px] leading-none text-[var(--app-text-strong)]">
              {props.model.evidence.levelLabel}
            </dd>
          </div>
          <div className="border-b border-[var(--app-border-soft)] px-4 py-4 xl:border-r xl:border-b-0">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--app-text-subtle)]">
              瑕嗙洊鐜?
            </dt>
            <dd className="mt-3 font-[family-name:var(--font-data)] text-[28px] leading-none text-[var(--app-text-strong)]">
              {props.model.evidence.coverageLabel}
            </dd>
          </div>
          <div className="px-4 py-4 sm:border-l xl:border-l-0">
            <dt className="text-[11px] uppercase tracking-[0.14em] text-[var(--app-text-subtle)]">
              鏀寔/涓嶈冻/鍐茬獊
            </dt>
            <dd className="mt-3 font-[family-name:var(--font-data)] text-[28px] leading-none text-[var(--app-text-strong)]">
              {props.model.evidence.tripletLabel}
            </dd>
          </div>
        </dl>
      </section>

      <section className="grid gap-4 border-t border-[var(--app-border-soft)] pt-6">
        <SectionHeading title="鍙俊搴﹁鏄?" />
        <DetailList
          items={props.model.evidence.notes}
          emptyText="鏆傛棤鍙俊搴﹁鏄庛€?"
        />
      </section>

      {props.model.evidence.qualityFlags.length > 0 ||
      props.model.evidence.missingRequirements.length > 0 ? (
        <section className="grid gap-4 border-t border-[var(--app-border-soft)] pt-6 xl:grid-cols-2">
          <div className="grid gap-4">
            <SectionHeading title="璐ㄩ噺鏍囪" />
            <DetailList
              items={props.model.evidence.qualityFlags.map((item) =>
                formatRuntimeIssueLabel(item),
              )}
              emptyText="鏆傛棤璐ㄩ噺鏍囪銆?"
            />
          </div>
          <div className="grid gap-4">
            <SectionHeading title="寰呰ˉ瑕佹眰" />
            <DetailList
              items={props.model.evidence.missingRequirements.map((item) =>
                formatRuntimeIssueLabel(item),
              )}
              emptyText="鏆傛棤寰呰ˉ瑕佹眰銆?"
            />
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 border-t border-[var(--app-border-soft)] pt-6">
        <SectionHeading title="缁撹鏂█" />
        {props.model.evidence.claims.length === 0 ? (
          <p className="text-sm leading-7 text-[var(--app-text-subtle)]">
            鏆傛棤缁撴瀯鍖栨柇瑷€銆?
          </p>
        ) : (
          <div className="grid gap-0">
            {props.model.evidence.claims.map((item) => (
              <div
                key={item.claimId}
                className="border-b border-[var(--app-border-soft)] py-4 last:border-b-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill
                    label={formatClaimLabel(item.label)}
                    tone="info"
                  />
                </div>
                <p className="mt-3 text-sm leading-7 text-[var(--app-text-strong)]">
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
        )}
      </section>

      <section className="grid gap-4 border-t border-[var(--app-border-soft)] pt-6">
        <SectionHeading title="鐮旂┒鍗曞厓鎽樿" />
        {props.model.evidence.researchPlan.length === 0 ? (
          <p className="text-sm leading-7 text-[var(--app-text-subtle)]">
            鏆傛棤鐮旂┒鍗曞厓璁板綍銆?
          </p>
        ) : (
          <div className="grid gap-0">
            {props.model.evidence.researchPlan.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--app-border-soft)] py-4 last:border-b-0"
              >
                <div>
                  <div className="text-sm text-[var(--app-text-strong)]">
                    {item.title}
                  </div>
                  <div className="mt-1 text-xs tracking-[0.1em] text-[var(--app-text-subtle)]">
                    {formatResearchCapabilityLabel(item.capability)}
                  </div>
                </div>
                <StatusPill
                  label={formatResearchStatusLabel(item.status)}
                  tone="info"
                />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RisksSection(props: { model: IndustryConclusionViewModel }) {
  return (
    <div className="grid gap-8">
      <section className="grid gap-5">
        <SectionHeading
          title="椋庨櫓鍒ゆ柇"
          description={
            <MarkdownContent content={props.model.risks.summary} compact />
          }
        />
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="grid gap-4">
            <SectionHeading title="缂哄彛" />
            <DetailList
              items={props.model.risks.missingAreas}
              emptyText="鏆傛棤缁撴瀯鍖栫己鍙ｃ€?"
            />
          </div>
          <div className="grid gap-4">
            <SectionHeading title="椋庨櫓淇″彿" />
            <DetailList
              items={props.model.risks.riskSignals}
              emptyText="鏆傛棤棰濆椋庨櫓淇″彿銆?"
            />
          </div>
        </div>
      </section>

      <section className="grid gap-6 border-t border-[var(--app-border-soft)] pt-6 xl:grid-cols-2">
        <div className="grid gap-4">
          <SectionHeading title="寰呭洖绛旈棶棰?" />
          <DetailList
            items={props.model.risks.unansweredQuestions}
            emptyText="鏆傛棤寰呭洖绛旈棶棰樸€?"
          />
        </div>
        <div className="grid gap-4">
          <SectionHeading title="涓嬩竴姝ュ姩浣?" />
          <DetailList
            items={props.model.risks.nextActions}
            emptyText="鏆傛棤鍚庣画鍔ㄤ綔銆?"
          />
        </div>
      </section>
    </div>
  );
}

export function IndustryConclusionDetail(props: {
  model: IndustryConclusionViewModel;
  run?: WorkflowDiagramRunDetail | null;
  initialSectionId?: IndustryConclusionSectionId;
}) {
  const { model, initialSectionId } = props;
  const [activeSectionId, setActiveSectionId] = useState<
    "agent" | IndustryConclusionSectionId
  >(initialSectionId ?? "agent");

  return (
    <article
      data-industry-conclusion-detail="true"
      className="overflow-hidden border border-[var(--app-border-soft)] bg-[var(--app-surface)]"
    >
      <div className="border-b border-[var(--app-border-soft)] px-5 py-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label={model.verdictLabel} tone={model.verdictTone} />
          <StatusPill label={model.statusLabel} tone="info" />
          <StatusPill
            label={`鐢熸垚浜?${model.generatedAtLabel}`}
            tone="neutral"
          />
          {model.modePills.map((item) => (
            <StatusPill key={item} label={item} tone="info" />
          ))}
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div>
            <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--app-text-subtle)]">
              {model.query || "琛屼笟鐮旂┒缁撹"}
            </div>
            <h2 className="mt-3 font-[family-name:var(--font-heading)] text-[34px] leading-[0.96] text-[var(--app-text-strong)] sm:text-[42px]">
              {model.headline}
            </h2>
            <MarkdownContent
              content={model.summary}
              className="mt-4 max-w-4xl sm:text-base"
            />
          </div>
          <div className="xl:justify-self-end">
            <ActionLinks model={model} />
          </div>
        </div>
      </div>

      {model.notices.length > 0 ? (
        <div className="border-b border-[var(--app-border-soft)]">
          {model.notices.map((notice, index) => (
            <div
              key={`${notice.title}-${index + 1}`}
              className={`px-5 py-4 sm:px-6 ${toneClasses(notice.tone)} ${index > 0 ? "border-t border-[var(--app-border-soft)]" : ""}`}
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
      ) : null}

      <dl className="grid border-b border-[var(--app-border-soft)] sm:grid-cols-2 xl:grid-cols-5">
        {model.metricStrip.map((metric, index) => (
          <div
            key={`${metric.label}-${metric.value}`}
            className={`px-5 py-4 sm:px-6 ${index > 0 ? "border-t border-[var(--app-border-soft)] sm:border-t-0" : ""} xl:border-l xl:border-[var(--app-border-soft)]`}
          >
            <dt className="text-[11px] uppercase tracking-[0.16em] text-[var(--app-text-subtle)]">
              {metric.label}
            </dt>
            <dd className="app-data mt-3 text-[28px] leading-none text-[var(--app-text-strong)]">
              {metric.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="px-5 py-6 sm:px-6">
        <WorkflowStageSwitcher
          tabs={industryConclusionTabs}
          activeTabId={activeSectionId}
          onChange={(tabId) =>
            setActiveSectionId(tabId as "agent" | IndustryConclusionSectionId)
          }
          panels={{
            agent: <WorkflowAgentStep run={props.run ?? null} />,
            overview: <OverviewSection model={model} />,
            logic: <LogicSection model={model} />,
            evidence: <EvidenceSection model={model} />,
            risks: <RisksSection model={model} />,
          }}
        />
      </div>
    </article>
  );
}

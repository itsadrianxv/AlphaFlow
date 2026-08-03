"use client";

import { Database, ExternalLink, TriangleAlert } from "lucide-react";
import React from "react";
import { useHomePageSnapshot } from "~/app/_components/home-page-snapshot-provider";
import type {
  HomepageMarketBaseline,
  HomepageMarketDomainId,
  HomepageMarketPhaseId,
} from "~/contracts/homepage-market-baseline";

function cutoffText(cutoff: { key: string; value: string }) {
  return `${cutoff.value} · ${cutoff.key}`;
}

function formatTime(value: string | null) {
  if (!value) return "时间未提供";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
}

function EvidenceDetails({
  observation,
}: {
  observation: HomepageMarketBaseline["phases"][number]["domains"][number]["observations"][number];
}) {
  return (
    <details className="mt-3 border-t border-[var(--app-border-soft)] pt-2 text-xs text-[var(--app-text-muted)]">
      <summary className="cursor-pointer select-none py-1 text-[var(--app-text)]">
        证据与修订
      </summary>
      <div className="mt-2 grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)]">
        <dl className="space-y-1 tabular-nums">
          <div className="flex justify-between gap-3">
            <dt>修订</dt>
            <dd className="text-[var(--app-text-strong)]">
              #{observation.revisionNo}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>来源时间</dt>
            <dd>{formatTime(observation.sourcePublishedAt)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>规范化</dt>
            <dd>{formatTime(observation.normalizedAt)}</dd>
          </div>
        </dl>
        <div className="divide-y divide-[var(--app-border-soft)] border-y border-[var(--app-border-soft)]">
          {observation.sources.length > 0 ? (
            observation.sources.map((source) => (
              <div
                key={source.assertionId}
                className="grid gap-1 py-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto] sm:items-center"
              >
                <div className="font-medium text-[var(--app-text-strong)]">
                  {source.sourceKey} · {source.role}
                </div>
                <div className="min-w-0">
                  <div className="truncate">{source.selectionReason}</div>
                  <div className="truncate text-[var(--app-text-subtle)]">
                    {source.datasetKey} / {source.sourceRecordKey}
                  </div>
                </div>
                {source.url ? (
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[var(--app-accent-strong)] hover:underline"
                  >
                    来源
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                  </a>
                ) : (
                  <span className="text-[var(--app-text-subtle)]">
                    无公开链接
                  </span>
                )}
              </div>
            ))
          ) : (
            <p className="py-2">该修订没有关联来源断言。</p>
          )}
        </div>
      </div>
    </details>
  );
}

function NumericChart({
  title,
  emptyText,
  points,
}: {
  title: string;
  emptyText: string;
  points: HomepageMarketBaseline["phases"][number]["charts"]["breadth"];
}) {
  const max = Math.max(1, ...points.map((point) => Math.abs(point.value)));
  return (
    <section className="min-h-40 border-b border-[var(--app-border-soft)] p-4 lg:border-r lg:border-b-0">
      <h2 className="text-sm font-medium text-[var(--app-text-strong)]">
        {title}
      </h2>
      {points.length > 0 ? (
        <div className="mt-3 space-y-2" role="img" aria-label={title}>
          {points.slice(0, 6).map((point) => (
            <div
              key={point.revisionId}
              className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3"
            >
              <div className="min-w-0">
                <div className="truncate text-xs text-[var(--app-text-muted)]">
                  {point.label}
                </div>
                <div className="mt-1 h-1.5 bg-[var(--app-bg-inset)]">
                  <div
                    className="h-full bg-[var(--app-brand)]"
                    style={{
                      width: `${Math.max(3, (Math.abs(point.value) / max) * 100)}%`,
                    }}
                  />
                </div>
              </div>
              <div className="truncate text-right text-xs tabular-nums text-[var(--app-text-strong)]">
                {point.displayValue}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
          {emptyText}
        </p>
      )}
    </section>
  );
}

export function MarketBaselineWorkspace({
  baseline,
  initialPhase,
  initialDomain = "market",
}: {
  baseline: HomepageMarketBaseline;
  initialPhase?: HomepageMarketPhaseId;
  initialDomain?: HomepageMarketDomainId;
}) {
  const [phaseId, setPhaseId] = React.useState<HomepageMarketPhaseId>(
    initialPhase ?? baseline.defaultPhase,
  );
  const [domainId, setDomainId] =
    React.useState<HomepageMarketDomainId>(initialDomain);
  const phase = React.useMemo(
    () => baseline.phases.find((candidate) => candidate.id === phaseId),
    [baseline.phases, phaseId],
  );
  const domain = React.useMemo(
    () => phase?.domains.find((candidate) => candidate.id === domainId),
    [domainId, phase],
  );
  if (!phase || !domain) return null;

  return (
    <main className="min-h-full bg-[var(--app-bg)] text-[var(--app-text)]">
      <header className="border-b border-[var(--app-border)] px-4 py-4 md:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[var(--app-text-strong)]">
              专业市场基线
            </h1>
            <p className="mt-1 text-xs tabular-nums text-[var(--app-text-muted)]">
              交易日 {phase.targetTradeDate} · 快照生成{" "}
              {formatTime(phase.generatedAt)}
            </p>
          </div>
          <div className="text-right text-xs text-[var(--app-text-muted)]">
            <div>{phase.state === "READY" ? "数据已结算" : "受限快照"}</div>
            <div className="mt-1 font-mono text-[var(--app-text-subtle)]">
              {phase.snapshotId}
            </div>
          </div>
        </div>
      </header>

      <div
        aria-label="交易阶段"
        role="tablist"
        className="flex min-h-11 overflow-x-auto border-b border-[var(--app-border-soft)] px-4 md:px-6"
      >
        {baseline.phases.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={candidate.id === phaseId}
            onClick={() => setPhaseId(candidate.id)}
            className={`min-w-20 border-b-2 px-4 text-sm transition-colors duration-150 ${
              candidate.id === phaseId
                ? "border-[var(--app-brand)] text-[var(--app-text-strong)]"
                : "border-transparent text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
            }`}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      <section className="grid border-b border-[var(--app-border-soft)] lg:grid-cols-3">
        <NumericChart
          title="市场广度"
          emptyText="当前阶段没有可绘制的市场广度数值，保留原始观测与截止点。"
          points={phase.charts.breadth}
        />
        <NumericChart
          title="资金方向"
          emptyText="当前阶段没有可绘制的资金数值，未使用占位或旧数据补齐。"
          points={phase.charts.flows}
        />
        <section className="min-h-40 p-4">
          <h2 className="text-sm font-medium text-[var(--app-text-strong)]">
            关键事件节点
          </h2>
          {phase.charts.events.length > 0 ? (
            <ol className="mt-3 border-l border-[var(--app-border)] pl-3">
              {phase.charts.events.slice(0, 6).map((event) => (
                <li key={event.revisionId} className="pb-3 last:pb-0">
                  <div className="text-xs tabular-nums text-[var(--app-text-subtle)]">
                    {formatTime(event.time)}
                  </div>
                  <div className="mt-1 truncate text-sm text-[var(--app-text)]">
                    {event.label}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
              当前阶段没有已结算事件节点，未使用推测日程补齐。
            </p>
          )}
        </section>
      </section>

      <div
        aria-label="信息域"
        role="tablist"
        className="flex min-h-12 overflow-x-auto border-b border-[var(--app-border-soft)] px-4 md:px-6"
      >
        {phase.domains.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            aria-selected={candidate.id === domainId}
            onClick={() => setDomainId(candidate.id)}
            className={`shrink-0 border-b-2 px-3 text-sm transition-colors duration-150 ${
              candidate.id === domainId
                ? "border-[var(--app-brand)] text-[var(--app-text-strong)]"
                : "border-transparent text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]"
            }`}
          >
            {candidate.label}
            <span className="ml-2 font-mono text-xs text-[var(--app-text-subtle)]">
              {candidate.observations.length}
            </span>
          </button>
        ))}
      </div>

      <section aria-labelledby="market-baseline-domain-title">
        <div className="grid gap-4 border-b border-[var(--app-border-soft)] bg-[var(--app-bg-raised)] px-4 py-3 text-xs md:grid-cols-[minmax(0,1fr)_auto] md:px-6">
          <div>
            <h2
              id="market-baseline-domain-title"
              className="text-sm font-medium text-[var(--app-text-strong)]"
            >
              {domain.label}
            </h2>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[var(--app-text-muted)]">
              <span>
                实际截止 {cutoffText(domain.coverage.actualDataCutoff)}
              </span>
              <span>
                目标截止 {cutoffText(domain.coverage.targetDataCutoff)}
              </span>
              <span>{domain.datasetKey}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start text-[var(--app-text-muted)]">
            {domain.coverage.qualityStatus !== "NORMAL" ? (
              <TriangleAlert
                aria-label="数据受限"
                className="size-4 text-[var(--app-warning)]"
              />
            ) : (
              <Database aria-hidden="true" className="size-4" />
            )}
            <span>
              {domain.coverage.settlementStatus} ·{" "}
              {domain.coverage.qualityStatus}
            </span>
          </div>
          {domain.coverage.limitations.length > 0 ? (
            <p className="md:col-span-2 text-[var(--app-warning)]">
              {domain.coverage.limitations.join("；")}
            </p>
          ) : null}
        </div>

        <div className="divide-y divide-[var(--app-border-soft)]">
          {domain.observations.length > 0 ? (
            domain.observations.map((observation) => (
              <article
                key={observation.revisionId}
                className="px-4 py-4 md:px-6"
              >
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_10rem]">
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium leading-6 text-[var(--app-text-strong)]">
                      {observation.title}
                    </h3>
                    <p className="mt-1 max-w-4xl text-sm leading-6 text-[var(--app-text-muted)]">
                      {observation.summary}
                    </p>
                  </div>
                  <dl className="text-xs text-[var(--app-text-muted)] md:text-right">
                    <div className="font-mono text-sm text-[var(--app-text-strong)]">
                      {observation.displayValue}
                    </div>
                    <div className="mt-1">{observation.subjectKey}</div>
                    <div className="mt-1">修订 #{observation.revisionNo}</div>
                  </dl>
                </div>
                <EvidenceDetails observation={observation} />
              </article>
            ))
          ) : (
            <p className="px-4 py-8 text-sm text-[var(--app-text-muted)] md:px-6">
              该信息域已完成覆盖结算，本次结果没有规范化观测。
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

export function HomepageMarketBaselineWorkspace() {
  const snapshot = useHomePageSnapshot();
  if (snapshot.isLoading) {
    return (
      <div className="px-6 py-8 text-sm text-[var(--app-text-muted)]">
        正在读取专业市场基线
      </div>
    );
  }
  if (snapshot.isError || !snapshot.data) {
    return (
      <div className="px-6 py-8 text-sm text-[var(--app-danger-text)]">
        专业市场基线暂时无法读取
      </div>
    );
  }
  return <MarketBaselineWorkspace baseline={snapshot.data.marketBaseline} />;
}

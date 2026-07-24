"use client";

import React, { useEffect, useMemo, useState } from "react";
import { EvidenceContextCitations } from "~/app/_components/evidence-context-citations";
import { ProgressBar } from "~/app/_components/ui";
import type { EvidenceCitation } from "~/server/domain/evidence-context/types";
import type {
  ImpactEdge,
  ImpactMappingResult,
  ImpactRadarEvent,
  ImpactScenario,
} from "~/server/domain/intelligence/impact-mapping";
import type { ThemeNewsItem } from "~/server/domain/intelligence/types";
import { api } from "~/trpc/react";

const levelLabels: Record<ImpactEdge["level"], string> = {
  primary: "一级影响",
  secondary: "二级影响",
  tertiary: "三级影响",
  macro: "宏观影响",
  portfolio: "组合影响",
};

const directionLabels: Record<ImpactEdge["direction"], string> = {
  positive: "正向",
  negative: "负向",
  mixed: "双向",
  uncertain: "待确认",
};

const directionClasses: Record<ImpactEdge["direction"], string> = {
  positive: "text-[var(--app-success)]",
  negative: "text-[var(--app-danger)]",
  mixed: "text-[var(--app-warning)]",
  uncertain: "text-[var(--app-text-subtle)]",
};

const sourceLabels: Record<string, string> = {
  fast: "快讯",
  major: "要闻",
  cctv: "新闻联播",
};

const nodeLabels: Record<string, string> = {
  load_impact_context: "载入组合、自选与投资假设",
  collect_impact_evidence: "采集新闻与关系证据",
  persist_impact_observations: "固化原始证据与来源",
  map_impact_layers: "识别多层影响",
  build_impact_timeline: "构建事件时间线",
  forecast_impact_scenarios: "推演未来分支",
  persist_impact_analysis: "校验证据并定稿",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asImpactResult(value: unknown): ImpactMappingResult | null {
  if (!isRecord(value)) return null;
  if (
    value.mode !== "radar" &&
    value.mode !== "deep_dive" &&
    value.mode !== "trace"
  ) {
    return null;
  }
  if (!Array.isArray(value.events) || !Array.isArray(value.impactEdges)) {
    return null;
  }
  return value as ImpactMappingResult;
}

function formatDate(value?: string | Date | null): string {
  if (!value) return "时间未知";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function citationSubset(
  citations: EvidenceCitation[],
  itemIds: string[],
): EvidenceCitation[] {
  const wanted = new Set(itemIds);
  return citations.filter((item) => wanted.has(item.evidenceItemId));
}

function EventRow(props: {
  item: ImpactRadarEvent;
  active: boolean;
  onSelect: () => void;
}) {
  const { item, active, onSelect } = props;
  const event = item.event;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`w-full cursor-pointer border-b border-[var(--app-border-soft)] px-4 py-4 text-left transition-colors last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-accent-strong)] ${
        active
          ? "bg-[var(--app-selection)]"
          : "hover:bg-[var(--app-hover-surface)]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 text-sm font-medium leading-6 text-[var(--app-text-strong)]">
          {event.title}
        </span>
        <span className="app-data shrink-0 text-xs text-[var(--app-text-subtle)]">
          {item.importanceScore.toFixed(1)}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--app-text-subtle)]">
        <span>{sourceLabels[event.sourceKind ?? ""] ?? event.source}</span>
        <span>{formatDate(event.publishedAt)}</span>
        {item.portfolioHits.length > 0 ? (
          <span className="text-[var(--app-warning)]">
            组合命中 {item.portfolioHits.length}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function ImpactEdges(props: {
  edges: ImpactEdge[];
  citations: EvidenceCitation[];
}) {
  const { edges, citations } = props;
  if (edges.length === 0) {
    return (
      <div className="border-y border-dashed border-[var(--app-border-soft)] py-8 text-center text-sm text-[var(--app-text-muted)]">
        当前事件尚无可验证的影响关系。
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--app-border-soft)]">
      {Object.entries(levelLabels).map(([level, label]) => {
        const levelEdges = edges.filter((edge) => edge.level === level);
        if (levelEdges.length === 0) return null;
        return (
          <section key={level} className="grid gap-3 py-4 first:pt-0">
            <div className="flex items-center justify-between gap-3">
              <h4 className="text-sm font-medium text-[var(--app-text-strong)]">
                {label}
              </h4>
              <span className="app-data text-xs text-[var(--app-text-subtle)]">
                {levelEdges.length}
              </span>
            </div>
            <div className="grid gap-2">
              {levelEdges.map((edge) => (
                <article
                  key={edge.id}
                  className="border-l-2 border-[var(--app-border-strong)] py-1 pl-3"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-medium text-[var(--app-text-strong)]">
                      {edge.target}
                    </span>
                    {edge.stockCode ? (
                      <span className="app-data text-xs text-[var(--app-text-subtle)]">
                        {edge.stockCode}
                      </span>
                    ) : null}
                    <span className={directionClasses[edge.direction]}>
                      {directionLabels[edge.direction]}
                    </span>
                    <span className="text-xs text-[var(--app-text-subtle)]">
                      {edge.basis === "fact"
                        ? "事实"
                        : edge.basis === "inference"
                          ? "推断"
                          : "假设"}
                      {" · "}
                      {formatConfidence(edge.confidence)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-[var(--app-text-muted)]">
                    {edge.rationale}{" "}
                    <EvidenceContextCitations
                      citations={citationSubset(
                        citations,
                        edge.evidenceItemIds,
                      )}
                    />
                  </p>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Timeline(props: {
  result: ImpactMappingResult;
  onContinue: () => void;
  continuing: boolean;
}) {
  const { result, onContinue, continuing } = props;
  if (result.timeline.length === 0 && result.scenarios.length === 0)
    return null;
  return (
    <div className="mt-6 grid gap-6 border-t border-[var(--app-border-soft)] pt-5 xl:grid-cols-2">
      <section>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-medium text-[var(--app-text-strong)]">
            已发生
          </h3>
          {result.mode === "trace" && result.traceState?.canContinue ? (
            <button
              type="button"
              className="app-button !min-h-8 !rounded-[8px] !px-3 !py-1 text-xs"
              disabled={continuing}
              onClick={onContinue}
            >
              {continuing ? "追溯中..." : "继续追溯"}
            </button>
          ) : null}
        </div>
        <ol className="mt-3 border-l border-[var(--app-border-strong)] pl-4">
          {result.timeline.map((item) => (
            <li key={item.id} className="relative pb-5 last:pb-0">
              <span className="absolute -left-[19px] top-2 h-2 w-2 rounded-full bg-[var(--app-accent-strong)]" />
              <div className="app-data text-xs text-[var(--app-text-subtle)]">
                {formatDate(item.occurredAt)}
              </div>
              <div className="mt-1 text-sm font-medium text-[var(--app-text-strong)]">
                {item.title}
              </div>
              <p className="mt-1 text-sm leading-6 text-[var(--app-text-muted)]">
                {item.summary}{" "}
                <EvidenceContextCitations
                  citations={citationSubset(
                    result.evidenceCitations,
                    item.evidenceItemIds,
                  )}
                />
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-[var(--app-border-soft)] pt-5 xl:border-t-0 xl:border-l xl:pl-6 xl:pt-0">
        <h3 className="text-base font-medium text-[var(--app-text-strong)]">
          未来分支
        </h3>
        <div className="mt-3 divide-y divide-[var(--app-border-soft)]">
          {result.scenarios.map((scenario) => (
            <ScenarioRow key={scenario.id} scenario={scenario} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ScenarioRow({ scenario }: { scenario: ImpactScenario }) {
  return (
    <details className="group py-3 first:pt-0">
      <summary className="cursor-pointer list-none text-sm font-medium text-[var(--app-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-strong)]">
        <span>{scenario.name}</span>
        <span className="ml-2 text-xs font-normal text-[var(--app-text-subtle)]">
          {scenario.horizon} ·{" "}
          {scenario.basis === "inference" ? "推断" : "假设"}
        </span>
      </summary>
      <div className="mt-3 grid gap-3 text-xs leading-5 text-[var(--app-text-muted)]">
        <p>{scenario.rationale}</p>
        <ScenarioList label="触发条件" items={scenario.triggers} />
        <ScenarioList label="确认信号" items={scenario.confirmationSignals} />
        <ScenarioList
          label="失效条件"
          items={scenario.invalidationConditions}
        />
        <ScenarioList label="影响对象" items={scenario.affectedTargets} />
      </div>
    </details>
  );
}

function ScenarioList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] gap-2">
      <span className="text-[var(--app-text-subtle)]">{label}</span>
      <span>{items.join("；")}</span>
    </div>
  );
}

function EventDetail(props: {
  event: ThemeNewsItem;
  edges: ImpactEdge[];
  result: ImpactMappingResult;
  canDeepDive: boolean;
  running: boolean;
  onDeepDive: () => void;
  onTrace: () => void;
  onContinueTrace: () => void;
}) {
  const {
    event,
    edges,
    result,
    canDeepDive,
    running,
    onDeepDive,
    onTrace,
    onContinueTrace,
  } = props;
  return (
    <div
      data-testid="impact-event-detail"
      className="min-w-0 px-4 py-5 lg:px-6"
    >
      <div className="flex flex-col gap-4 border-b border-[var(--app-border-soft)] pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--app-text-subtle)]">
            <span>{sourceLabels[event.sourceKind ?? ""] ?? event.source}</span>
            <span>{formatDate(event.publishedAt)}</span>
            <span>
              {result.analysisStatus === "partial" ? "部分完成" : "分析完成"}
            </span>
          </div>
          <h3 className="mt-2 text-xl font-medium leading-8 text-[var(--app-text-strong)]">
            {event.title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
            {event.summary}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            className="app-button app-button-primary !rounded-[8px]"
            disabled={!canDeepDive || running}
            onClick={onDeepDive}
          >
            深挖影响
          </button>
          <button
            type="button"
            className="app-button !rounded-[8px]"
            disabled={!canDeepDive || running}
            onClick={onTrace}
          >
            往前追溯
          </button>
        </div>
      </div>

      {event.content ? (
        <details className="border-b border-[var(--app-border-soft)] py-4">
          <summary className="cursor-pointer text-sm font-medium text-[var(--app-text-strong)]">
            查看完整正文
          </summary>
          <div className="mt-3 max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-[var(--app-text-muted)]">
            {event.content}
          </div>
          {event.url ? (
            <a
              href={event.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm text-[var(--app-brand)] underline decoration-dotted underline-offset-4"
            >
              打开原文
            </a>
          ) : null}
        </details>
      ) : null}

      <div className="pt-5">
        <ImpactEdges edges={edges} citations={result.evidenceCitations} />
      </div>
      <Timeline
        result={result}
        onContinue={onContinueTrace}
        continuing={running}
      />
    </div>
  );
}

export function ImpactMappingWorkspace({ signedIn }: { signedIn: boolean }) {
  const utils = api.useUtils();
  const [portfolioSnapshotId, setPortfolioSnapshotId] = useState("");
  const [watchListIds, setWatchListIds] = useState<string[]>([]);
  const [days, setDays] = useState(7);
  const [selectedEventId, setSelectedEventId] = useState<string>();
  const [mobileView, setMobileView] = useState<"events" | "detail">("events");
  const [activeRunId, setActiveRunId] = useState<string>();
  const [radarRunId, setRadarRunId] = useState<string>();
  const [detailRunId, setDetailRunId] = useState<string>();
  const [radarResult, setRadarResult] = useState<ImpactMappingResult>();
  const [detailResult, setDetailResult] = useState<ImpactMappingResult>();
  const [streamLabel, setStreamLabel] = useState<string>();

  const latestQuery = api.workflow.getLatestImpactMapping.useQuery(undefined, {
    enabled: signedIn,
    refetchOnWindowFocus: false,
  });
  const watchlistsQuery = api.watchlist.list.useQuery(
    { limit: 20, offset: 0, sortBy: "updatedAt", sortDirection: "desc" },
    { enabled: signedIn, refetchOnWindowFocus: false },
  );
  const portfoliosQuery = api.timing.listPortfolioSnapshots.useQuery(
    undefined,
    {
      enabled: signedIn,
      refetchOnWindowFocus: false,
    },
  );
  const runQuery = api.workflow.getRun.useQuery(
    { runId: activeRunId ?? "" },
    {
      enabled: Boolean(activeRunId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "PENDING" || status === "RUNNING" ? 3_000 : false;
      },
      refetchOnWindowFocus: false,
    },
  );
  const startMutation = api.workflow.startImpactMapping.useMutation({
    onSuccess: (run) => {
      setActiveRunId(run.runId);
      setStreamLabel("等待 worker 接单");
    },
  });
  const latestResult = asImpactResult(latestQuery.data?.result);
  const effectiveRadarResult =
    radarResult ?? (latestResult?.mode === "radar" ? latestResult : undefined);
  const effectiveRadarRunId = radarRunId ?? latestQuery.data?.id;

  useEffect(() => {
    const latest = latestQuery.data;
    const parsed = asImpactResult(latest?.result);
    if (!latest || !parsed || parsed.mode !== "radar") return;
    setRadarRunId(latest.id);
    setRadarResult(parsed);
  }, [latestQuery.data]);

  useEffect(() => {
    if (watchListIds.length > 0 || !watchlistsQuery.data?.[0]?.id) return;
    setWatchListIds([watchlistsQuery.data[0].id]);
  }, [watchListIds.length, watchlistsQuery.data]);

  useEffect(() => {
    if (selectedEventId || !effectiveRadarResult?.events[0]?.event.id) return;
    setSelectedEventId(effectiveRadarResult.events[0].event.id);
  }, [effectiveRadarResult, selectedEventId]);

  useEffect(() => {
    const run = runQuery.data;
    if (!run || run.status !== "SUCCEEDED") return;
    const parsed = asImpactResult(run.result);
    if (!parsed) return;
    if (parsed.mode === "radar") {
      setRadarRunId(run.id);
      setRadarResult(parsed);
      setSelectedEventId(parsed.events[0]?.event.id);
    } else {
      setDetailRunId(run.id);
      setDetailResult(parsed);
    }
    setStreamLabel("运行完成");
    void utils.workflow.getLatestImpactMapping.invalidate();
  }, [runQuery.data, utils.workflow.getLatestImpactMapping]);

  useEffect(() => {
    if (!activeRunId) return;
    const status = runQuery.data?.status;
    if (
      status === "SUCCEEDED" ||
      status === "FAILED" ||
      status === "CANCELLED"
    ) {
      return;
    }
    const source = new EventSource(`/api/workflows/runs/${activeRunId}/events`);
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as {
          type?: string;
          nodeKey?: string;
        };
        if (event.nodeKey) {
          setStreamLabel(nodeLabels[event.nodeKey] ?? event.nodeKey);
        }
        void utils.workflow.getRun.invalidate({ runId: activeRunId });
        if (
          event.type === "RUN_SUCCEEDED" ||
          event.type === "RUN_FAILED" ||
          event.type === "RUN_CANCELLED"
        ) {
          source.close();
        }
      } catch {
        setStreamLabel("运行状态更新中");
      }
    };
    source.onerror = () => source.close();
    return () => source.close();
  }, [activeRunId, runQuery.data?.status, utils.workflow.getRun]);

  const selectedRadarEvent = useMemo(
    () =>
      effectiveRadarResult?.events.find(
        (item) => item.event.id === selectedEventId,
      ) ?? effectiveRadarResult?.events[0],
    [effectiveRadarResult, selectedEventId],
  );
  const selectedEvent = selectedRadarEvent?.event;
  const matchingDetail =
    detailResult?.selectedEvent?.id === selectedEvent?.id
      ? detailResult
      : undefined;
  const visibleResult = matchingDetail ?? effectiveRadarResult;
  const visibleEdges =
    matchingDetail?.impactEdges ?? selectedRadarEvent?.impactEdges ?? [];
  const running =
    startMutation.isPending ||
    runQuery.data?.status === "PENDING" ||
    runQuery.data?.status === "RUNNING";
  const runFailed = runQuery.data?.status === "FAILED";

  function toggleWatchList(id: string) {
    setWatchListIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : current.length >= 5
          ? current
          : [...current, id],
    );
  }

  function startRadar() {
    setDetailResult(undefined);
    setDetailRunId(undefined);
    setSelectedEventId(undefined);
    startMutation.mutate({
      mode: "radar",
      portfolioSnapshotId: portfolioSnapshotId || undefined,
      watchListIds,
      days,
      traceMaxDays: 365,
      traceMaxEvents: 30,
    });
  }

  function startDeepDive() {
    if (!selectedEvent || !effectiveRadarRunId) return;
    startMutation.mutate({
      mode: "deep_dive",
      portfolioSnapshotId: portfolioSnapshotId || undefined,
      watchListIds,
      eventId: selectedEvent.id,
      baseRunId: effectiveRadarRunId,
      days,
      traceMaxDays: 365,
      traceMaxEvents: 30,
    });
  }

  function startTrace(continueFromOldest: boolean) {
    if (!selectedEvent || !effectiveRadarRunId) return;
    const continuingRunId =
      continueFromOldest && matchingDetail?.mode === "trace"
        ? detailRunId
        : matchingDetail
          ? detailRunId
          : effectiveRadarRunId;
    if (!continuingRunId) return;
    startMutation.mutate({
      mode: "trace",
      portfolioSnapshotId: portfolioSnapshotId || undefined,
      watchListIds,
      eventId: selectedEvent.id,
      baseRunId: continuingRunId,
      days,
      traceCursor: continueFromOldest
        ? matchingDetail?.traceState?.oldestOccurredAt
        : undefined,
      traceMaxDays: 365,
      traceMaxEvents: 30,
    });
  }

  if (!signedIn) {
    return (
      <section className="border-y border-[var(--app-border-soft)] py-6">
        <h2 className="text-xl font-medium text-[var(--app-text-strong)]">
          新闻影响雷达
        </h2>
        <p className="mt-2 text-sm text-[var(--app-text-muted)]">
          登录后可读取组合、自选和最近成功的影响映射快照。
        </p>
      </section>
    );
  }

  return (
    <section
      data-testid="impact-mapping-workspace"
      className="overflow-hidden border-y border-[var(--app-border)] bg-[var(--app-surface-quiet)]"
    >
      <div className="border-b border-[var(--app-border-soft)] px-4 py-5 lg:px-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h2 className="text-xl font-medium text-[var(--app-text-strong)]">
              新闻影响雷达
            </h2>
            <div className="mt-2 text-sm text-[var(--app-text-muted)]">
              {effectiveRadarResult
                ? `${effectiveRadarResult.events.length} 个事件 · 快照 ${formatDate(effectiveRadarResult.asOf)}`
                : "尚无成功快照"}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(180px,1fr)_110px_auto] xl:w-[620px]">
            <label className="grid gap-1 text-xs text-[var(--app-text-subtle)]">
              组合
              <select
                value={portfolioSnapshotId}
                onChange={(event) => setPortfolioSnapshotId(event.target.value)}
                className="!rounded-[8px] !py-2"
              >
                <option value="">最近更新的组合</option>
                {(portfoliosQuery.data ?? []).map((portfolio) => (
                  <option key={portfolio.id} value={portfolio.id}>
                    {portfolio.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs text-[var(--app-text-subtle)]">
              新闻窗口
              <select
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
                className="!rounded-[8px] !py-2"
              >
                {[3, 7, 14, 30].map((value) => (
                  <option key={value} value={value}>
                    {value} 天
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="app-button app-button-primary self-end !rounded-[8px]"
              disabled={running}
              onClick={startRadar}
            >
              {running ? "运行中..." : "刷新雷达"}
            </button>
          </div>
        </div>

        {(watchlistsQuery.data?.length ?? 0) > 0 ? (
          <fieldset className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <legend className="float-left mr-4 text-xs text-[var(--app-text-subtle)]">
              自选
            </legend>
            {watchlistsQuery.data?.map((watchlist) => (
              <label
                key={watchlist.id}
                className="flex cursor-pointer items-center gap-2 text-sm text-[var(--app-text-muted)]"
              >
                <input
                  type="checkbox"
                  checked={watchListIds.includes(watchlist.id)}
                  onChange={() => toggleWatchList(watchlist.id)}
                  className="h-4 w-4 accent-[var(--app-brand)]"
                />
                <span>{watchlist.name}</span>
                <span className="app-data text-xs text-[var(--app-text-subtle)]">
                  {watchlist.stockCount}
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
      </div>

      {activeRunId ? (
        <div
          className={`border-b px-4 py-3 lg:px-6 ${
            runFailed
              ? "border-[var(--app-danger-border)] bg-[var(--app-danger-surface)]"
              : "border-[var(--app-info-border)] bg-[var(--app-info-surface)]"
          }`}
        >
          <div className="flex items-center justify-between gap-4 text-sm">
            <span
              className={
                runFailed
                  ? "text-[var(--app-danger)]"
                  : "text-[var(--app-text-strong)]"
              }
            >
              {runFailed
                ? (runQuery.data?.errorMessage ?? "运行失败，可重新发起该阶段")
                : (streamLabel ??
                  nodeLabels[runQuery.data?.currentNodeKey ?? ""] ??
                  "任务已进入队列")}
            </span>
            <span className="app-data shrink-0 text-xs text-[var(--app-text-subtle)]">
              {runQuery.data?.progressPercent ?? 0}%
            </span>
          </div>
          {!runFailed ? (
            <ProgressBar
              value={runQuery.data?.progressPercent ?? 0}
              className="mt-2"
            />
          ) : null}
        </div>
      ) : null}

      {visibleResult?.analysisStatus === "partial" ||
      (visibleResult?.warnings.length ?? 0) > 0 ? (
        <details className="border-b border-[var(--app-warning-border)] bg-[var(--app-warning-surface)] px-4 py-3 text-sm lg:px-6">
          <summary className="cursor-pointer text-[var(--app-text-strong)]">
            部分能力未完成，已保留可验证结果
          </summary>
          <ul className="mt-2 grid gap-1 text-xs leading-5 text-[var(--app-text-muted)]">
            {visibleResult?.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="flex border-b border-[var(--app-border-soft)] lg:hidden">
        <button
          type="button"
          aria-pressed={mobileView === "events"}
          onClick={() => setMobileView("events")}
          className={`min-h-11 flex-1 border-b-2 px-3 text-sm ${
            mobileView === "events"
              ? "border-[var(--app-brand)] text-[var(--app-text-strong)]"
              : "border-transparent text-[var(--app-text-muted)]"
          }`}
        >
          事件
        </button>
        <button
          type="button"
          aria-pressed={mobileView === "detail"}
          onClick={() => setMobileView("detail")}
          className={`min-h-11 flex-1 border-b-2 px-3 text-sm ${
            mobileView === "detail"
              ? "border-[var(--app-brand)] text-[var(--app-text-strong)]"
              : "border-transparent text-[var(--app-text-muted)]"
          }`}
        >
          影响
        </button>
      </div>

      {effectiveRadarResult && effectiveRadarResult.events.length > 0 ? (
        <div className="lg:grid lg:min-h-[540px] lg:grid-cols-[minmax(260px,0.78fr)_minmax(0,1.72fr)]">
          <div
            data-testid="impact-event-list"
            className={`${mobileView === "events" ? "block" : "hidden"} max-h-[680px] overflow-y-auto border-r border-[var(--app-border-soft)] lg:block`}
          >
            {effectiveRadarResult.events.map((item) => (
              <EventRow
                key={item.event.id}
                item={item}
                active={item.event.id === selectedEvent?.id}
                onSelect={() => {
                  setSelectedEventId(item.event.id);
                  setMobileView("detail");
                }}
              />
            ))}
          </div>
          <div
            className={`${mobileView === "detail" ? "block" : "hidden"} lg:block`}
          >
            {selectedEvent && visibleResult ? (
              <EventDetail
                event={selectedEvent}
                edges={visibleEdges}
                result={visibleResult}
                canDeepDive={Boolean(effectiveRadarRunId)}
                running={running}
                onDeepDive={startDeepDive}
                onTrace={() => startTrace(false)}
                onContinueTrace={() => startTrace(true)}
              />
            ) : null}
          </div>
        </div>
      ) : latestQuery.isLoading ? (
        <div className="px-4 py-12 text-center text-sm text-[var(--app-text-muted)]">
          正在读取最近成功快照...
        </div>
      ) : (
        <div className="px-4 py-12 text-center text-sm text-[var(--app-text-muted)]">
          当前没有新闻事件，刷新雷达后结果会保存在这里。
        </div>
      )}
    </section>
  );
}

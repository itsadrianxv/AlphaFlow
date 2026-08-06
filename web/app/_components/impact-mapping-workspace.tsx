"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EvidenceContextCitations } from "~/app/_components/evidence-context-citations";
import {
  isNodeTimeoutPausedRun,
  WORKFLOW_NODE_TIMEOUT_PAUSE_REASON,
} from "~/contracts/workflow-pause";
import type {
  ImpactEdge,
  ImpactMappingResult,
  ImpactRadarEvent,
  ImpactScenario,
  ImpactTimelineItem,
} from "~/server/domain/intelligence/impact-mapping";
import { api } from "~/trpc/react";

void React;

const CACHE_TTL_MS = 60 * 60 * 1_000;
const RETRY_DELAY_MS = 60 * 1_000;
const PAGE_SIZE = 3;
const NEWS_DAYS = 7;
const MAX_TIMELINE_HISTORY = 5;

type EventAnalysis = {
  impactEdges: ImpactEdge[];
  timeline: ImpactTimelineItem[];
  scenarios: ImpactScenario[];
  warnings: string[];
  traceState?: ImpactMappingResult["traceState"];
};

type EventAnalysisState =
  | { status: "loading"; runId?: string }
  | { status: "ready"; data: EventAnalysis }
  | { status: "error"; message: string };

type ObservableWorkflowRun = {
  status: string;
  result?: unknown;
  errorMessage?: string | null;
  events?: ReadonlyArray<{ eventType: string; payload: unknown }> | null;
};

export function shouldPollImpactAnalysisRun(run?: ObservableWorkflowRun) {
  if (!run) return false;
  const disposition = getImpactAnalysisRunDisposition(run);
  return disposition === "poll" || disposition === "waiting";
}

export function getImpactAnalysisRunDisposition(
  run: ObservableWorkflowRun,
): "poll" | "ready" | "failed" | "retry" | "waiting" {
  if (run.status === "SUCCEEDED") return "ready";
  if (run.status === "FAILED" || run.status === "CANCELLED") return "failed";
  if (isNodeTimeoutPausedRun(run)) return "retry";
  if (run.status === "PAUSED") return "waiting";
  return "poll";
}

export function nextImpactOverviewRetryAt(now = Date.now()) {
  return (Math.floor(now / CACHE_TTL_MS) + 1) * CACHE_TTL_MS;
}

export function handleImpactAnalysisRunUpdate(
  eventId: string,
  run: ObservableWorkflowRun,
  callbacks: {
    onReady: (eventId: string, result: unknown) => void;
    onFailed: (eventId: string, message: string) => void;
    onTimedOut: (eventId: string) => void;
  },
) {
  const disposition = getImpactAnalysisRunDisposition(run);
  if (disposition === "ready") {
    callbacks.onReady(eventId, run.result);
  } else if (disposition === "failed") {
    callbacks.onFailed(eventId, run.errorMessage ?? "新闻分析加载失败");
  } else if (disposition === "retry") {
    callbacks.onTimedOut(eventId);
  }
}

const sourceLabels: Record<string, string> = {
  fast: "快讯",
  major: "要闻",
  cctv: "新闻联播",
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

const levelLabels: Record<ImpactEdge["level"], string> = {
  primary: "一级影响",
  secondary: "二级影响",
  tertiary: "三级影响",
  macro: "宏观影响",
  portfolio: "组合影响",
};

const levelOrder: ImpactEdge["level"][] = [
  "primary",
  "secondary",
  "tertiary",
  "macro",
  "portfolio",
];

export function isNewsSnapshotFresh(
  completedAt: string | Date | null | undefined,
  now = Date.now(),
) {
  if (!completedAt) return false;
  const completedTime = new Date(completedAt).getTime();
  return Number.isFinite(completedTime) && now - completedTime < CACHE_TTL_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asOverviewResult(value: unknown): ImpactMappingResult | null {
  if (!isRecord(value) || value.mode !== "overview") return null;
  if (
    !Array.isArray(value.events) ||
    value.events.length === 0 ||
    !Array.isArray(value.impactEdges)
  ) {
    return null;
  }
  return value as ImpactMappingResult;
}

function asAnalysisResult(value: unknown): ImpactMappingResult | null {
  if (!isRecord(value)) return null;
  if (
    value.mode !== "trace" &&
    value.mode !== "deep_dive" &&
    value.mode !== "overview"
  ) {
    return null;
  }
  if (
    !Array.isArray(value.impactEdges) ||
    !Array.isArray(value.timeline) ||
    !Array.isArray(value.scenarios)
  ) {
    return null;
  }
  return value as ImpactMappingResult;
}

function analysisFromResult(value: unknown): EventAnalysis | null {
  const result = asAnalysisResult(value);
  if (!result) return null;
  return {
    impactEdges: result.impactEdges,
    timeline: result.timeline,
    scenarios: result.scenarios.map((scenario) => ({
      ...scenario,
      evidenceItemIds: scenario.evidenceItemIds ?? [],
    })),
    warnings: result.warnings,
    traceState: result.traceState,
  };
}

export function eventAnalysisStateFromEnsureRecord(record: {
  status: string;
  result?: unknown;
  runId?: string;
  pauseReason?: string;
  retryExhausted?: boolean;
}): EventAnalysisState {
  const data = analysisFromResult(record.result);
  if (data) return { status: "ready", data };
  if (
    record.status === "PAUSED" &&
    record.pauseReason === WORKFLOW_NODE_TIMEOUT_PAUSE_REASON &&
    record.retryExhausted
  ) {
    return { status: "error", message: "新闻分析超时，请稍后重试" };
  }
  if (record.runId) return { status: "loading", runId: record.runId };
  return { status: "error", message: "未能启动新闻分析" };
}

function embeddedAnalysis(item: ImpactRadarEvent): EventAnalysis | null {
  if (!item.analysis || item.analysis.timeline.length === 0) {
    return null;
  }
  return {
    impactEdges: item.impactEdges,
    timeline: item.analysis.timeline,
    scenarios: item.analysis.scenarios.map((scenario) => ({
      ...scenario,
      evidenceItemIds: scenario.evidenceItemIds ?? [],
    })),
    warnings: item.analysis.warnings,
    traceState: item.analysis.traceState,
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function buildEvidenceOrdinals(analysis: EventAnalysis) {
  const orderedIds = [
    ...analysis.timeline.flatMap((item) => item.evidenceItemIds),
    ...analysis.impactEdges.flatMap((item) => item.evidenceItemIds),
    ...analysis.scenarios.flatMap((item) => item.evidenceItemIds ?? []),
  ];
  const ordinals: Record<string, number> = {};
  for (const evidenceItemId of orderedIds) {
    if (!ordinals[evidenceItemId]) {
      ordinals[evidenceItemId] = Object.keys(ordinals).length + 1;
    }
  }
  return ordinals;
}

function assignScenarios(edges: ImpactEdge[], scenarios: ImpactScenario[]) {
  const byEdge = new Map<string, ImpactScenario[]>();
  const unmatched: ImpactScenario[] = [];
  for (const scenario of scenarios) {
    const edge = edges.find((candidate) =>
      scenario.affectedTargets.some(
        (target) =>
          target === candidate.target ||
          Boolean(candidate.stockCode && target.includes(candidate.stockCode)),
      ),
    );
    if (!edge) {
      unmatched.push(scenario);
      continue;
    }
    byEdge.set(edge.id, [...(byEdge.get(edge.id) ?? []), scenario]);
  }
  return { byEdge, unmatched };
}

function AnalysisRunTracker({
  eventId,
  runId,
  onReady,
  onFailed,
  onTimedOut,
}: {
  eventId: string;
  runId: string;
  onReady: (eventId: string, result: unknown) => void;
  onFailed: (eventId: string, message: string) => void;
  onTimedOut: (eventId: string) => void;
}) {
  const query = api.workflow.getRun.useQuery(
    { runId },
    {
      refetchInterval: (current) => {
        return shouldPollImpactAnalysisRun(current.state.data) ? 3_000 : false;
      },
      refetchOnWindowFocus: false,
    },
  );

  useEffect(() => {
    const run = query.data;
    if (!run) return;
    handleImpactAnalysisRunUpdate(eventId, run, {
      onReady,
      onFailed,
      onTimedOut,
    });
  }, [eventId, onFailed, onReady, onTimedOut, query.data]);

  return null;
}

function NewsCard({
  item,
  selected,
  analysisState,
  onSelect,
}: {
  item: ImpactRadarEvent;
  selected: boolean;
  analysisState?: EventAnalysisState;
  onSelect: () => void;
}) {
  const event = item.event;
  const loading = analysisState?.status === "loading";
  const failed = analysisState?.status === "error";
  return (
    <article
      className={`flex min-h-52 flex-col rounded-lg border px-4 py-4 transition-colors ${
        selected
          ? "border-[var(--app-brand)] bg-[var(--app-selection)]"
          : "border-[var(--app-border-soft)] hover:border-[var(--app-hover-border)]"
      }`}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-busy={loading}
        onClick={onSelect}
        className="min-w-0 flex-1 cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-strong)]"
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 text-sm font-medium leading-6 text-[var(--app-text-strong)]">
            {event.title}
          </span>
          <span className="app-data shrink-0 text-xs text-[var(--app-text-subtle)]">
            {item.importanceScore.toFixed(0)}
          </span>
        </span>
        <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--app-text-subtle)]">
          <span>{sourceLabels[event.sourceKind ?? ""] ?? event.source}</span>
          <span>{formatDate(event.publishedAt)}</span>
          {item.portfolioHits.length > 0 ? (
            <span className="text-[var(--app-warning)]">
              组合命中 {item.portfolioHits.length}
            </span>
          ) : null}
          {loading ? <span>分析加载中</span> : null}
          {failed ? (
            <span className="text-[var(--app-danger)]">加载失败</span>
          ) : null}
        </span>
        <span className="mt-3 line-clamp-4 block text-sm leading-6 text-[var(--app-text-muted)]">
          {event.summary}
        </span>
      </button>
      {event.url ? (
        <a
          href={event.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 w-fit text-xs text-[var(--app-brand)] underline decoration-dotted underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-strong)]"
        >
          打开原文
        </a>
      ) : null}
    </article>
  );
}

function TimelineEventNode({
  entry,
  current,
  position,
}: {
  entry: ImpactTimelineItem;
  current: boolean;
  position: "above" | "below";
}) {
  const tooltipId = `impact-timeline-summary-${entry.id}`;
  const content = (
    <>
      <time
        className={`app-data text-[11px] ${current ? "text-[var(--app-brand)]" : "text-[var(--app-text-subtle)]"}`}
      >
        {formatDate(entry.occurredAt)}
      </time>
      <span className="mt-1 block text-sm font-medium leading-5 text-[var(--app-text-strong)]">
        {entry.title}
      </span>
    </>
  );

  return (
    <details className="group relative w-full max-w-52">
      <summary className="block list-none cursor-help rounded-[6px] px-2 py-1 text-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent-strong)]">
        {content}
      </summary>
      <div
        id={tooltipId}
        role="tooltip"
        data-testid="impact-timeline-tooltip"
        className={`pointer-events-none absolute left-1/2 z-30 w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-[8px] border border-[var(--app-border)] bg-[var(--app-bg-elevated)] px-3 py-2.5 text-left opacity-0 shadow-[0_4px_8px_var(--app-shadow-tooltip)] transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-open:pointer-events-auto group-open:opacity-100 ${
          position === "above"
            ? "bottom-[calc(100%+0.75rem)]"
            : "top-[calc(100%+0.75rem)]"
        }`}
      >
        <p className="max-h-28 overflow-y-auto break-words text-xs leading-5 text-[var(--app-text-muted)]">
          {entry.summary}
        </p>
        {entry.source ? (
          <p className="mt-2 text-[11px] text-[var(--app-text-subtle)]">
            {entry.source}
          </p>
        ) : null}
        {entry.url ? (
          <a
            href={entry.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs text-[var(--app-brand)] underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--app-accent-strong)]"
          >
            打开原文
          </a>
        ) : null}
      </div>
    </details>
  );
}

function ScenarioBranch({
  scenario,
  ordinals,
}: {
  scenario: ImpactScenario;
  ordinals: Record<string, number>;
}) {
  return (
    <details className="border-l border-[var(--app-warning-border)] pl-3">
      <summary className="cursor-pointer text-xs font-medium leading-5 text-[var(--app-text-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-strong)]">
        {scenario.name}
        <span className="ml-2 font-normal text-[var(--app-text-subtle)]">
          {scenario.horizon}
        </span>
      </summary>
      <div className="mt-2 grid gap-2 text-xs leading-5 text-[var(--app-text-muted)]">
        <p>{scenario.rationale}</p>
        <p>触发：{scenario.triggers.join("；")}</p>
        <p>确认：{scenario.confirmationSignals.join("；")}</p>
        <p>失效：{scenario.invalidationConditions.join("；")}</p>
        <EvidenceContextCitations
          evidenceItemIds={scenario.evidenceItemIds ?? []}
          ordinalByEvidenceId={ordinals}
          variant="circled"
        />
      </div>
    </details>
  );
}

function ImpactBranch({
  edge,
  scenarios,
  ordinals,
}: {
  edge: ImpactEdge;
  scenarios: ImpactScenario[];
  ordinals: Record<string, number>;
}) {
  return (
    <article className="border-l border-[var(--app-border-strong)] pl-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="text-[var(--app-text-subtle)]">
          {levelLabels[edge.level]}
        </span>
        <span className={directionClasses[edge.direction]}>
          {directionLabels[edge.direction]}
        </span>
      </div>
      <div className="mt-1 text-sm font-medium leading-5 text-[var(--app-text-strong)]">
        {edge.target}
        {edge.stockCode ? (
          <span className="app-data ml-2 text-[11px] font-normal text-[var(--app-text-subtle)]">
            {edge.stockCode}
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs leading-5 text-[var(--app-text-muted)]">
        {edge.relation}：{edge.rationale}{" "}
        <EvidenceContextCitations
          evidenceItemIds={edge.evidenceItemIds}
          ordinalByEvidenceId={ordinals}
          variant="circled"
        />
      </p>
      {scenarios.length > 0 ? (
        <div className="mt-3 grid gap-3">
          {scenarios.map((scenario) => (
            <ScenarioBranch
              key={scenario.id}
              scenario={scenario}
              ordinals={ordinals}
            />
          ))}
        </div>
      ) : null}
    </article>
  );
}

function AnalysisLoading() {
  return (
    <div
      data-testid="impact-analysis-loading"
      aria-live="polite"
      className="mt-6 border-t border-[var(--app-border-soft)] pt-5"
    >
      <div className="h-3 w-28 animate-pulse bg-[var(--app-bg-raised)]" />
      <div className="mt-5 grid min-h-52 grid-cols-3 gap-4">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="border-l border-[var(--app-border-soft)] pl-3"
          >
            <div className="h-3 w-20 animate-pulse bg-[var(--app-bg-raised)]" />
            <div className="mt-3 h-4 w-full animate-pulse bg-[var(--app-bg-raised)]" />
            <div className="mt-2 h-3 w-4/5 animate-pulse bg-[var(--app-bg-raised)]" />
          </div>
        ))}
      </div>
    </div>
  );
}

function NewsAnalysis({
  item,
  analysis,
}: {
  item: ImpactRadarEvent;
  analysis: EventAnalysis;
}) {
  const ordinals = useMemo(() => buildEvidenceOrdinals(analysis), [analysis]);
  const timeline = useMemo(() => {
    const current = analysis.timeline.find(
      (entry) => entry.eventId === item.event.id,
    );
    const historical = analysis.timeline
      .filter((entry) => entry.eventId !== item.event.id)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, MAX_TIMELINE_HISTORY);
    return [...historical, ...(current ? [current] : [])].sort((left, right) =>
      left.occurredAt.localeCompare(right.occurredAt),
    );
  }, [analysis.timeline, item.event.id]);
  const edges = useMemo(
    () =>
      [...analysis.impactEdges].sort(
        (left, right) =>
          levelOrder.indexOf(left.level) - levelOrder.indexOf(right.level),
      ),
    [analysis.impactEdges],
  );
  const assigned = useMemo(
    () => assignScenarios(edges, analysis.scenarios),
    [analysis.scenarios, edges],
  );

  if (
    timeline.length === 0 &&
    edges.length === 0 &&
    analysis.scenarios.length === 0
  ) {
    return null;
  }

  return (
    <div
      data-testid="impact-news-analysis"
      className="mt-6 min-w-0 border-t border-[var(--app-border-soft)] pt-5"
    >
      <section
        className="max-w-full overflow-x-auto overflow-y-visible pb-4"
        aria-label="新闻影响时间轴"
      >
        <ol
          data-testid="impact-news-timeline"
          className="relative flex h-[16rem] min-w-max items-stretch px-6 py-2"
        >
          <span
            aria-hidden="true"
            className="absolute inset-x-6 top-1/2 h-px bg-[var(--app-border-strong)]"
          />
          {timeline.map((entry, index) => {
            const current = entry.eventId === item.event.id;
            const position = index % 2 === 0 ? "above" : "below";
            return (
              <li
                key={entry.id}
                className="relative z-10 grid h-full w-56 min-w-56 grid-rows-[1fr_auto_1fr]"
              >
                <div className="relative flex min-h-0 items-end justify-center pb-3">
                  {position === "above" ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="absolute bottom-0 left-1/2 h-3 w-px -translate-x-1/2 bg-[var(--app-border-strong)]"
                      />
                      <TimelineEventNode
                        entry={entry}
                        current={current}
                        position={position}
                      />
                    </>
                  ) : null}
                </div>
                <div className="relative z-20 flex h-5 items-center justify-center">
                  <span
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 rounded-full border-2 border-[var(--app-bg)] ${
                      current
                        ? "bg-[var(--app-brand)]"
                        : "bg-[var(--app-accent-strong)]"
                    }`}
                  />
                </div>
                <div className="relative flex min-h-0 items-start justify-center pt-3">
                  {position === "below" ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="absolute left-1/2 top-0 h-3 w-px -translate-x-1/2 bg-[var(--app-border-strong)]"
                      />
                      <TimelineEventNode
                        entry={entry}
                        current={current}
                        position={position}
                      />
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      <div className="border-t border-[var(--app-brand)] pt-5">
        <div className="grid gap-5 md:grid-cols-2">
          {edges.map((edge) => (
            <ImpactBranch
              key={edge.id}
              edge={edge}
              scenarios={assigned.byEdge.get(edge.id) ?? []}
              ordinals={ordinals}
            />
          ))}
          {assigned.unmatched.map((scenario) => (
            <ScenarioBranch
              key={scenario.id}
              scenario={scenario}
              ordinals={ordinals}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ImpactMappingWorkspace({ signedIn }: { signedIn: boolean }) {
  const utils = api.useUtils();
  const [overviewRunId, setOverviewRunId] = useState<string>();
  const [baseRunId, setBaseRunId] = useState<string>();
  const [baseSnapshotId, setBaseSnapshotId] = useState<string>();
  const [radarResult, setRadarResult] = useState<ImpactMappingResult>();
  const [carouselPage, setCarouselPage] = useState(0);
  const [selectedEventId, setSelectedEventId] = useState<string>();
  const [analysisStates, setAnalysisStates] = useState<
    Record<string, EventAnalysisState>
  >({});
  const [checkRequestedAt, setCheckRequestedAt] = useState(0);
  const retryNotBeforeRef = useRef(0);
  const localSuccessAtRef = useRef(0);
  const handledOverviewRunIdRef = useRef<string | undefined>(undefined);
  const requestedAnalysisKeysRef = useRef(new Set<string>());

  const latestQuery = api.workflow.getLatestImpactMapping.useQuery(undefined, {
    enabled: signedIn,
    refetchOnWindowFocus: false,
  });
  const overviewRunQuery = api.workflow.getRun.useQuery(
    { runId: overviewRunId ?? "" },
    {
      enabled: Boolean(overviewRunId),
      refetchInterval: (query) => {
        return shouldPollImpactAnalysisRun(query.state.data) ? 3_000 : false;
      },
      refetchOnWindowFocus: false,
    },
  );
  const startOverviewMutation = api.workflow.startImpactMapping.useMutation({
    onSuccess: (run) => setOverviewRunId(run.runId),
    onError: () => {
      retryNotBeforeRef.current = Date.now() + RETRY_DELAY_MS;
      setCheckRequestedAt(Date.now());
    },
  });
  const ensureMutation = api.workflow.ensureImpactMappingAnalyses.useMutation();

  const latestResult = asOverviewResult(latestQuery.data?.result);
  const effectiveResult = radarResult ?? latestResult ?? undefined;
  const events = useMemo(
    () => effectiveResult?.events.slice(0, 50) ?? [],
    [effectiveResult],
  );
  const pageCount = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  const pageEvents = useMemo(
    () =>
      events.slice(
        carouselPage * PAGE_SIZE,
        carouselPage * PAGE_SIZE + PAGE_SIZE,
      ),
    [carouselPage, events],
  );

  useEffect(() => {
    const parsed = asOverviewResult(latestQuery.data?.result);
    const completedAt = latestQuery.data?.completedAt;
    const completedTime = completedAt ? new Date(completedAt).getTime() : 0;
    if (parsed && completedTime >= localSuccessAtRef.current) {
      setRadarResult(parsed);
      const nextRunId =
        latestQuery.data && "baseRunId" in latestQuery.data
          ? latestQuery.data.baseRunId
          : undefined;
      const nextSnapshotId =
        latestQuery.data && "baseSnapshotId" in latestQuery.data
          ? latestQuery.data.baseSnapshotId
          : undefined;
      if (nextRunId !== baseRunId || nextSnapshotId !== baseSnapshotId) {
        setBaseRunId(nextRunId);
        setBaseSnapshotId(nextSnapshotId);
        setAnalysisStates({});
        requestedAnalysisKeysRef.current.clear();
      }
    }
  }, [baseRunId, baseSnapshotId, latestQuery.data]);

  useEffect(() => {
    setCarouselPage((page) => Math.min(page, pageCount - 1));
  }, [pageCount]);

  useEffect(() => {
    setSelectedEventId(pageEvents[0]?.event.id);
  }, [pageEvents]);

  useEffect(() => {
    if (
      !signedIn ||
      latestQuery.isLoading ||
      overviewRunId ||
      startOverviewMutation.isPending
    ) {
      return;
    }
    const completedAt = latestQuery.data?.completedAt;
    const completedTime = completedAt ? new Date(completedAt).getTime() : 0;
    const nextCheckAt = Math.max(
      completedTime + CACHE_TTL_MS,
      localSuccessAtRef.current + CACHE_TTL_MS,
      retryNotBeforeRef.current,
    );
    const delay = nextCheckAt - Math.max(Date.now(), checkRequestedAt);
    if (delay > 0) {
      const timeout = window.setTimeout(
        () => setCheckRequestedAt(Date.now()),
        Math.min(delay, 2_147_000_000),
      );
      return () => window.clearTimeout(timeout);
    }
    if (retryNotBeforeRef.current > Date.now()) return;
    startOverviewMutation.mutate({
      mode: "overview",
      days: NEWS_DAYS,
      traceMaxDays: 365,
      traceMaxEvents: 30,
      idempotencyKey: `impact-news-overview:${Math.floor(Date.now() / CACHE_TTL_MS)}`,
    });
  }, [
    checkRequestedAt,
    latestQuery.data,
    latestQuery.isLoading,
    overviewRunId,
    signedIn,
    startOverviewMutation,
  ]);

  useEffect(() => {
    const run = overviewRunQuery.data;
    if (!run || handledOverviewRunIdRef.current === run.id) return;
    const disposition = getImpactAnalysisRunDisposition(run);
    if (disposition === "ready") {
      const parsed = asOverviewResult(run.result);
      if (parsed) {
        setRadarResult(parsed);
        setBaseRunId(run.id);
        setBaseSnapshotId(undefined);
        setCarouselPage(0);
        setAnalysisStates({});
        requestedAnalysisKeysRef.current.clear();
        localSuccessAtRef.current = Date.now();
      } else {
        retryNotBeforeRef.current = Date.now() + RETRY_DELAY_MS;
        setCheckRequestedAt(Date.now());
      }
      handledOverviewRunIdRef.current = run.id;
      setOverviewRunId(undefined);
      void utils.workflow.getLatestImpactMapping.invalidate();
    } else if (disposition === "failed" || disposition === "retry") {
      handledOverviewRunIdRef.current = run.id;
      retryNotBeforeRef.current =
        disposition === "retry"
          ? nextImpactOverviewRetryAt()
          : Date.now() + RETRY_DELAY_MS;
      setOverviewRunId(undefined);
      setCheckRequestedAt(Date.now());
    }
  }, [overviewRunQuery.data, utils.workflow.getLatestImpactMapping]);

  const handleAnalysisReady = useCallback(
    (eventId: string, result: unknown) => {
      const data = analysisFromResult(result);
      setAnalysisStates((current) => ({
        ...current,
        [eventId]: data
          ? { status: "ready", data }
          : { status: "error", message: "分析结果格式无效" },
      }));
    },
    [],
  );

  const handleAnalysisFailed = useCallback(
    (eventId: string, message: string) => {
      setAnalysisStates((current) => ({
        ...current,
        [eventId]: { status: "error", message },
      }));
    },
    [],
  );

  const requestAnalyses = useCallback(
    async (eventIds: string[], force = false) => {
      if ((!baseRunId && !baseSnapshotId) || eventIds.length === 0) return;
      const uniqueEventIds = [...new Set(eventIds)].slice(0, PAGE_SIZE);
      const baseId = baseRunId ?? baseSnapshotId;
      const requestKey = `${baseId}:${uniqueEventIds.join(",")}`;
      if (!force && requestedAnalysisKeysRef.current.has(requestKey)) return;
      requestedAnalysisKeysRef.current.add(requestKey);
      setAnalysisStates((current) => {
        const next = { ...current };
        for (const eventId of uniqueEventIds) {
          if (force || !next[eventId]) next[eventId] = { status: "loading" };
        }
        return next;
      });
      try {
        const records = await ensureMutation.mutateAsync({
          ...(baseRunId ? { baseRunId } : { baseSnapshotId }),
          eventIds: uniqueEventIds,
        });
        setAnalysisStates((current) => {
          const next = { ...current };
          for (const record of records) {
            next[record.eventId] = eventAnalysisStateFromEnsureRecord(record);
          }
          return next;
        });
      } catch (error) {
        requestedAnalysisKeysRef.current.delete(requestKey);
        const message =
          error instanceof Error ? error.message : "新闻分析加载失败";
        setAnalysisStates((current) => {
          const next = { ...current };
          for (const eventId of uniqueEventIds) {
            next[eventId] = { status: "error", message };
          }
          return next;
        });
      }
    },
    [baseRunId, baseSnapshotId, ensureMutation],
  );

  useEffect(() => {
    const missing = pageEvents
      .filter(
        (item) =>
          (!item.analysis || item.analysis.timeline.length === 0) &&
          analysisStates[item.event.id]?.status !== "ready",
      )
      .map((item) => item.event.id);
    void requestAnalyses(missing);
  }, [analysisStates, pageEvents, requestAnalyses]);

  useEffect(() => {
    if (!signedIn) return;
    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void latestQuery.refetch();
        setCheckRequestedAt(Date.now());
      }
    };
    document.addEventListener("visibilitychange", checkWhenVisible);
    return () =>
      document.removeEventListener("visibilitychange", checkWhenVisible);
  }, [latestQuery.refetch, signedIn]);

  if (!signedIn || events.length === 0) return null;

  const selectedItem =
    pageEvents.find((item) => item.event.id === selectedEventId) ??
    pageEvents[0];
  const selectedState = selectedItem
    ? analysisStates[selectedItem.event.id]
    : undefined;
  const selectedAnalysis = selectedItem
    ? selectedState?.status === "ready"
      ? selectedState.data
      : embeddedAnalysis(selectedItem)
    : null;

  return (
    <section
      data-testid="impact-mapping-workspace"
      className="px-4 py-5 lg:px-6"
    >
      {Object.entries(analysisStates).map(([eventId, state]) =>
        state.status === "loading" && state.runId ? (
          <AnalysisRunTracker
            key={`${eventId}:${state.runId}`}
            eventId={eventId}
            runId={state.runId}
            onReady={handleAnalysisReady}
            onFailed={handleAnalysisFailed}
            onTimedOut={(timedOutEventId) =>
              void requestAnalyses([timedOutEventId], true)
            }
          />
        ) : null,
      )}
      <div
        data-testid="impact-news-carousel"
        className="grid gap-3 md:grid-cols-3"
      >
        {pageEvents.map((item) => (
          <NewsCard
            key={item.event.id}
            item={item}
            selected={item.event.id === selectedItem?.event.id}
            analysisState={analysisStates[item.event.id]}
            onSelect={() => {
              setSelectedEventId(item.event.id);
              if (
                (!item.analysis || item.analysis.timeline.length === 0) &&
                !analysisStates[item.event.id]
              ) {
                void requestAnalyses([item.event.id]);
              }
            }}
          />
        ))}
      </div>
      {pageCount > 1 ? (
        <nav
          className="mt-4 flex items-center justify-between gap-3"
          aria-label="新闻轮播"
        >
          <button
            type="button"
            aria-label="上一页新闻"
            disabled={carouselPage === 0}
            onClick={() => setCarouselPage((page) => Math.max(0, page - 1))}
            className="app-button !min-h-9 !w-9 !rounded-full !p-0 disabled:opacity-35"
          >
            ←
          </button>
          <fieldset
            className="flex max-w-[70%] items-center gap-1.5 overflow-x-auto px-1"
            aria-label="新闻页码"
          >
            {Array.from({ length: pageCount }, (_, index) => (
              <button
                key={`page-${index + 1}`}
                type="button"
                aria-label={`第 ${index + 1} 页`}
                aria-current={index === carouselPage ? "page" : undefined}
                onClick={() => setCarouselPage(index)}
                className={`h-2 w-2 shrink-0 cursor-pointer rounded-full ${
                  index === carouselPage
                    ? "bg-[var(--app-brand)]"
                    : "bg-[var(--app-border-strong)]"
                }`}
              />
            ))}
          </fieldset>
          <button
            type="button"
            aria-label="下一页新闻"
            disabled={carouselPage >= pageCount - 1}
            onClick={() =>
              setCarouselPage((page) => Math.min(pageCount - 1, page + 1))
            }
            className="app-button !min-h-9 !w-9 !rounded-full !p-0 disabled:opacity-35"
          >
            →
          </button>
        </nav>
      ) : null}
      {selectedItem && selectedAnalysis ? (
        <NewsAnalysis item={selectedItem} analysis={selectedAnalysis} />
      ) : selectedItem && selectedState?.status === "error" ? (
        <div className="mt-6 flex min-h-40 items-center justify-between gap-4 border-t border-[var(--app-border-soft)] pt-5">
          <p className="text-sm text-[var(--app-text-muted)]">
            {selectedState.message}
          </p>
          <button
            type="button"
            className="app-button !rounded-[8px]"
            onClick={() => void requestAnalyses([selectedItem.event.id], true)}
          >
            重试
          </button>
        </div>
      ) : selectedItem ? (
        <AnalysisLoading />
      ) : null}
    </section>
  );
}

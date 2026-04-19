"use client";

import Link from "next/link";
import {
  type ComponentProps,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { statusTone } from "~/app/_components/status-tone";
import {
  EmptyState,
  KeyPointList,
  KpiCard,
  ProgressBar,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { buildWorkflowRunHistoryItems } from "~/app/_components/workspace-history";
import { buildResearchDigest } from "~/app/workflows/research-view-models";
import { buildRunDetailHref } from "~/app/workflows/run-detail-href";
import { api } from "~/trpc/react";

type WorkspaceSection = ComponentProps<typeof WorkspaceShell>["section"];
type HeaderAction = {
  href: string;
  label: string;
  tone?: "default" | "primary" | "success";
};

const pageSize = 18;
const historyHrefBySection: Record<WorkspaceSection, string | undefined> = {
  home: undefined,
  opportunityIntelligence: undefined,
  screening: "/screening/history",
  workflows: "/workflows/history",
  timing: "/timing/history",
  watchlists: undefined,
  companyResearch: "/company-research/history",
  spaces: undefined,
};

const statusLabelMap: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "进行中",
  PAUSED: "已暂停",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
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

function actionClassName(tone: HeaderAction["tone"] = "default") {
  if (tone === "primary") {
    return "app-button app-button-primary";
  }

  if (tone === "success") {
    return "app-button app-button-success";
  }

  return "app-button";
}

function isLiveRun(status: string | undefined) {
  return status === "PENDING" || status === "RUNNING" || status === "PAUSED";
}

export function WorkflowHistoryClient(props: {
  section: WorkspaceSection;
  eyebrow: string;
  title: string;
  description: string;
  emptyTitle: string;
  searchPlaceholder: string;
  moduleHref: string;
  moduleLabel: string;
  templateCode?: string;
  templateCodes?: string[];
  headerActions?: HeaderAction[];
}) {
  const {
    section,
    eyebrow,
    title,
    description,
    emptyTitle,
    searchPlaceholder,
    moduleHref,
    moduleLabel,
    templateCode,
    templateCodes,
    headerActions = [],
  } = props;
  const utils = api.useUtils();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim());
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const runsQuery = api.workflow.listRuns.useInfiniteQuery(
    {
      limit: pageSize,
      templateCode,
      templateCodes,
      search: deferredSearch || undefined,
    },
    {
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      refetchOnWindowFocus: false,
    },
  );

  const cancelMutation = api.workflow.cancelRun.useMutation({
    onSuccess: async (_, variables) => {
      await Promise.all([
        utils.workflow.listRuns.invalidate(),
        utils.workflow.getRun.invalidate({ runId: variables.runId }),
      ]);
    },
  });

  const runs = useMemo(() => {
    return runsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  }, [runsQuery.data]);
  const historyItems = useMemo(
    () => buildWorkflowRunHistoryItems(runs),
    [runs],
  );

  const liveCount = useMemo(() => {
    return runs.filter((run) => isLiveRun(run.status)).length;
  }, [runs]);

  const completedCount = useMemo(() => {
    return runs.filter((run) => run.status === "SUCCEEDED").length;
  }, [runs]);

  useEffect(() => {
    if (runs.length === 0) {
      setSelectedRunId(null);
      return;
    }

    if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0]?.id ?? null);
    }
  }, [runs, selectedRunId]);

  const selectedRunSummary =
    runs.find((run) => run.id === selectedRunId) ?? null;

  const runDetailQuery = api.workflow.getRun.useQuery(
    { runId: selectedRunId ?? "" },
    {
      enabled: Boolean(selectedRunId),
      refetchOnWindowFocus: false,
      refetchInterval: (query) =>
        isLiveRun(query.state.data?.status) ? 5_000 : false,
    },
  );

  const digest = buildResearchDigest({
    templateCode:
      runDetailQuery.data?.template.code ?? selectedRunSummary?.templateCode,
    query: runDetailQuery.data?.query ?? selectedRunSummary?.query,
    status: runDetailQuery.data?.status ?? selectedRunSummary?.status,
    progressPercent:
      runDetailQuery.data?.progressPercent ??
      selectedRunSummary?.progressPercent,
    currentNodeKey:
      runDetailQuery.data?.currentNodeKey ?? selectedRunSummary?.currentNodeKey,
    result: runDetailQuery.data?.result,
  });

  const summaryActions: HeaderAction[] = [
    { href: moduleHref, label: moduleLabel },
    ...headerActions,
  ];

  return (
    <WorkspaceShell
      section={section}
      sectionView="history"
      historyItems={historyItems}
      historyHref={historyHrefBySection[section]}
      activeHistoryId={selectedRunId ?? undefined}
      historyLoading={runsQuery.isLoading}
      historyEmptyText={emptyTitle}
      eyebrow={eyebrow}
      title={title}
      description={description}
      actions={summaryActions.map((action) => (
        <Link
          key={`${action.href}-${action.label}`}
          href={action.href}
          className={actionClassName(action.tone)}
        >
          {action.label}
        </Link>
      ))}
      summary={
        <>
          <KpiCard label="已加载记录" value={runs.length} tone="info" />
          <KpiCard label="进行中" value={liveCount} tone="warning" />
          <KpiCard label="已完成" value={completedCount} tone="success" />
          <KpiCard
            label="最近更新"
            value={formatDate(runs[0]?.createdAt ?? null)}
            hint="搜索会匹配标题、节点和报错"
            tone="neutral"
          />
        </>
      }
    >
      <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="app-panel p-4 sm:p-5">
          <div className="border-b border-[var(--app-border)] pb-4">
            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              搜索历史记录
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={searchPlaceholder}
                className="app-input"
              />
            </label>
            <p className="mt-3 text-xs leading-5 text-[var(--app-text-soft)]">
              结果会按最新时间排序。左侧用于浏览，右侧查看摘要与详情入口。
            </p>
          </div>

          <div className="mt-4 grid gap-3">
            {runsQuery.isLoading ? (
              <EmptyState title="正在加载历史记录" />
            ) : runs.length === 0 ? (
              <EmptyState title={emptyTitle} />
            ) : (
              runs.map((run) => {
                const live = isLiveRun(run.status);
                const active = run.id === selectedRunId;
                const previewDigest = buildResearchDigest({
                  templateCode: run.templateCode,
                  query: run.query,
                  status: run.status,
                  progressPercent: run.progressPercent,
                  currentNodeKey: run.currentNodeKey,
                });

                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setSelectedRunId(run.id)}
                    className={`rounded-[16px] border px-4 py-4 text-left transition-colors ${
                      active
                        ? "border-[var(--app-border-strong)] bg-[var(--app-panel-strong)]"
                        : "border-[var(--app-border)] bg-[var(--app-panel)] hover:border-[var(--app-border-strong)] hover:bg-[var(--app-panel-strong)]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill
                        label={previewDigest.templateLabel}
                        tone="info"
                      />
                      <StatusPill
                        label={statusLabelMap[run.status] ?? run.status}
                        tone={statusTone(run.status)}
                      />
                    </div>
                    <p className="mt-3 line-clamp-2 text-sm font-medium leading-6 text-[var(--app-text)]">
                      {run.query}
                    </p>
                    <p className="mt-2 line-clamp-2 text-sm leading-6 text-[var(--app-text-muted)]">
                      {previewDigest.summary}
                    </p>
                    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-[var(--app-text-soft)]">
                      <span>{formatDate(run.createdAt)}</span>
                      <span>{previewDigest.verdictLabel}</span>
                    </div>
                    {live ? (
                      <div className="mt-3">
                        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-[var(--app-text-soft)]">
                          <span>{run.currentNodeKey ?? "等待更新"}</span>
                          <span>{run.progressPercent}%</span>
                        </div>
                        <ProgressBar
                          value={run.progressPercent}
                          tone={statusTone(run.status)}
                        />
                      </div>
                    ) : null}
                    {run.errorMessage ? (
                      <p className="mt-3 line-clamp-2 text-xs leading-5 text-[var(--app-danger)]">
                        {run.errorMessage}
                      </p>
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          {runsQuery.hasNextPage ? (
            <button
              type="button"
              onClick={() => void runsQuery.fetchNextPage()}
              disabled={runsQuery.isFetchingNextPage}
              className="app-button mt-4 w-full"
            >
              {runsQuery.isFetchingNextPage ? "加载中..." : "加载更多"}
            </button>
          ) : null}
        </aside>

        <section className="app-panel p-4 sm:p-6">
          {!selectedRunId ? (
            <EmptyState
              title="选择一条记录查看详情"
              description="历史页会保留每次运行的结论摘要、状态变化与详情入口。"
            />
          ) : runDetailQuery.isLoading ? (
            <EmptyState title="正在加载详情" />
          ) : runDetailQuery.error ? (
            <EmptyState
              title="这条记录暂时无法读取"
              description={runDetailQuery.error.message}
            />
          ) : !runDetailQuery.data ? (
            <EmptyState title="未找到这条记录" />
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[var(--app-border)] pb-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill label={digest.templateLabel} tone="info" />
                    <StatusPill
                      label={
                        statusLabelMap[runDetailQuery.data.status] ??
                        runDetailQuery.data.status
                      }
                      tone={statusTone(runDetailQuery.data.status)}
                    />
                    <StatusPill
                      label={digest.verdictLabel}
                      tone={digest.verdictTone}
                    />
                  </div>
                  <h2 className="mt-4 text-2xl font-medium tracking-[-0.02em] text-[var(--app-text)]">
                    {runDetailQuery.data.query}
                  </h2>
                  <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--app-text-muted)]">
                    {digest.summary}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={buildRunDetailHref({
                      runId: runDetailQuery.data.id,
                      templateCode:
                        runDetailQuery.data.template.code ??
                        selectedRunSummary?.templateCode,
                    })}
                    className="app-button app-button-primary"
                  >
                    查看详情
                  </Link>
                  <Link
                    href={`/spaces?addRunId=${runDetailQuery.data.id}`}
                    className="app-button"
                  >
                    加入 Space
                  </Link>
                  {isLiveRun(runDetailQuery.data.status) ? (
                    <button
                      type="button"
                      onClick={() =>
                        cancelMutation.mutate({ runId: runDetailQuery.data.id })
                      }
                      disabled={cancelMutation.isPending}
                      className="app-button app-button-danger"
                    >
                      {cancelMutation.isPending ? "取消中..." : "取消任务"}
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-4">
                  <p className="text-xs text-[var(--app-text-soft)]">
                    发起时间
                  </p>
                  <p className="mt-2 text-sm font-medium text-[var(--app-text)]">
                    {formatDate(runDetailQuery.data.createdAt)}
                  </p>
                </div>
                <div className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-4">
                  <p className="text-xs text-[var(--app-text-soft)]">
                    完成时间
                  </p>
                  <p className="mt-2 text-sm font-medium text-[var(--app-text)]">
                    {formatDate(runDetailQuery.data.completedAt)}
                  </p>
                </div>
                <div className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-4">
                  <p className="text-xs text-[var(--app-text-soft)]">
                    当前节点
                  </p>
                  <p className="mt-2 text-sm font-medium text-[var(--app-text)]">
                    {runDetailQuery.data.currentNodeKey ?? "无活动节点"}
                  </p>
                </div>
                <div className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-4">
                  <p className="text-xs text-[var(--app-text-soft)]">
                    结果版本
                  </p>
                  <p className="mt-2 text-sm font-medium text-[var(--app-text)]">
                    v{runDetailQuery.data.template.version}
                  </p>
                </div>
              </div>

              {isLiveRun(runDetailQuery.data.status) ? (
                <div className="mt-5 rounded-[16px] border border-[var(--app-border)] bg-[var(--app-panel)] p-4">
                  <div className="mb-2 flex items-center justify-between gap-3 text-xs text-[var(--app-text-soft)]">
                    <span>
                      {runDetailQuery.data.currentNodeKey ?? "等待更新"}
                    </span>
                    <span>{runDetailQuery.data.progressPercent}%</span>
                  </div>
                  <ProgressBar
                    value={runDetailQuery.data.progressPercent}
                    tone={statusTone(runDetailQuery.data.status)}
                  />
                </div>
              ) : null}

              {runDetailQuery.data.errorMessage ? (
                <div className="mt-5 rounded-[16px] border border-[var(--app-danger-border)] bg-[var(--app-danger-surface)] px-4 py-3 text-sm text-[var(--app-danger)]">
                  {runDetailQuery.data.errorCode
                    ? `${runDetailQuery.data.errorCode}: `
                    : ""}
                  {runDetailQuery.data.errorMessage}
                </div>
              ) : null}

              <div className="mt-5 grid gap-3 xl:grid-cols-4">
                {digest.metrics.map((metric) => (
                  <div
                    key={`${runDetailQuery.data.id}-${metric.label}`}
                    className="rounded-[14px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-4"
                  >
                    <p className="text-xs text-[var(--app-text-soft)]">
                      {metric.label}
                    </p>
                    <p className="app-data mt-3 text-lg text-[var(--app-text)]">
                      {metric.value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mt-5 grid gap-3 xl:grid-cols-4">
                <KeyPointList
                  title="亮点"
                  items={digest.bullPoints}
                  emptyText="暂无亮点摘要"
                  tone="success"
                />
                <KeyPointList
                  title="风险"
                  items={digest.bearPoints}
                  emptyText="暂无风险摘要"
                  tone="warning"
                />
                <KeyPointList
                  title="证据"
                  items={digest.evidence}
                  emptyText="暂无证据摘要"
                  tone="info"
                />
                <KeyPointList
                  title="下一步"
                  items={
                    digest.nextActions.length > 0
                      ? digest.nextActions
                      : digest.gaps
                  }
                  emptyText="暂无后续动作"
                  tone="neutral"
                />
              </div>
            </>
          )}
        </section>
      </section>
    </WorkspaceShell>
  );
}

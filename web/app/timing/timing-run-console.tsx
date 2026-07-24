"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  EmptyState,
  InlineNotice,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { api } from "~/trpc/react";

const actionLabels: Record<string, string> = {
  WATCH: "观察",
  PROBE: "试仓",
  ENTER: "建仓",
  ADD: "加仓",
  HOLD: "持有",
  TRIM: "减仓",
  EXIT: "退出",
};

const statusLabels: Record<string, string> = {
  DATA_INCOMPLETE: "数据不完整",
  NOT_READY: "尚未就绪",
  FORMING: "形成中",
  TRIGGERED: "已触发",
  INVALIDATED: "已失效",
};

export function TimingRunConsole() {
  const utils = api.useUtils();
  const [watchListId, setWatchListId] = useState("");
  const [portfolioSnapshotId, setPortfolioSnapshotId] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [analysisDateMode, setAnalysisDateMode] = useState<
    "LATEST_COMPLETE" | "CURRENT_PARTIAL" | "EXPLICIT"
  >("LATEST_COMPLETE");
  const [asOfDate, setAsOfDate] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const watchlists = api.watchlist.list.useQuery({
    limit: 50,
    offset: 0,
    sortBy: "updatedAt",
    sortDirection: "desc",
  });
  const portfolios = api.timing.listPortfolioSnapshots.useQuery();
  const strategies = api.timing.listTimingStrategies.useQuery();
  const publishedRevisions = useMemo(
    () =>
      (strategies.data ?? []).flatMap((strategy) =>
        strategy.revisions
          .filter((revision) => revision.status === "PUBLISHED")
          .map((revision) => ({ ...revision, strategyName: strategy.name })),
      ),
    [strategies.data],
  );

  useEffect(() => {
    if (!watchListId && watchlists.data?.[0]?.id) {
      setWatchListId(watchlists.data[0].id);
    }
  }, [watchListId, watchlists.data]);
  useEffect(() => {
    if (!portfolioSnapshotId && portfolios.data?.[0]?.id) {
      setPortfolioSnapshotId(portfolios.data[0].id);
    }
  }, [portfolioSnapshotId, portfolios.data]);
  useEffect(() => {
    if (!revisionId && publishedRevisions[0]?.id) {
      setRevisionId(publishedRevisions[0].id);
    }
  }, [publishedRevisions, revisionId]);

  const preflight = api.timing.getTimingRunPreflight.useQuery(
    {
      watchListId,
      portfolioSnapshotId: portfolioSnapshotId || undefined,
      revisionId,
      analysisDateMode,
      asOfDate:
        analysisDateMode === "EXPLICIT" ? asOfDate || undefined : undefined,
    },
    {
      enabled: Boolean(
        watchListId &&
          revisionId &&
          (analysisDateMode !== "EXPLICIT" || asOfDate),
      ),
    },
  );
  const cards = api.timing.listTimingCards.useQuery({
    limit: 50,
    sourceType: "watchlist",
    watchListId: watchListId || undefined,
  });
  const recommendations = api.timing.listRecommendations.useQuery(
    {
      limit: 50,
      watchListId: watchListId || undefined,
      portfolioSnapshotId: portfolioSnapshotId || undefined,
    },
    { enabled: Boolean(watchListId && portfolioSnapshotId) },
  );
  const start = api.workflow.startWatchlistTimingPipeline.useMutation({
    onSuccess: async () => {
      setNotice("择时运行已进入队列，结果会自动刷新。");
      await Promise.all([
        utils.timing.listTimingCards.invalidate(),
        utils.timing.listRecommendations.invalidate(),
      ]);
    },
  });

  async function run() {
    if (
      !watchListId ||
      !portfolioSnapshotId ||
      !revisionId ||
      !preflight.data?.canRun
    )
      return;
    await start.mutateAsync({
      watchListId,
      portfolioSnapshotId,
      revisionId,
      analysisDateMode,
      asOfDate: analysisDateMode === "EXPLICIT" ? asOfDate : undefined,
    });
  }

  const resultRows = recommendations.data?.length
    ? recommendations.data
    : (cards.data ?? []);

  return (
    <WorkspaceShell
      section="timing"
      title="择时运行台"
      titleSize="compact"
      contentWidth="wide"
      actions={
        <Link
          href="/timing/strategies"
          className="app-button app-button-primary"
        >
          策略编辑器
        </Link>
      }
    >
      {notice ? <InlineNotice tone="success" description={notice} /> : null}
      {start.error ? (
        <InlineNotice tone="danger" description={start.error.message} />
      ) : null}

      <section className="border border-[var(--app-border-soft)] bg-[var(--app-surface)]">
        <div className="grid gap-4 border-b border-[var(--app-border-soft)] p-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="grid gap-2 text-sm">
            <span className="text-[var(--app-text-muted)]">目标自选股</span>
            <select
              className="app-input"
              value={watchListId}
              onChange={(event) => setWatchListId(event.target.value)}
            >
              <option value="">请选择</option>
              {(watchlists.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}（{item.stockCount}）
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="text-[var(--app-text-muted)]">组合快照</span>
            <select
              className="app-input"
              value={portfolioSnapshotId}
              onChange={(event) => setPortfolioSnapshotId(event.target.value)}
            >
              <option value="">请选择</option>
              {(portfolios.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="text-[var(--app-text-muted)]">已发布修订</span>
            <select
              className="app-input"
              value={revisionId}
              onChange={(event) => setRevisionId(event.target.value)}
            >
              <option value="">请选择</option>
              {publishedRevisions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.strategyName} · v{item.revisionNumber}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            <span className="text-[var(--app-text-muted)]">分析日期</span>
            <select
              className="app-input"
              value={analysisDateMode}
              onChange={(event) =>
                setAnalysisDateMode(
                  event.target.value as typeof analysisDateMode,
                )
              }
            >
              <option value="LATEST_COMPLETE">最新完整交易日</option>
              <option value="CURRENT_PARTIAL">当日不完整快照</option>
              <option value="EXPLICIT">指定交易日</option>
            </select>
          </label>
          {analysisDateMode === "EXPLICIT" ? (
            <label className="grid gap-2 text-sm">
              <span className="text-[var(--app-text-muted)]">交易日</span>
              <input
                type="date"
                className="app-input"
                value={asOfDate}
                onChange={(event) => setAsOfDate(event.target.value)}
              />
            </label>
          ) : (
            <div className="flex items-end">
              <button
                type="button"
                className="app-button app-button-primary w-full"
                disabled={
                  !preflight.data?.canRun ||
                  start.isPending ||
                  !portfolioSnapshotId
                }
                onClick={run}
              >
                {start.isPending ? "运行中" : "运行组合择时"}
              </button>
            </div>
          )}
        </div>
        {analysisDateMode === "EXPLICIT" ? (
          <div className="flex justify-end border-b border-[var(--app-border-soft)] p-4">
            <button
              type="button"
              className="app-button app-button-primary"
              disabled={
                !preflight.data?.canRun ||
                start.isPending ||
                !portfolioSnapshotId
              }
              onClick={run}
            >
              运行组合择时
            </button>
          </div>
        ) : null}

        <div className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-medium text-[var(--app-text-strong)]">
              数据预检
            </h2>
            {preflight.isFetching ? (
              <StatusPill label="检查中" tone="info" />
            ) : preflight.data ? (
              <StatusPill
                label={preflight.data.complete ? "完整" : "存在降级"}
                tone={preflight.data.complete ? "success" : "warning"}
              />
            ) : null}
          </div>
          {preflight.error ? (
            <InlineNotice tone="danger" description={preflight.error.message} />
          ) : null}
          {preflight.data ? (
            <div className="overflow-x-auto">
              <table className="app-table min-w-full">
                <thead>
                  <tr>
                    <th>股票</th>
                    <th>数据日</th>
                    <th>主判据</th>
                    <th>否决风险</th>
                    <th>异常</th>
                  </tr>
                </thead>
                <tbody>
                  {preflight.data.items.map((item) => (
                    <tr key={item.stockCode}>
                      <td>
                        <span className="font-medium text-[var(--app-text-strong)]">
                          {item.stockName}
                        </span>
                        <span className="ml-2 text-xs text-[var(--app-text-subtle)]">
                          {item.stockCode}
                        </span>
                      </td>
                      <td>{item.asOfDate}</td>
                      <td>
                        {item.primaryComplete
                          ? "完整"
                          : item.missingPrimary.join("、")}
                      </td>
                      <td>
                        {item.vetoRiskResolved
                          ? "已排除"
                          : item.unresolvedVetos.join("、")}
                      </td>
                      <td>
                        {item.warnings.length ? item.warnings.join("；") : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="选择目标和已发布策略后执行预检" />
          )}
        </div>
      </section>

      <section className="border border-[var(--app-border-soft)] bg-[var(--app-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--app-border-soft)] px-4 py-3">
          <h2 className="text-base font-medium text-[var(--app-text-strong)]">
            最近结果
          </h2>
          <Link
            href="/timing/history"
            className="text-sm text-[var(--app-brand)]"
          >
            查看历史
          </Link>
        </div>
        {resultRows.length ? (
          <div className="overflow-x-auto">
            <table className="app-table min-w-full">
              <thead>
                <tr>
                  <th>股票</th>
                  <th>状态</th>
                  <th>潜在动作</th>
                  <th>最终动作</th>
                  <th>规则通过</th>
                  <th>审计</th>
                </tr>
              </thead>
              <tbody>
                {resultRows.map((item) => {
                  const audit =
                    item.decisionAudit ?? item.reasoning?.decisionAudit;
                  const persistedAction =
                    "action" in item ? item.action : item.actionBias;
                  return (
                    <tr key={item.id}>
                      <td>
                        <span className="font-medium text-[var(--app-text-strong)]">
                          {item.stockName}
                        </span>
                        <span className="ml-2 text-xs text-[var(--app-text-subtle)]">
                          {item.stockCode}
                        </span>
                      </td>
                      <td>
                        {statusLabels[audit?.status ?? ""] ??
                          audit?.status ??
                          "-"}
                      </td>
                      <td>
                        {actionLabels[audit?.potentialAction ?? ""] ?? "无"}
                      </td>
                      <td className="font-medium text-[var(--app-text-strong)]">
                        {actionLabels[audit?.finalAction ?? persistedAction] ??
                          "无"}
                      </td>
                      <td>
                        {audit
                          ? `${audit.ruleEvaluations.filter((rule) => rule.status === "PASSED").length}/${audit.ruleEvaluations.length}`
                          : "-"}
                      </td>
                      <td>
                        {"signalSnapshotId" in item ? (
                          <Link
                            className="text-[var(--app-brand)]"
                            href={`/timing/reports/${item.id}`}
                          >
                            规则明细
                          </Link>
                        ) : (
                          <span className="text-[var(--app-text-subtle)]">
                            组合建议
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState title="暂无择时结果" />
          </div>
        )}
      </section>
    </WorkspaceShell>
  );
}

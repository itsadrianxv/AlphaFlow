"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  EmptyState,
  InlineNotice,
  KpiCard,
  SectionCard,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { formatDateTime } from "~/app/screening/screening-ui";
import { api, type RouterOutputs } from "~/trpc/react";

type WorkspaceSummary = RouterOutputs["screening"]["listWorkspaces"][number];

export function ScreeningHistoryClient() {
  const utils = api.useUtils();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null,
  );
  const [notice, setNotice] = useState<string | null>(null);

  const workspacesQuery = api.screening.listWorkspaces.useQuery(
    { limit: 100, offset: 0 },
    { refetchOnWindowFocus: false },
  );
  const workspaceDetailQuery = api.screening.getWorkspace.useQuery(
    { id: selectedWorkspaceId ?? "" },
    {
      enabled: selectedWorkspaceId !== null,
      refetchOnWindowFocus: false,
    },
  );
  const deleteWorkspaceMutation = api.screening.deleteWorkspace.useMutation({
    onSuccess: async () => {
      setNotice("工作台已删除");
      setSelectedWorkspaceId(null);
      await Promise.all([
        utils.screening.listWorkspaces.invalidate(),
        utils.screening.getWorkspace.invalidate(),
      ]);
    },
  });

  const workspaces = workspacesQuery.data ?? [];
  const latestFetchedCount = useMemo(
    () =>
      workspaces.filter((workspace: WorkspaceSummary) =>
        Boolean(workspace.lastFetchedAt),
      ).length,
    [workspaces],
  );

  useEffect(() => {
    if (workspaces.length === 0) {
      setSelectedWorkspaceId(null);
      return;
    }

    if (!selectedWorkspaceId) {
      setSelectedWorkspaceId(workspaces[0]?.id ?? null);
    }
  }, [selectedWorkspaceId, workspaces]);

  return (
    <WorkspaceShell
      section="screening"
      sectionView="history"
      title="已保存工作台库"
      description="浏览最近保存的小批量筛选工作台，查看上次快照摘要，并回到主工作台继续手动刷新。"
      actions={
        <Link href="/screening" className="app-button app-button-primary">
          返回工作台
        </Link>
      }
      summary={
        <>
          <KpiCard label="工作台总数" value={workspaces.length} tone="info" />
          <KpiCard
            label="已获取过数据"
            value={latestFetchedCount}
            tone="success"
          />
          <KpiCard
            label="最近更新"
            value={
              workspaces[0] ? formatDateTime(workspaces[0].updatedAt) : "-"
            }
            tone="neutral"
          />
          <KpiCard
            label="最近获取"
            value={
              workspaces[0] ? formatDateTime(workspaces[0].lastFetchedAt) : "-"
            }
            tone="warning"
          />
        </>
      }
    >
      {notice ? <InlineNotice tone="success" description={notice} /> : null}
      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <SectionCard title="工作台列表" className="xl:col-span-1">
          {workspaces.length === 0 ? (
            <EmptyState
              title="还没有保存过工作台"
              description="在 /screening 里完成选择后，手动点击“保存工作台”就会出现在这里。"
            />
          ) : (
            <div className="grid gap-3">
              {workspaces.map((workspace: WorkspaceSummary) => (
                <button
                  key={workspace.id}
                  type="button"
                  onClick={() => setSelectedWorkspaceId(workspace.id)}
                  className={`rounded-[12px] border px-4 py-4 text-left ${
                    selectedWorkspaceId === workspace.id
                      ? "border-[var(--app-border-strong)] bg-[var(--app-bg-floating)]"
                      : "border-[var(--app-border-soft)] bg-[var(--app-bg-inset)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-[var(--app-text)]">
                      {workspace.name}
                    </div>
                    <StatusPill
                      label={workspace.lastFetchedAt ? "有快照" : "未获取"}
                      tone={workspace.lastFetchedAt ? "success" : "neutral"}
                    />
                  </div>
                  <div className="mt-2 text-xs text-[var(--app-text-subtle)]">
                    股票 {workspace.stockCount} · 指标{" "}
                    {workspace.indicatorCount} · 公式 {workspace.formulaCount}
                  </div>
                  <div className="mt-2 text-xs text-[var(--app-text-subtle)]">
                    更新于 {formatDateTime(workspace.updatedAt)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="工作台详情" className="xl:col-span-1">
          {!selectedWorkspaceId ? (
            <EmptyState title="请选择一个工作台" />
          ) : workspaceDetailQuery.isLoading ? (
            <EmptyState title="正在加载工作台详情" />
          ) : !workspaceDetailQuery.data ? (
            <EmptyState title="未找到这个工作台" />
          ) : (
            <div className="grid gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--app-border-soft)] pb-4">
                <div>
                  <div className="text-xl font-medium text-[var(--app-text)]">
                    {workspaceDetailQuery.data.name}
                  </div>
                  <div className="mt-2 text-sm text-[var(--app-text-muted)]">
                    {workspaceDetailQuery.data.description ?? "暂无描述"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link
                    href={`/screening?workspaceId=${workspaceDetailQuery.data.id}`}
                    className="app-button app-button-primary"
                  >
                    打开工作台
                  </Link>
                  <button
                    type="button"
                    onClick={() =>
                      void deleteWorkspaceMutation.mutateAsync({
                        id: workspaceDetailQuery.data.id,
                      })
                    }
                    className="app-button"
                  >
                    删除
                  </button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[12px] border border-[var(--app-border-soft)] p-3 text-sm text-[var(--app-text-muted)]">
                  选股数量
                  <div className="mt-2 text-lg text-[var(--app-text)]">
                    {workspaceDetailQuery.data.state.stockCodes.length}
                  </div>
                </div>
                <div className="rounded-[12px] border border-[var(--app-border-soft)] p-3 text-sm text-[var(--app-text-muted)]">
                  官方指标
                  <div className="mt-2 text-lg text-[var(--app-text)]">
                    {workspaceDetailQuery.data.state.indicatorIds.length}
                  </div>
                </div>
                <div className="rounded-[12px] border border-[var(--app-border-soft)] p-3 text-sm text-[var(--app-text-muted)]">
                  公式数量
                  <div className="mt-2 text-lg text-[var(--app-text)]">
                    {workspaceDetailQuery.data.state.formulaIds.length}
                  </div>
                </div>
                <div className="rounded-[12px] border border-[var(--app-border-soft)] p-3 text-sm text-[var(--app-text-muted)]">
                  最近获取
                  <div className="mt-2 text-sm text-[var(--app-text)]">
                    {formatDateTime(
                      workspaceDetailQuery.data.state.lastFetchedAt,
                    )}
                  </div>
                </div>
              </div>
              <div className="rounded-[12px] border border-[var(--app-border-soft)] p-4">
                <div className="text-sm font-medium text-[var(--app-text)]">
                  当前配置
                </div>
                <div className="mt-3 text-sm text-[var(--app-text-muted)]">
                  {workspaceDetailQuery.data.state.timeConfig.periodType} ·{" "}
                  {workspaceDetailQuery.data.state.timeConfig.rangeMode ===
                  "PRESET"
                    ? workspaceDetailQuery.data.state.timeConfig.presetKey
                    : `${workspaceDetailQuery.data.state.timeConfig.customStart} - ${workspaceDetailQuery.data.state.timeConfig.customEnd}`}
                </div>
                <div className="mt-3 text-sm text-[var(--app-text-muted)]">
                  本地规则 {workspaceDetailQuery.data.state.filterRules.length}{" "}
                  条
                </div>
              </div>
              <div className="rounded-[12px] border border-[var(--app-border-soft)] p-4">
                <div className="text-sm font-medium text-[var(--app-text)]">
                  上次结果快照
                </div>
                {workspaceDetailQuery.data.state.resultSnapshot ? (
                  <div className="mt-3 text-sm text-[var(--app-text-muted)]">
                    期间{" "}
                    {workspaceDetailQuery.data.state.resultSnapshot.periods.join(
                      ", ",
                    )}
                    <div className="mt-2">
                      结果行数{" "}
                      {
                        workspaceDetailQuery.data.state.resultSnapshot.rows
                          .length
                      }{" "}
                      · warnings{" "}
                      {
                        workspaceDetailQuery.data.state.resultSnapshot.warnings
                          .length
                      }
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-sm text-[var(--app-text-muted)]">
                    这个工作台还没有保存过数据快照。
                  </div>
                )}
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </WorkspaceShell>
  );
}

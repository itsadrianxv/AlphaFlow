"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  cn,
  EmptyState,
  InlineNotice,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import {
  PI_AGENT_SELECTION_DRAFT_QUERY,
  writePiAgentSelectionDraft,
} from "~/app/agent-runtime/selection-draft";
import { api, type RouterOutputs } from "~/trpc/react";

type ScheduledTask = RouterOutputs["scheduledTask"]["list"][number];
type StatusFilter = "ALL" | ScheduledTask["status"];

const statusMeta = {
  DRAFT: { label: "草稿", tone: "neutral" },
  ACTIVE: { label: "运行中", tone: "success" },
  PAUSED: { label: "已暂停", tone: "warning" },
  CANCELLED: { label: "已取消", tone: "neutral" },
} as const;

const filters: Array<{ value: StatusFilter; label: string }> = [
  { value: "ALL", label: "全部" },
  { value: "ACTIVE", label: "运行中" },
  { value: "PAUSED", label: "已暂停" },
  { value: "CANCELLED", label: "已取消" },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatSchedule(value: unknown) {
  const schedule = asRecord(value);
  const time = typeof schedule.time === "string" ? schedule.time : "--:--";
  if (schedule.type === "TRADING_DAY") return `每个交易日 ${time}`;
  if (schedule.type === "WEEKLY") {
    const weekdays = Array.isArray(schedule.weekdays)
      ? schedule.weekdays.filter(
          (item): item is number => typeof item === "number",
        )
      : [];
    const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    const label = weekdays
      .map((day) => names[day])
      .filter(Boolean)
      .join("、");
    return `${label || "每周"} ${time}`;
  }
  return `每天 ${time}`;
}

function formatSources(task: ScheduledTask) {
  const plan = asRecord(task.versions[0]?.executionPlan);
  const sources = Array.isArray(plan.dataSources)
    ? plan.dataSources
    : Array.isArray(plan.allowedCapabilities)
      ? plan.allowedCapabilities
      : [];
  const labels = sources.flatMap((source) => {
    if (typeof source === "string") return [source.replace(/^internal_/, "")];
    const record = asRecord(source);
    const value = record.provider ?? record.capability;
    return typeof value === "string" ? [value] : [];
  });
  return labels.length > 0
    ? labels.slice(0, 3).join("、")
    : "由 Agent 按计划调用";
}

function formatDate(value: Date | string | null) {
  if (!value) return "未排期";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function TaskActions(props: {
  task: ScheduledTask;
  busy: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  detailHref: string;
}) {
  const { task, busy, onPause, onResume, onCancel, detailHref } = props;
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Link className="app-button" href={detailHref}>
        详情
      </Link>
      {task.status !== "CANCELLED" ? (
        <Link className="app-button" href={`${detailHref}#edit`}>
          编辑
        </Link>
      ) : null}
      {task.status === "ACTIVE" ? (
        <button
          type="button"
          className="app-button"
          disabled={busy}
          onClick={onPause}
        >
          暂停
        </button>
      ) : task.status === "PAUSED" ? (
        <button
          type="button"
          className="app-button"
          disabled={busy}
          onClick={onResume}
        >
          恢复
        </button>
      ) : null}
      {task.status !== "CANCELLED" ? (
        <button
          type="button"
          className="app-button app-button-danger"
          disabled={busy}
          onClick={onCancel}
        >
          取消
        </button>
      ) : null}
    </div>
  );
}

export function ScheduledTasksClient() {
  const router = useRouter();
  const utils = api.useUtils();
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = api.scheduledTask.list.useQuery();
  const refresh = async (message: string) => {
    setError(null);
    setNotice(message);
    await utils.scheduledTask.list.invalidate();
  };
  const pause = api.scheduledTask.pause.useMutation({
    onSuccess: () => refresh("任务已暂停。"),
    onError: (next) => setError(next.message),
  });
  const resume = api.scheduledTask.resume.useMutation({
    onSuccess: () => refresh("任务已恢复。"),
    onError: (next) => setError(next.message),
  });
  const cancel = api.scheduledTask.cancel.useMutation({
    onSuccess: () => refresh("任务已取消。"),
    onError: (next) => setError(next.message),
  });
  const tasks = useMemo(
    () =>
      (query.data ?? []).filter(
        (task) => filter === "ALL" || task.status === filter,
      ),
    [filter, query.data],
  );
  const busy = pause.isPending || resume.isPending || cancel.isPending;
  const createAgentTask = () => {
    writePiAgentSelectionDraft({
      text: "我想创建一个定时任务。请先询问我希望持续关注的信息、执行时间和输出方式，然后评估数据能力并生成任务预览，等待我确认后再创建。",
      createdAt: new Date().toISOString(),
      source: { type: "scheduled-task" },
    });
    router.push(`/agent-runtime?draft=${PI_AGENT_SELECTION_DRAFT_QUERY}`);
  };

  return (
    <WorkspaceShell
      section="scheduledTasks"
      title="定时任务"
      description="管理评分任务、信息订阅、执行计划和发送状态。"
      titleSize="compact"
      showHistory={false}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="app-button"
            onClick={createAgentTask}
          >
            Agent 任务
          </button>
          <Link
            href="/scheduled-tasks/builder"
            className="app-button app-button-primary"
          >
            新建评分任务
          </Link>
        </div>
      }
    >
      {notice ? <InlineNotice tone="success" description={notice} /> : null}
      {error ? <InlineNotice tone="danger" description={error} /> : null}

      <section className="overflow-hidden rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel)]">
        <div className="flex flex-col gap-3 border-b border-[var(--app-border-soft)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <nav
            className="flex min-w-0 overflow-x-auto"
            aria-label="任务状态筛选"
          >
            {filters.map((item) => (
              <button
                key={item.value}
                type="button"
                aria-pressed={filter === item.value}
                className={cn(
                  "shrink-0 border-b-2 px-3 py-2 text-sm transition-colors",
                  filter === item.value
                    ? "border-[var(--app-accent-strong)] text-[var(--app-text-strong)]"
                    : "border-transparent text-[var(--app-text-muted)] hover:text-[var(--app-text-strong)]",
                )}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="text-sm text-[var(--app-text-subtle)]">
            共 {tasks.length} 个任务
          </div>
        </div>

        {query.isLoading ? (
          <div className="p-6">
            <EmptyState title="正在加载定时任务" />
          </div>
        ) : query.error ? (
          <div className="p-6">
            <InlineNotice tone="danger" description={query.error.message} />
          </div>
        ) : tasks.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title={filter === "ALL" ? "还没有定时任务" : "当前筛选下没有任务"}
              description={
                filter === "ALL"
                  ? "通过 Agent 描述你想持续关注的信息和执行时间。"
                  : undefined
              }
              actions={
                filter === "ALL" ? (
                  <Link
                    href="/scheduled-tasks/builder"
                    className="app-button app-button-primary"
                  >
                    新建任务
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="app-table min-w-[860px]">
                <thead>
                  <tr>
                    <th>任务</th>
                    <th>执行计划</th>
                    <th>数据来源</th>
                    <th>下次执行</th>
                    <th>状态</th>
                    <th>
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((task) => {
                    const version = task.versions[0];
                    const recent = task.executions[0];
                    const recentResult = asRecord(recent?.result);
                    const meta = statusMeta[task.status];
                    return (
                      <tr key={task.id}>
                        <td>
                          <div className="font-medium text-[var(--app-text-strong)]">
                            {task.name}
                          </div>
                          <div className="mt-1 max-w-[260px] truncate text-xs text-[var(--app-text-subtle)]">
                            {version?.userPrompt}
                          </div>
                        </td>
                        <td>{formatSchedule(version?.scheduleSpec)}</td>
                        <td>{formatSources(task)}</td>
                        <td>
                          <div className="text-[var(--app-text-strong)]">
                            {formatDate(task.nextRunAt)}
                          </div>
                          <div className="mt-1 text-xs text-[var(--app-text-subtle)]">
                            {task.timezone}
                          </div>
                          <div className="mt-1 text-xs text-[var(--app-text-subtle)]">
                            最近执行：{formatDate(recent?.completedAt ?? null)}
                            {recentResult.asOfDate
                              ? ` · 数据截止 ${String(recentResult.asOfDate)}`
                              : ""}
                            {typeof recentResult.selectedCount === "number"
                              ? ` · 入选 ${recentResult.selectedCount} 只`
                              : ""}
                            {recent?.deliveries[0]?.status
                              ? ` · 投递 ${recent.deliveries[0].status}`
                              : ""}
                          </div>
                        </td>
                        <td>
                          <StatusPill label={meta.label} tone={meta.tone} />
                        </td>
                        <td>
                          <TaskActions
                            task={task}
                            busy={busy}
                            onPause={() => pause.mutate({ id: task.id })}
                            onResume={() => resume.mutate({ id: task.id })}
                            onCancel={() => cancel.mutate({ id: task.id })}
                            detailHref={`/scheduled-tasks/${task.id}`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="divide-y divide-[var(--app-border-soft)] md:hidden">
              {tasks.map((task) => {
                const version = task.versions[0];
                const meta = statusMeta[task.status];
                return (
                  <article key={task.id} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-base font-medium text-[var(--app-text-strong)]">
                          {task.name}
                        </h2>
                        <p className="mt-1 line-clamp-2 text-sm text-[var(--app-text-muted)]">
                          {version?.userPrompt}
                        </p>
                      </div>
                      <StatusPill label={meta.label} tone={meta.tone} />
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                      <div>
                        <dt className="text-[var(--app-text-subtle)]">
                          执行计划
                        </dt>
                        <dd className="mt-1 text-[var(--app-text-strong)]">
                          {formatSchedule(version?.scheduleSpec)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[var(--app-text-subtle)]">
                          下次执行
                        </dt>
                        <dd className="mt-1 text-[var(--app-text-strong)]">
                          {formatDate(task.nextRunAt)}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-4 border-t border-[var(--app-border-soft)] pt-3">
                      <TaskActions
                        task={task}
                        busy={busy}
                        onPause={() => pause.mutate({ id: task.id })}
                        onResume={() => resume.mutate({ id: task.id })}
                        onCancel={() => cancel.mutate({ id: task.id })}
                        detailHref={`/scheduled-tasks/${task.id}`}
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>
    </WorkspaceShell>
  );
}

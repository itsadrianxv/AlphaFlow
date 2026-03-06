"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "~/trpc/react";

type RunDetailClientProps = {
  runId: string;
};

type StreamEvent = {
  runId: string;
  sequence: number;
  type: string;
  nodeKey?: string;
  progressPercent: number;
  timestamp: string;
  payload: Record<string, unknown>;
};

function formatDate(value?: Date | string | null) {
  if (!value) {
    return "-";
  }

  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

const statusStyles: Record<string, string> = {
  PENDING: "text-amber-300",
  RUNNING: "text-cyan-300",
  SUCCEEDED: "text-emerald-300",
  FAILED: "text-rose-300",
  CANCELLED: "text-slate-300",
};

export function RunDetailClient({ runId }: RunDetailClientProps) {
  const utils = api.useUtils();
  const [streamEvents, setStreamEvents] = useState<StreamEvent[]>([]);
  const [streamError, setStreamError] = useState<string | null>(null);

  const runQuery = api.workflow.getRun.useQuery(
    { runId },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        if (status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED") {
          return false;
        }

        return 10_000;
      },
    },
  );

  const cancelMutation = api.workflow.cancelRun.useMutation({
    onSuccess: async () => {
      await utils.workflow.getRun.invalidate({ runId });
    },
  });

  useEffect(() => {
    const eventSource = new EventSource(`/api/workflows/runs/${runId}/events`);

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as StreamEvent;
        setStreamEvents((previous) => {
          if (previous.some((item) => item.sequence === parsed.sequence)) {
            return previous;
          }

          return [...previous, parsed].sort((left, right) => left.sequence - right.sequence);
        });

        void utils.workflow.getRun.invalidate({ runId });

        if (
          parsed.type === "RUN_SUCCEEDED" ||
          parsed.type === "RUN_FAILED" ||
          parsed.type === "RUN_CANCELLED"
        ) {
          eventSource.close();
        }
      } catch {
        setStreamError("实时事件解析失败");
      }
    };

    eventSource.onerror = () => {
      setStreamError("实时连接中断，页面将继续轮询刷新。");
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [runId, utils.workflow.getRun]);

  const timeline = useMemo(() => {
    const dbEvents =
      runQuery.data?.events.map((event) => ({
        runId,
        sequence: event.sequence,
        type: event.eventType,
        nodeKey:
          typeof (event.payload as Record<string, unknown> | null)?.nodeKey === "string"
            ? ((event.payload as Record<string, unknown>).nodeKey as string)
            : undefined,
        progressPercent: runQuery.data?.progressPercent ?? 0,
        timestamp: event.occurredAt.toISOString(),
        payload: (event.payload ?? {}) as Record<string, unknown>,
      })) ?? [];

    const merged = [...dbEvents, ...streamEvents];
    const uniqueBySequence = new Map<number, StreamEvent>();

    for (const event of merged) {
      uniqueBySequence.set(event.sequence, event);
    }

    return [...uniqueBySequence.values()].sort((left, right) => right.sequence - left.sequence);
  }, [runId, runQuery.data?.events, runQuery.data?.progressPercent, streamEvents]);

  const run = runQuery.data;

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#071018] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_16%,rgba(34,211,238,0.2),transparent_38%),radial-gradient(circle_at_86%_14%,rgba(245,158,11,0.2),transparent_35%),radial-gradient(circle_at_70%_84%,rgba(52,211,153,0.15),transparent_36%)]" />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
        <header className="rounded-3xl border border-slate-700/70 bg-slate-900/55 p-6 backdrop-blur md:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs tracking-[0.35em] text-cyan-300">RUN DETAIL</p>
              <h1 className="mt-3 text-2xl font-semibold text-white md:text-3xl">工作流运行详情</h1>
              <p className="mt-2 text-xs text-slate-400">runId: {runId}</p>
            </div>
            <div className="flex gap-2">
              <Link
                href="/workflows"
                className="rounded-full border border-slate-500 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
              >
                返回列表
              </Link>
              {run && (run.status === "RUNNING" || run.status === "PENDING") ? (
                <button
                  type="button"
                  onClick={() => cancelMutation.mutate({ runId })}
                  className="rounded-full border border-amber-400/70 px-4 py-2 text-sm text-amber-200 transition hover:bg-amber-500/10"
                >
                  取消任务
                </button>
              ) : null}
            </div>
          </div>
        </header>

        {!run ? (
          <section className="rounded-2xl border border-slate-700/60 bg-slate-900/55 p-5 text-sm text-slate-300">
            {runQuery.isLoading ? "加载运行信息..." : runQuery.error?.message ?? "未找到该运行"}
          </section>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-4">
              <article className="rounded-2xl border border-slate-700/60 bg-slate-900/55 p-4">
                <p className="text-xs text-slate-500">状态</p>
                <p className={`mt-2 text-lg font-semibold ${statusStyles[run.status] ?? "text-slate-100"}`}>
                  {run.status}
                </p>
              </article>
              <article className="rounded-2xl border border-slate-700/60 bg-slate-900/55 p-4">
                <p className="text-xs text-slate-500">当前节点</p>
                <p className="mt-2 text-sm text-slate-200">{run.currentNodeKey ?? "-"}</p>
              </article>
              <article className="rounded-2xl border border-slate-700/60 bg-slate-900/55 p-4">
                <p className="text-xs text-slate-500">创建时间</p>
                <p className="mt-2 text-sm text-slate-200">{formatDate(run.createdAt)}</p>
              </article>
              <article className="rounded-2xl border border-slate-700/60 bg-slate-900/55 p-4">
                <p className="text-xs text-slate-500">完成时间</p>
                <p className="mt-2 text-sm text-slate-200">{formatDate(run.completedAt)}</p>
              </article>
            </section>

            <section className="rounded-2xl border border-slate-700/60 bg-slate-900/55 p-5">
              <p className="text-sm text-slate-200">任务主题: {run.query}</p>
              <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-cyan-400 transition-all"
                  style={{ width: `${run.progressPercent}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-cyan-200">总体进度 {run.progressPercent}%</p>
              {run.errorMessage ? (
                <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                  {run.errorCode ? `${run.errorCode}: ` : ""}
                  {run.errorMessage}
                </p>
              ) : null}
            </section>

            <section className="rounded-2xl border border-slate-700/60 bg-slate-900/55 p-5">
              <h2 className="text-lg font-semibold text-white">节点状态</h2>
              <div className="mt-4 grid gap-3">
                {run.nodes.map((node) => (
                  <article
                    key={node.id}
                    className="rounded-xl border border-slate-700/70 bg-slate-950/35 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-slate-200">{node.nodeKey}</p>
                        <p className="text-xs text-slate-500">agent: {node.agentName}</p>
                      </div>
                      <p className={`text-sm ${statusStyles[node.status] ?? "text-slate-200"}`}>
                        {node.status}
                      </p>
                    </div>
                    <p className="mt-2 text-xs text-slate-400">
                      开始 {formatDate(node.startedAt)} | 结束 {formatDate(node.completedAt)} | 耗时 {" "}
                      {node.durationMs ?? "-"} ms
                    </p>
                    {node.errorMessage ? (
                      <p className="mt-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                        {node.errorCode ? `${node.errorCode}: ` : ""}
                        {node.errorMessage}
                      </p>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>

            {run.result ? (
              <section className="rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-5">
                <h2 className="text-lg font-semibold text-emerald-200">最终报告</h2>
                <pre className="mt-3 overflow-auto rounded-xl border border-emerald-500/20 bg-slate-950/35 p-4 text-xs leading-6 text-slate-200">
                  {JSON.stringify(run.result, null, 2)}
                </pre>
              </section>
            ) : null}

            <section className="rounded-2xl border border-slate-700/60 bg-slate-900/55 p-5">
              <h2 className="text-lg font-semibold text-white">事件时间线</h2>
              {timeline.length === 0 ? (
                <p className="mt-3 text-sm text-slate-400">暂无事件。</p>
              ) : (
                <div className="mt-3 grid gap-2">
                  {timeline.map((event) => (
                    <article
                      key={`${event.sequence}-${event.type}`}
                      className="rounded-lg border border-slate-700/60 bg-slate-950/35 px-3 py-2"
                    >
                      <p className="text-xs text-slate-400">
                        #{event.sequence} · {event.type} · {event.nodeKey ?? "run"} · {" "}
                        {formatDate(event.timestamp)}
                      </p>
                    </article>
                  ))}
                </div>
              )}
              {streamError ? (
                <p className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {streamError}
                </p>
              ) : null}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

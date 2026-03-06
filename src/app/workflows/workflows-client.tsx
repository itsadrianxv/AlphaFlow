"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "~/trpc/react";

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

const statusColorMap: Record<string, string> = {
  PENDING: "text-amber-300",
  RUNNING: "text-cyan-300",
  SUCCEEDED: "text-emerald-300",
  FAILED: "text-rose-300",
  CANCELLED: "text-slate-300",
};

export function WorkflowsClient() {
  const router = useRouter();
  const utils = api.useUtils();
  const [query, setQuery] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const runsQuery = api.workflow.listRuns.useQuery({
    limit: 20,
  });

  const startMutation = api.workflow.startQuickResearch.useMutation({
    onSuccess: async (result) => {
      await utils.workflow.listRuns.invalidate();
      router.push(`/workflows/${result.runId}`);
    },
  });

  const cancelMutation = api.workflow.cancelRun.useMutation({
    onSuccess: async () => {
      await utils.workflow.listRuns.invalidate();
    },
  });

  const sortedRuns = useMemo(() => {
    return [...(runsQuery.data?.items ?? [])].sort((left, right) => {
      return (right.createdAt?.getTime?.() ?? 0) - (left.createdAt?.getTime?.() ?? 0);
    });
  }, [runsQuery.data?.items]);

  const handleStart = async () => {
    if (!query.trim()) {
      return;
    }

    await startMutation.mutateAsync({
      query: query.trim(),
      idempotencyKey: idempotencyKey.trim() || undefined,
    });
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#04111d] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(56,189,248,0.22),transparent_40%),radial-gradient(circle_at_78%_8%,rgba(251,191,36,0.18),transparent_33%),radial-gradient(circle_at_68%_86%,rgba(16,185,129,0.16),transparent_38%)]" />
      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-10">
        <header className="rounded-3xl border border-slate-700/70 bg-slate-900/55 p-6 backdrop-blur md:p-8">
          <p className="text-xs tracking-[0.35em] text-cyan-300">WORKFLOW STUDIO</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-4xl">
            LangGraph 快速行业研究
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-300">
            固定 5-Agent 工作流已接入异步执行。输入赛道关键词后将立即返回 runId，后台 Worker 继续执行并推送实时进度。
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/"
              className="rounded-full border border-slate-500 bg-slate-950/40 px-4 py-2 text-sm text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
            >
              返回首页
            </Link>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-700/60 bg-slate-900/55 p-5 backdrop-blur">
          <h2 className="text-lg font-semibold text-white">发起新任务</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-[2fr_1fr_auto]">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="例如：快速了解 AI 算力赛道"
              className="rounded-xl border border-slate-600 bg-slate-950/40 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
            />
            <input
              value={idempotencyKey}
              onChange={(event) => setIdempotencyKey(event.target.value)}
              placeholder="幂等键（可选）"
              className="rounded-xl border border-slate-600 bg-slate-950/40 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleStart}
              disabled={startMutation.isPending}
              className="rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {startMutation.isPending ? "创建中..." : "启动研究"}
            </button>
          </div>
          {startMutation.error ? (
            <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {startMutation.error.message}
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-700/60 bg-slate-900/55 p-5 backdrop-blur">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">最近运行</h2>
            <button
              type="button"
              onClick={() => runsQuery.refetch()}
              className="rounded-full border border-slate-600 px-3 py-1 text-xs text-slate-300 transition hover:border-cyan-400 hover:text-cyan-200"
            >
              刷新
            </button>
          </div>

          {runsQuery.isLoading ? (
            <p className="mt-4 text-sm text-slate-300">加载中...</p>
          ) : sortedRuns.length === 0 ? (
            <p className="mt-4 text-sm text-slate-400">暂无运行记录。</p>
          ) : (
            <div className="mt-4 grid gap-3">
              {sortedRuns.map((run) => (
                <article
                  key={run.id}
                  className="grid gap-3 rounded-xl border border-slate-700/70 bg-slate-950/35 p-4 md:grid-cols-[2fr_1fr_1fr_auto]"
                >
                  <div>
                    <p className="text-sm text-slate-200">{run.query}</p>
                    <p className="mt-1 text-xs text-slate-500">runId: {run.id}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      创建于 {formatDate(run.createdAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">状态</p>
                    <p className={`text-sm font-semibold ${statusColorMap[run.status] ?? "text-slate-200"}`}>
                      {run.status}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">进度</p>
                    <p className="text-sm text-cyan-200">{run.progressPercent}%</p>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                      <div
                        className="h-full rounded-full bg-cyan-400 transition-all"
                        style={{ width: `${run.progressPercent}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-start justify-end gap-2">
                    <Link
                      href={`/workflows/${run.id}`}
                      className="rounded-full border border-cyan-500/70 px-3 py-1 text-xs text-cyan-200 transition hover:bg-cyan-500/10"
                    >
                      详情
                    </Link>
                    {(run.status === "PENDING" || run.status === "RUNNING") && (
                      <button
                        type="button"
                        onClick={() => cancelMutation.mutate({ runId: run.id })}
                        className="rounded-full border border-amber-400/70 px-3 py-1 text-xs text-amber-200 transition hover:bg-amber-500/10"
                      >
                        取消
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          {runsQuery.error ? (
            <p className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {runsQuery.error.message}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

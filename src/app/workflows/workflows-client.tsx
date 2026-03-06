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

const statusStyleMap: Record<string, string> = {
  PENDING: "text-[#ffd180]",
  RUNNING: "text-[#71dcff]",
  SUCCEEDED: "text-[#63f2c1]",
  FAILED: "text-[#ff93a2]",
  CANCELLED: "text-[#b3c5d7]",
};

const statusLabelMap: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "进行中",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
};

const quickPrompts = [
  "半导体设备国产替代，未来 12 个月核心机会与风险",
  "创新药出海链条中，最值得跟踪的商业化指标",
  "AI 算力基础设施，盈利兑现节奏如何判断",
];

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
      return (
        (right.createdAt?.getTime?.() ?? 0) - (left.createdAt?.getTime?.() ?? 0)
      );
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
    <main className="market-shell px-6 py-10 text-[var(--market-text)]">
      <div className="market-frame flex w-full max-w-6xl flex-col gap-6">
        <header className="market-panel rounded-3xl p-6 md:p-8">
          <p className="font-[family-name:var(--font-display)] text-xs tracking-[0.35em] text-[#8cd9cd]">
            INDUSTRY RESEARCH
          </p>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-[#eef7f3] md:text-4xl">
            行业研究任务中心
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-[#9fb8b5]">
            输入你关心的赛道问题，系统会自动串联多 Agent
            研究流程，持续返回进度与结论。
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/"
              className="rounded-full border border-[#4f6e6a] bg-[#0b1b1b]/65 px-4 py-2 text-sm text-[#cde2dd] transition hover:border-[#81cec0] hover:text-[#ebfbf7]"
            >
              返回首页
            </Link>
            <Link
              href="/screening"
              className="rounded-full border border-[#4f6e6a] bg-[#0f2630]/65 px-4 py-2 text-sm text-[#bfe4f5] transition hover:border-[#81c5e0] hover:text-[#e9f8ff]"
            >
              去策略筛选台
            </Link>
          </div>
        </header>

        <section className="market-panel rounded-2xl p-5">
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[#edf6f3]">
            发起新研究
          </h2>
          <p className="mt-2 text-sm text-[#90a9a6]">
            建议使用“行业 +
            你想回答的问题”格式，例如：光伏逆变器出海，未来两年的利润弹性。
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setQuery(prompt)}
                className="rounded-full border border-[#5a7470]/70 bg-[#102423]/66 px-3 py-1.5 text-xs text-[#bcd8d3] transition hover:border-[#86cbbf] hover:text-[#e5f8f4]"
              >
                {prompt}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-[2fr_auto]">
            <textarea
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="请输入你想研究的行业问题"
              rows={4}
              className="rounded-xl border border-[#4d6a69] bg-[#091717] px-4 py-3 text-sm text-[#e8f6f4] placeholder:text-[#6e8a89] focus:border-[#62d8c3] focus:outline-none"
            />
            <button
              type="button"
              onClick={handleStart}
              disabled={startMutation.isPending}
              className="market-button-positive rounded-xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              {startMutation.isPending ? "任务创建中..." : "开始研究"}
            </button>
          </div>

          <details className="mt-3 rounded-xl border border-[#3f5655] bg-[#0a1819]/70 px-3 py-2">
            <summary className="cursor-pointer text-xs text-[#92aca9]">
              高级选项（幂等键）
            </summary>
            <input
              value={idempotencyKey}
              onChange={(event) => setIdempotencyKey(event.target.value)}
              placeholder="可选：用于避免重复提交"
              className="mt-2 w-full rounded-lg border border-[#4d6a69] bg-[#091717] px-3 py-2 text-sm text-[#e8f6f4] placeholder:text-[#6e8a89] focus:border-[#62d8c3] focus:outline-none"
            />
          </details>

          {startMutation.error ? (
            <p className="mt-3 rounded-lg border border-[#ff7f92]/45 bg-[#5b2432]/45 px-3 py-2 text-xs text-[#ffbdc8]">
              {startMutation.error.message}
            </p>
          ) : null}
        </section>

        <section className="market-panel rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[#edf6f3]">
              最近研究记录
            </h2>
            <button
              type="button"
              onClick={() => runsQuery.refetch()}
              className="rounded-full border border-[#4d6968] px-3 py-1 text-xs text-[#9cb8b4] transition hover:border-[#79d4c4] hover:text-[#e5f8f3]"
            >
              刷新
            </button>
          </div>

          {runsQuery.isLoading ? (
            <p className="mt-4 text-sm text-[#95b0ad]">正在加载...</p>
          ) : sortedRuns.length === 0 ? (
            <p className="mt-4 text-sm text-[#879f9d]">
              还没有研究记录，先发起一个问题试试。
            </p>
          ) : (
            <div className="mt-4 grid gap-3">
              {sortedRuns.map((run) => (
                <article
                  key={run.id}
                  className="market-soft-panel grid gap-3 rounded-xl p-4 md:grid-cols-[2fr_1fr_1fr_auto]"
                >
                  <div>
                    <p className="text-sm text-[#d8ece8]">{run.query}</p>
                    <p className="mt-1 text-xs text-[#7f9a99]">
                      创建时间: {formatDate(run.createdAt)}
                    </p>
                    <details className="mt-2 text-xs text-[#799291]">
                      <summary className="cursor-pointer">查看任务编号</summary>
                      <p className="market-data mt-1 break-all text-[11px] text-[#88a6a3]">
                        {run.id}
                      </p>
                    </details>
                  </div>
                  <div>
                    <p className="text-xs text-[#7f9a99]">状态</p>
                    <p
                      className={`text-sm font-semibold ${statusStyleMap[run.status] ?? "text-[#d8e8f8]"}`}
                    >
                      {statusLabelMap[run.status] ?? run.status}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[#7f9a99]">进度</p>
                    <p className="market-data text-sm text-[#66daff]">
                      {run.progressPercent}%
                    </p>
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#0b1b2f]">
                      <div
                        className="h-full rounded-full bg-[#5ed7c1] transition-all"
                        style={{ width: `${run.progressPercent}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex items-start justify-end gap-2">
                    <Link
                      href={`/workflows/${run.id}`}
                      className="rounded-full border border-[#69ccb9]/70 px-3 py-1 text-xs text-[#9be5d8] transition hover:bg-[#175a50]/35"
                    >
                      查看详情
                    </Link>
                    {(run.status === "PENDING" || run.status === "RUNNING") && (
                      <button
                        type="button"
                        onClick={() => cancelMutation.mutate({ runId: run.id })}
                        className="rounded-full border border-[#f6bf63]/70 px-3 py-1 text-xs text-[#ffd695] transition hover:bg-[#5f4620]/35"
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
            <p className="mt-4 rounded-lg border border-[#ff7f92]/45 bg-[#5b2432]/45 px-3 py-2 text-xs text-[#ffbdc8]">
              {runsQuery.error.message}
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

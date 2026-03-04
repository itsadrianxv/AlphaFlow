import Link from "next/link";

import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";

function formatExecutedAt(executedAt: Date | null): string {
  if (!executedAt) {
    return "暂无执行记录";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(executedAt);
}

export default async function Home() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  let strategyCount: number | null = null;
  let watchListCount: number | null = null;
  let recentSessionCount: number | null = null;
  let latestExecutedAt: Date | null = null;
  let loadError: string | null = null;

  if (signedIn) {
    try {
      const [strategies, watchLists, recentSessions] = await Promise.all([
        api.screening.listStrategies({ limit: 100, offset: 0 }),
        api.watchlist.list(),
        api.screening.listRecentSessions({ limit: 10, offset: 0 }),
      ]);

      strategyCount = strategies.length;
      watchListCount = watchLists.length;
      recentSessionCount = recentSessions.length;
      latestExecutedAt = recentSessions[0]?.executedAt ?? null;
    } catch {
      loadError = "概览数据加载失败，请检查登录状态与后端服务。";
    }
  }

  const metricCards = [
    {
      label: "筛选策略",
      value: strategyCount,
      unit: "个",
      hint: "可复用的选股规则模板",
    },
    {
      label: "自选股列表",
      value: watchListCount,
      unit: "组",
      hint: "支持标签与备注管理",
    },
    {
      label: "最近会话",
      value: recentSessionCount,
      unit: "次",
      hint: "近 10 次策略执行记录",
    },
  ];

  return (
    <HydrateClient>
      <main className="relative min-h-screen overflow-hidden bg-[#071019] text-slate-100">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(45,212,191,0.2),transparent_36%),radial-gradient(circle_at_82%_10%,rgba(251,146,60,0.2),transparent_32%),radial-gradient(circle_at_55%_88%,rgba(56,189,248,0.16),transparent_36%)]" />
        <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-10 sm:py-14">
          <header className="rounded-3xl border border-slate-700/60 bg-slate-900/60 p-6 backdrop-blur md:p-8">
            <p className="text-sm tracking-[0.3em] text-cyan-300">
              STOCK SCREENING BOOST
            </p>
            <h1 className="mt-4 text-3xl font-bold tracking-tight text-white sm:text-5xl">
              股票筛选平台
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300 sm:text-base">
              基于 Next.js + tRPC + Prisma + FastAPI 的混合架构投研平台，
              用策略筛选、会话回溯和自选股管理，把注意力聚焦在高价值标的上。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={signedIn ? "/api/auth/signout" : "/api/auth/signin"}
                className="rounded-full bg-cyan-400 px-5 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
              >
                {signedIn ? "退出登录" : "登录平台"}
              </Link>
              <Link
                href="http://localhost:8000/docs"
                target="_blank"
                className="rounded-full border border-slate-500 bg-slate-950/20 px-5 py-2 text-sm font-semibold text-slate-100 transition hover:border-cyan-400 hover:text-cyan-200"
              >
                打开数据服务文档
              </Link>
            </div>
          </header>

          <section className="grid gap-4 md:grid-cols-3">
            {metricCards.map((card) => (
              <article
                key={card.label}
                className="rounded-2xl border border-slate-700/50 bg-slate-900/55 p-5 backdrop-blur"
              >
                <p className="text-sm text-slate-300">{card.label}</p>
                <p className="mt-2 text-4xl font-semibold text-cyan-200">
                  {signedIn ? card.value ?? "-" : "--"}
                  <span className="ml-1 text-base text-slate-400">{card.unit}</span>
                </p>
                <p className="mt-2 text-xs text-slate-400">{card.hint}</p>
              </article>
            ))}
          </section>

          <section className="grid gap-4 md:grid-cols-[2fr,1fr]">
            <article className="rounded-2xl border border-slate-700/50 bg-slate-900/55 p-5 backdrop-blur">
              <h2 className="text-lg font-semibold text-white">运行状态</h2>
              <div className="mt-4 grid gap-3 text-sm text-slate-200 sm:grid-cols-2">
                <p className="rounded-xl border border-slate-700/60 bg-slate-950/30 px-4 py-3">
                  前端服务: <span className="text-emerald-300">http://localhost:3000</span>
                </p>
                <p className="rounded-xl border border-slate-700/60 bg-slate-950/30 px-4 py-3">
                  数据服务: <span className="text-emerald-300">http://localhost:8000</span>
                </p>
                <p className="rounded-xl border border-slate-700/60 bg-slate-950/30 px-4 py-3 sm:col-span-2">
                  数据库: <span className="text-emerald-300">localhost:5432</span>
                </p>
              </div>
            </article>

            <article className="rounded-2xl border border-slate-700/50 bg-slate-900/55 p-5 backdrop-blur">
              <h2 className="text-lg font-semibold text-white">当前账号</h2>
              <p className="mt-3 text-sm text-slate-300">
                {signedIn
                  ? `已登录: ${session?.user?.name ?? session?.user?.email ?? "未命名用户"}`
                  : "未登录，登录后可查看策略与会话数据。"}
              </p>
              <p className="mt-3 text-sm text-slate-300">
                最近执行:{" "}
                <span className="text-cyan-200">
                  {signedIn ? formatExecutedAt(latestExecutedAt) : "登录后可查看"}
                </span>
              </p>
              {loadError ? (
                <p className="mt-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  {loadError}
                </p>
              ) : null}
            </article>
          </section>
        </div>
      </main>
    </HydrateClient>
  );
}

import Link from "next/link";

import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";

function formatExecutedAt(executedAt: Date | null): string {
  if (!executedAt) {
    return "尚未执行";
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
      loadError = "数据暂时不可用，请稍后刷新或重新登录。";
    }
  }

  const metricCards = [
    {
      label: "策略库",
      value: strategyCount,
      unit: "套",
      hint: "可持续复用的筛选策略",
    },
    {
      label: "跟踪清单",
      value: watchListCount,
      unit: "组",
      hint: "长期观察与交易计划归档",
    },
    {
      label: "近期执行",
      value: recentSessionCount,
      unit: "次",
      hint: "最近 10 次策略回测/执行记录",
    },
  ];

  const readinessText = signedIn
    ? "已连接你的研究空间"
    : "登录后即可保存策略与研究记录";

  return (
    <HydrateClient>
      <main className="market-shell px-6 py-10 text-[var(--market-text)] sm:py-14">
        <div className="market-frame flex w-full max-w-6xl flex-col gap-8">
          <header className="market-panel rounded-3xl p-6 md:p-8">
            <p className="font-[family-name:var(--font-display)] text-xs tracking-[0.28em] text-[#8bdccd]">
              INVESTOR RESEARCH DESK
            </p>
            <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-tight text-[#eef7f2] sm:text-5xl">
              投资者友好的研究驾驶舱
            </h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-[#a5bcb8] sm:text-base">
              把选股策略、行业研究和自选管理串成一条连续流程。你只需要关注机会判断，
              系统负责记录、回溯和执行进度。
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/screening"
                className="market-button-positive rounded-full px-5 py-2 text-sm font-semibold transition"
              >
                开始策略筛选
              </Link>
              <Link
                href="/workflows"
                className="market-button-primary rounded-full px-5 py-2 text-sm font-semibold transition"
              >
                发起行业研究
              </Link>
              <Link
                href={signedIn ? "/api/auth/signout" : "/api/auth/signin"}
                className="rounded-full border border-[#79b4ae]/55 bg-[#113634]/75 px-5 py-2 text-sm font-semibold text-[#d7f2ee] transition hover:border-[#97d1cb] hover:bg-[#164644]"
              >
                {signedIn ? "退出登录" : "登录并开始"}
              </Link>
            </div>
          </header>

          <section className="grid gap-4 md:grid-cols-3">
            {metricCards.map((card) => (
              <article
                key={card.label}
                className="market-soft-panel rounded-2xl p-5"
              >
                <p className="text-sm text-[#a4bab7]">{card.label}</p>
                <p className="market-data mt-2 text-4xl font-semibold text-[#7fe6cf]">
                  {signedIn ? (card.value ?? "-") : "--"}
                  <span className="ml-1 text-base text-[#83a09a]">
                    {card.unit}
                  </span>
                </p>
                <p className="mt-2 text-xs text-[#8fa4a1]">{card.hint}</p>
              </article>
            ))}
          </section>

          <section className="grid gap-4 md:grid-cols-[1.3fr,1fr]">
            <article className="market-panel rounded-2xl p-5">
              <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[#eef8f3]">
                今日准备度
              </h2>
              <p className="mt-3 text-sm text-[#a5bbb8]">{readinessText}</p>
              <p className="mt-3 text-sm text-[#a5bbb8]">
                最近一次执行:
                <span className="market-data ml-2 text-[#74dfc7]">
                  {signedIn ? formatExecutedAt(latestExecutedAt) : "登录后可见"}
                </span>
              </p>
              {loadError ? (
                <p className="mt-3 rounded-lg border border-[#f4c26f]/45 bg-[#5d4621]/38 px-3 py-2 text-xs text-[#ffd89b]">
                  {loadError}
                </p>
              ) : null}
            </article>

            <article className="market-panel rounded-2xl p-5">
              <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-[#eef8f3]">
                推荐下一步
              </h2>
              <ul className="mt-3 space-y-2 text-sm text-[#a7bfbb]">
                <li>1. 先进入筛选研究台，确认当前策略是否覆盖你的投资风格。</li>
                <li>2. 对命中标的建立自选清单，补齐备注与观察标签。</li>
                <li>3. 在工作流中心发起行业研究，形成结构化结论。</li>
              </ul>
            </article>
          </section>
        </div>
      </main>
    </HydrateClient>
  );
}

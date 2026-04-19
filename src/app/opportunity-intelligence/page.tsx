/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React from "react";
import Link from "next/link";

export default function OpportunityIntelligencePage() {
  return (
    <main className="app-shell min-h-screen bg-[var(--app-bg)]">
      <div className="mx-auto flex min-h-screen w-full max-w-[1180px] flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        <header className="rounded-[24px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-6 py-8 shadow-[var(--app-shadow-sm)] sm:px-8">
          <div className="text-[11px] uppercase tracking-[0.18em] text-[var(--app-text-subtle)]">
            Legacy Route
          </div>
          <h1 className="app-display mt-4 max-w-4xl text-[44px] leading-[0.94] text-[var(--app-text-strong)] sm:text-[56px]">
            机会研判入口已迁移
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--app-text-muted)] sm:text-base">
            原来的机会研判页已经不再单独承载流程。为了避免旧书签、旧导航缓存或已打开标签页继续访问
            <span className="mx-1 font-medium text-[var(--app-text-strong)]">
              /opportunity-intelligence
            </span>
            时触发客户端异常，这里保留一个稳定入口，直接把后续动作送回当前仍在维护的研究闭环。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/workflows" className="app-button app-button-primary">
              前往行业研究
            </Link>
            <Link href="/screening" className="app-button">
              前往股票筛选
            </Link>
            <Link href="/timing" className="app-button">
              前往择时组合
            </Link>
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-[20px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-subtle)]">
              Step 1
            </div>
            <h2 className="mt-3 text-2xl text-[var(--app-text-strong)]">
              先回到筛选
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
              如果你是从旧线索入口跳过来的，先在股票筛选里更新候选池，保证后续研究使用的是当前有效标的。
            </p>
            <Link href="/screening" className="app-button mt-5">
              打开筛选工作台
            </Link>
          </article>

          <article className="rounded-[20px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-subtle)]">
              Step 2
            </div>
            <h2 className="mt-3 text-2xl text-[var(--app-text-strong)]">
              再推进研究
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
              行业研究现在承担原机会研判的大部分承接职责，适合作为旧链接的默认落点。
            </p>
            <Link href="/workflows" className="app-button mt-5">
              打开行业研究
            </Link>
          </article>

          <article className="rounded-[20px] border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-5">
            <div className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-subtle)]">
              Step 3
            </div>
            <h2 className="mt-3 text-2xl text-[var(--app-text-strong)]">
              最后收敛到执行
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
              研究结论已经统一在择时组合和复盘入口收敛，旧入口不再直接维护独立动作面板。
            </p>
            <Link href="/timing" className="app-button mt-5">
              打开择时组合
            </Link>
          </article>
        </section>
      </div>
    </main>
  );
}

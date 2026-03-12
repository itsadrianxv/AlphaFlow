import Link from "next/link";

import {
  ActionBanner,
  EmptyState,
  KpiCard,
  Panel,
  StatusPill,
  statusTone,
  WorkspaceShell,
} from "~/app/_components/ui";
import { getTemplateLabel } from "~/app/workflows/research-view-models";
import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";

function formatDate(value?: Date | null): string {
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

function formatPct(value?: number | null): string {
  if (value === null || value === undefined) {
    return "-";
  }

  return `${value.toFixed(2)}%`;
}

const actionLabelMap: Record<string, string> = {
  WATCH: "观察",
  PROBE: "试仓",
  ADD: "加仓",
  HOLD: "持有",
  TRIM: "减仓",
  EXIT: "退出",
};

const marketRegimeLabelMap: Record<string, string> = {
  RISK_ON: "风险偏好修复",
  NEUTRAL: "中性环境",
  RISK_OFF: "防守环境",
};

export default async function Home() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  let loadError: string | null = null;

  let strategyCount = 0;
  let watchListCount = 0;
  let workflowRuns:
    | Awaited<ReturnType<typeof api.workflow.listRuns>>["items"]
    | null = null;
  let screeningSessions: Awaited<
    ReturnType<typeof api.screening.listRecentSessions>
  > | null = null;
  let recommendations: Awaited<
    ReturnType<typeof api.timing.listRecommendations>
  > | null = null;
  let portfolioSnapshots: Awaited<
    ReturnType<typeof api.timing.listPortfolioSnapshots>
  > | null = null;

  if (signedIn) {
    try {
      const [
        strategies,
        watchLists,
        workflowRunResult,
        sessions,
        latestRecommendations,
        portfolios,
      ] = await Promise.all([
        api.screening.listStrategies({ limit: 100, offset: 0 }),
        api.watchlist.list({
          limit: 50,
          offset: 0,
          sortBy: "updatedAt",
          sortDirection: "desc",
        }),
        api.workflow.listRuns({ limit: 12 }),
        api.screening.listRecentSessions({ limit: 8, offset: 0 }),
        api.timing.listRecommendations({ limit: 12 }),
        api.timing.listPortfolioSnapshots(),
      ]);

      strategyCount = strategies.length;
      watchListCount = watchLists.length;
      workflowRuns = workflowRunResult.items;
      screeningSessions = sessions;
      recommendations = latestRecommendations;
      portfolioSnapshots = portfolios;
    } catch {
      loadError = "部分看板数据暂时不可用，请稍后刷新。";
    }
  }

  const liveRuns = (workflowRuns ?? []).filter(
    (run) => run.status === "PENDING" || run.status === "RUNNING",
  );
  const liveScreeningSessions = (screeningSessions ?? []).filter(
    (session) => session.status === "PENDING" || session.status === "RUNNING",
  );

  const latestRecommendationRunId = recommendations?.[0]?.workflowRunId;
  const latestRecommendations = latestRecommendationRunId
    ? (recommendations ?? []).filter(
        (item) => item.workflowRunId === latestRecommendationRunId,
      )
    : (recommendations ?? []).slice(0, 4);
  const portfolioSnapshot = portfolioSnapshots?.[0] ?? null;

  const priorityRecommendation = latestRecommendations[0] ?? null;
  const priorityResearch = liveRuns[0] ?? workflowRuns?.[0] ?? null;
  const priorityScreening =
    liveScreeningSessions[0] ?? screeningSessions?.[0] ?? null;

  const priorityTitle = !signedIn
    ? "登录研究空间"
    : priorityRecommendation
      ? `${priorityRecommendation.stockName}：${actionLabelMap[priorityRecommendation.action] ?? priorityRecommendation.action}`
      : priorityResearch
        ? `继续处理：${priorityResearch.query}`
        : priorityScreening
          ? `查看最新机会池：${priorityScreening.strategyName}`
          : "暂无优先事项";

  const priorityDescription = !signedIn
    ? "登录后同步研究数据。"
    : priorityRecommendation
      ? `${priorityRecommendation.reasoning.actionRationale} 当前风险预算上限 ${formatPct(priorityRecommendation.riskBudgetPct)}，建议区间 ${formatPct(priorityRecommendation.suggestedMinPct)} ~ ${formatPct(priorityRecommendation.suggestedMaxPct)}。`
      : priorityResearch
        ? `${getTemplateLabel(priorityResearch.templateCode)} · ${priorityResearch.progressPercent}%`
        : priorityScreening
          ? `${priorityScreening.strategyName} · ${priorityScreening.currentStep ?? "等待结果"}`
          : "暂无进行中的流程。";

  return (
    <HydrateClient>
      <WorkspaceShell
        section="home"
        eyebrow="Today Dashboard"
        title="今日投资看板"
        description="聚合重点建议、风险约束和在跑流程。"
        actions={
          <>
            <Link href="/screening" className="app-button app-button-success">
              查看机会池
            </Link>
            <Link href="/workflows" className="app-button app-button-primary">
              形成行业判断
            </Link>
            <Link href="/timing" className="app-button app-button-primary">
              打开择时组合
            </Link>
            <Link
              href={signedIn ? "/api/auth/signout" : "/api/auth/signin"}
              className="app-button"
            >
              {signedIn ? "退出登录" : "登录研究空间"}
            </Link>
          </>
        }
        summary={
          <>
            <KpiCard
              label="今日重点建议"
              value={
                priorityRecommendation ? latestRecommendations.length : "--"
              }
              hint={
                priorityRecommendation
                  ? `${actionLabelMap[priorityRecommendation.action] ?? priorityRecommendation.action} 已生成`
                  : "暂无新建议"
              }
              tone="success"
            />
            <KpiCard
              label="进行中的研究"
              value={liveRuns.length + liveScreeningSessions.length}
              hint="研究与筛选"
              tone="warning"
            />
            <KpiCard
              label="机会池清单"
              value={signedIn ? watchListCount : "--"}
              hint={`策略 ${signedIn ? strategyCount : "--"} 条`}
              tone="info"
            />
            <KpiCard
              label="组合风险预算"
              value={
                latestRecommendations[0]?.riskBudgetPct !== undefined
                  ? formatPct(latestRecommendations[0]?.riskBudgetPct)
                  : portfolioSnapshot
                    ? formatPct(
                        portfolioSnapshot.riskPreferences
                          .maxPortfolioRiskBudgetPct,
                      )
                    : "--"
              }
              hint="当前上限"
              tone="neutral"
            />
          </>
        }
      >
        <ActionBanner
          title={priorityTitle}
          description={priorityDescription}
          tone={
            !signedIn
              ? "warning"
              : priorityRecommendation
                ? "success"
                : priorityResearch || priorityScreening
                  ? "info"
                  : "warning"
          }
          actions={
            !signedIn ? (
              <Link
                href="/api/auth/signin"
                className="app-button app-button-primary"
              >
                立即登录
              </Link>
            ) : priorityRecommendation?.workflowRunId ? (
              <Link
                href={`/workflows/${priorityRecommendation.workflowRunId}`}
                className="app-button app-button-primary"
              >
                查看完整结论
              </Link>
            ) : priorityResearch ? (
              <Link
                href={`/workflows/${priorityResearch.id}`}
                className="app-button app-button-primary"
              >
                继续处理
              </Link>
            ) : priorityScreening ? (
              <Link href="/screening" className="app-button app-button-success">
                回到机会池
              </Link>
            ) : undefined
          }
        />

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Panel title="今日优先处理">
            {!signedIn ? (
              <EmptyState
                title="登录后查看投资看板"
                actions={
                  <Link
                    href="/api/auth/signin"
                    className="app-button app-button-primary"
                  >
                    登录研究空间
                  </Link>
                }
              />
            ) : (
              <div className="grid gap-3">
                <article className="rounded-[16px] border border-[var(--app-border)] bg-[rgba(12,16,22,0.86)] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      label={priorityRecommendation ? "组合建议" : "优先事项"}
                      tone={priorityRecommendation ? "success" : "info"}
                    />
                    {priorityRecommendation ? (
                      <StatusPill
                        label={
                          actionLabelMap[priorityRecommendation.action] ??
                          priorityRecommendation.action
                        }
                        tone="success"
                      />
                    ) : null}
                  </div>
                  <p className="mt-3 text-lg font-medium text-[var(--app-text)]">
                    {priorityTitle}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                    {priorityDescription}
                  </p>
                </article>

                <div className="grid gap-3 md:grid-cols-2">
                  <article className="rounded-[16px] border border-[var(--app-border)] bg-[rgba(12,16,22,0.86)] p-4">
                    <p className="market-kicker">研究</p>
                    {priorityResearch ? (
                      <>
                        <p className="mt-3 text-base font-medium text-[var(--app-text)]">
                          {priorityResearch.query}
                        </p>
                        <p className="mt-2 text-sm text-[var(--app-text-muted)]">
                          {getTemplateLabel(priorityResearch.templateCode)} ·{" "}
                          {priorityResearch.progressPercent}% ·{" "}
                          {formatDate(priorityResearch.createdAt)}
                        </p>
                      </>
                    ) : (
                      <p className="mt-3 text-sm text-[var(--app-text-muted)]">
                        暂无进行中的研究。
                      </p>
                    )}
                  </article>

                  <article className="rounded-[16px] border border-[var(--app-border)] bg-[rgba(12,16,22,0.86)] p-4">
                    <p className="market-kicker">机会池</p>
                    {priorityScreening ? (
                      <>
                        <p className="mt-3 text-base font-medium text-[var(--app-text)]">
                          {priorityScreening.strategyName}
                        </p>
                        <p className="mt-2 text-sm text-[var(--app-text-muted)]">
                          {priorityScreening.currentStep ?? "等待查看筛选结果"}{" "}
                          · {priorityScreening.progressPercent}%
                        </p>
                      </>
                    ) : (
                      <p className="mt-3 text-sm text-[var(--app-text-muted)]">
                        暂无新的筛选刷新。
                      </p>
                    )}
                  </article>
                </div>
              </div>
            )}
          </Panel>

          <Panel title="风险预算 / 组合语境">
            {!signedIn ? (
              <EmptyState title="登录后查看组合语境" />
            ) : portfolioSnapshot ? (
              <div className="grid gap-3">
                <article className="rounded-[16px] border border-[var(--app-border)] bg-[rgba(12,16,22,0.86)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-base font-medium text-[var(--app-text)]">
                        {portfolioSnapshot.name}
                      </p>
                      <p className="mt-1 text-sm text-[var(--app-text-muted)]">
                        更新于 {formatDate(portfolioSnapshot.updatedAt)}
                      </p>
                    </div>
                    <StatusPill
                      label={`预算上限 ${formatPct(
                        portfolioSnapshot.riskPreferences
                          .maxPortfolioRiskBudgetPct,
                      )}`}
                      tone="warning"
                    />
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[12px] border border-[var(--app-border)] bg-[rgba(16,21,29,0.84)] px-4 py-3">
                      <div className="text-xs text-[var(--app-text-soft)]">
                        总资金
                      </div>
                      <div className="app-data mt-2 text-lg text-[var(--app-text)]">
                        {portfolioSnapshot.totalCapital.toFixed(2)}{" "}
                        {portfolioSnapshot.baseCurrency}
                      </div>
                    </div>
                    <div className="rounded-[12px] border border-[var(--app-border)] bg-[rgba(16,21,29,0.84)] px-4 py-3">
                      <div className="text-xs text-[var(--app-text-soft)]">
                        可用现金
                      </div>
                      <div className="app-data mt-2 text-lg text-[var(--app-text)]">
                        {portfolioSnapshot.cash.toFixed(2)}{" "}
                        {portfolioSnapshot.baseCurrency}
                      </div>
                    </div>
                  </div>
                </article>

                {priorityRecommendation ? (
                  <article className="rounded-[16px] border border-[var(--app-border)] bg-[rgba(12,16,22,0.86)] p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill
                        label={
                          marketRegimeLabelMap[
                            priorityRecommendation.marketRegime
                          ] ?? priorityRecommendation.marketRegime
                        }
                        tone="info"
                      />
                      <StatusPill
                        label={`单票上限 ${formatPct(
                          priorityRecommendation.reasoning.riskPlan
                            .maxSingleNamePct,
                        )}`}
                        tone="neutral"
                      />
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                      {priorityRecommendation.reasoning.marketRegimeSummary}
                    </p>
                  </article>
                ) : null}
              </div>
            ) : (
              <EmptyState
                title="还没有组合快照"
                actions={
                  <Link
                    href="/timing"
                    className="app-button app-button-primary"
                  >
                    去维护组合快照
                  </Link>
                }
              />
            )}
          </Panel>
        </div>

        <Panel
          title="最新择时建议"
          actions={
            <Link href="/timing" className="app-button app-button-primary">
              打开择时组合
            </Link>
          }
        >
          {!signedIn ? (
            <EmptyState title="登录后查看组合建议" />
          ) : latestRecommendations.length === 0 ? (
            <EmptyState title="还没有新的择时建议" />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {latestRecommendations.slice(0, 4).map((recommendation) => (
                <article
                  key={recommendation.id}
                  className="rounded-[16px] border border-[var(--app-border)] bg-[rgba(12,16,22,0.86)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      label={
                        actionLabelMap[recommendation.action] ??
                        recommendation.action
                      }
                      tone="success"
                    />
                    <StatusPill
                      label={`优先级 ${recommendation.priority}`}
                      tone="warning"
                    />
                  </div>
                  <p className="mt-3 text-lg font-medium text-[var(--app-text)]">
                    {recommendation.stockName}
                  </p>
                  <p className="mt-1 text-sm text-[var(--app-text-soft)]">
                    {recommendation.stockCode}
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                    {recommendation.reasoning.actionRationale}
                  </p>
                  <div className="mt-4 grid gap-2 text-xs text-[var(--app-text-soft)]">
                    <div>
                      建议区间 {formatPct(recommendation.suggestedMinPct)} ~{" "}
                      {formatPct(recommendation.suggestedMaxPct)}
                    </div>
                    <div>
                      风险预算 {formatPct(recommendation.riskBudgetPct)}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="进行中的研究">
          {!signedIn ? (
            <EmptyState title="登录后查看研究动态" />
          ) : liveRuns.length === 0 && liveScreeningSessions.length === 0 ? (
            <EmptyState title="当前没有进行中的研究" />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {liveRuns.map((run) => (
                <article
                  key={run.id}
                  className="rounded-[16px] border border-[var(--app-border)] bg-[rgba(12,16,22,0.86)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill
                      label={getTemplateLabel(run.templateCode)}
                      tone="info"
                    />
                    <StatusPill
                      label={`${run.progressPercent}%`}
                      tone={statusTone(run.status)}
                    />
                  </div>
                  <p className="mt-3 text-base font-medium text-[var(--app-text)]">
                    {run.query}
                  </p>
                  <p className="mt-2 text-sm text-[var(--app-text-muted)]">
                    {run.currentNodeKey ?? "等待结果更新"}
                  </p>
                  <div className="mt-4 flex items-center justify-between gap-3 text-xs text-[var(--app-text-soft)]">
                    <span>{formatDate(run.createdAt)}</span>
                    <Link
                      href={`/workflows/${run.id}`}
                      className="text-[var(--app-accent-strong)]"
                    >
                      查看详情
                    </Link>
                  </div>
                </article>
              ))}

              {liveScreeningSessions.map((session) => (
                <article
                  key={session.id}
                  className="rounded-[16px] border border-[var(--app-border)] bg-[rgba(12,16,22,0.86)] p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill label="机会池" tone="success" />
                    <StatusPill
                      label={`${session.progressPercent}%`}
                      tone={statusTone(session.status)}
                    />
                  </div>
                  <p className="mt-3 text-base font-medium text-[var(--app-text)]">
                    {session.strategyName}
                  </p>
                  <p className="mt-2 text-sm text-[var(--app-text-muted)]">
                    {session.currentStep ?? "等待结果更新"}
                  </p>
                  <div className="mt-4 flex items-center justify-between gap-3 text-xs text-[var(--app-text-soft)]">
                    <span>{formatDate(session.executedAt)}</span>
                    <Link
                      href="/screening"
                      className="text-[var(--app-accent-strong)]"
                    >
                      查看机会池
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}

          {loadError ? (
            <div className="mt-4 rounded-[12px] border border-[rgba(191,154,96,0.34)] bg-[rgba(77,58,27,0.2)] px-4 py-3 text-sm text-[var(--app-warning)]">
              {loadError}
            </div>
          ) : null}
        </Panel>
      </WorkspaceShell>
    </HydrateClient>
  );
}

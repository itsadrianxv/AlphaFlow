import Link from "next/link";

import {
  ActionStrip,
  BentoCard,
  BentoGrid,
  EmptyState,
  InlineNotice,
  MetricTile,
  MiniTrendChart,
  ProgressBar,
  SectionCard,
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
      const [workflowRunResult, sessions, latestRecommendations, portfolios] =
        await Promise.all([
          api.workflow.listRuns({ limit: 12 }),
          api.screening.listRecentSessions({ limit: 8, offset: 0 }),
          api.timing.listRecommendations({ limit: 12 }),
          api.timing.listPortfolioSnapshots(),
        ]);

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
    (item) => item.status === "PENDING" || item.status === "RUNNING",
  );
  const latestRecommendationRunId = recommendations?.[0]?.workflowRunId;
  const latestRecommendations = latestRecommendationRunId
    ? (recommendations ?? []).filter(
        (item) => item.workflowRunId === latestRecommendationRunId,
      )
    : (recommendations ?? []).slice(0, 6);
  const portfolioSnapshot = portfolioSnapshots?.[0] ?? null;

  const priorityRecommendation = latestRecommendations[0] ?? null;
  const priorityResearch = liveRuns[0] ?? workflowRuns?.[0] ?? null;
  const priorityScreening =
    liveScreeningSessions[0] ?? screeningSessions?.[0] ?? null;

  const priorityTitle = !signedIn
    ? "登录后查看今日决策与运行状态"
    : priorityRecommendation
      ? `${priorityRecommendation.stockName} · ${
          actionLabelMap[priorityRecommendation.action] ??
          priorityRecommendation.action
        }`
      : priorityResearch
        ? `继续处理 ${priorityResearch.query}`
        : priorityScreening
          ? `查看最新机会池 ${priorityScreening.strategyName}`
          : "当前没有待处理的高优先级事项";

  const priorityDescription = !signedIn
    ? "登录后可以同步研究流程、筛选结果和组合建议，在同一工作台里完成今天的判断。"
    : priorityRecommendation
      ? `${priorityRecommendation.reasoning.actionRationale} 当前风险预算上限 ${formatPct(priorityRecommendation.riskBudgetPct)}，建议区间 ${formatPct(priorityRecommendation.suggestedMinPct)} 至 ${formatPct(priorityRecommendation.suggestedMaxPct)}。`
      : priorityResearch
        ? `${getTemplateLabel(priorityResearch.templateCode)} · ${priorityResearch.progressPercent}%`
        : priorityScreening
          ? `${priorityScreening.strategyName} · ${priorityScreening.currentStep ?? "等待结果"}`
          : "工作台已空闲，可以发起新的研究或筛选。";

  const chartValues = [
    ...liveRuns.slice(0, 4).map((item) => item.progressPercent),
    ...liveScreeningSessions.slice(0, 4).map((item) => item.progressPercent),
  ];
  const opportunityScale = Math.max(
    ...latestRecommendations.map((item) => item.suggestedMaxPct ?? 0),
    1,
  );

  return (
    <HydrateClient>
      <WorkspaceShell
        section="home"
        title="投资决策工作台"
        description="围绕今日优先事项、风险约束和运行中的研究，快速完成从筛选到组合建议的判断。"
        actions={
          <>
            <Link href="/screening" className="app-button app-button-primary">
              打开股票筛选
            </Link>
            <Link href="/workflows" className="app-button">
              发起行业研究
            </Link>
            <Link href="/timing" className="app-button">
              查看组合建议
            </Link>
            <Link
              href={signedIn ? "/api/auth/signout" : "/login"}
              className="app-button"
            >
              {signedIn ? "退出登录" : "登录"}
            </Link>
          </>
        }
        summary={
          <>
            <MetricTile
              label="进行中的研究"
              value={signedIn ? liveRuns.length : "-"}
              hint={signedIn ? "行业与公司研究运行数" : "登录后同步"}
              tone="info"
            />
            <MetricTile
              label="进行中的筛选"
              value={signedIn ? liveScreeningSessions.length : "-"}
              hint={signedIn ? "机会池执行会话" : "登录后同步"}
              tone="warning"
            />
            <MetricTile
              label="最新组合建议"
              value={signedIn ? latestRecommendations.length : "-"}
              hint={signedIn ? "来自最近一次择时流程" : "登录后同步"}
              tone="success"
            />
            <MetricTile
              label="组合风险上限"
              value={
                signedIn && portfolioSnapshot
                  ? formatPct(
                      portfolioSnapshot.riskPreferences
                        .maxPortfolioRiskBudgetPct,
                    )
                  : "-"
              }
              hint={signedIn ? "当前组合风险预算" : "登录后同步"}
              tone="neutral"
            />
          </>
        }
      >
        <ActionStrip
          title={priorityTitle}
          description={priorityDescription}
          tone={
            !signedIn
              ? "warning"
              : priorityRecommendation
                ? "success"
                : priorityResearch || priorityScreening
                  ? "info"
                  : "neutral"
          }
          actions={
            !signedIn ? (
              <Link href="/login" className="app-button app-button-primary">
                进入工作台
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
              <Link href="/screening" className="app-button app-button-primary">
                返回机会池
              </Link>
            ) : (
              <Link href="/workflows" className="app-button app-button-primary">
                发起研究
              </Link>
            )
          }
        />

        {loadError ? (
          <InlineNotice tone="warning" description={loadError} />
        ) : null}

        <BentoGrid cols={4} className="grid-flow-dense gap-6">
            <BentoCard
              span={3}
              title="机会排序"
              description="聚焦当前建议区间和动作理由，快速筛出今天最值得继续跟进的标的。"
            >
              {!signedIn ? (
                <EmptyState
                  title="登录后查看最新机会排序"
                  description="登录后会合并机会池、组合建议和研究结论。"
                  actions={
                    <Link
                      href="/login"
                      className="app-button app-button-primary"
                    >
                      登录
                    </Link>
                  }
                />
              ) : latestRecommendations.length === 0 ? (
                <EmptyState
                  title="还没有新的组合建议"
                  description="可以先去筛选页执行策略，或在行业研究里补充结论。"
                  actions={
                    <Link
                      href="/screening"
                      className="app-button app-button-primary"
                    >
                      打开筛选
                    </Link>
                  }
                />
              ) : (
                <div className="grid gap-4">
                  {latestRecommendations.slice(0, 5).map((item) => {
                    const width = Math.max(
                      14,
                      ((item.suggestedMaxPct ?? 0) / opportunityScale) * 100,
                    );

                    return (
                      <article
                        key={item.id}
                        className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-medium text-[var(--app-text-strong)]">
                                {item.stockName}
                              </div>
                              <div className="text-xs text-[var(--app-text-subtle)]">
                                {item.stockCode}
                              </div>
                              <StatusPill
                                label={
                                  actionLabelMap[item.action] ?? item.action
                                }
                                tone="success"
                              />
                              <StatusPill
                                label={`优先级 ${item.priority}`}
                                tone="warning"
                              />
                            </div>
                            <div className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                              {item.reasoning.actionRationale}
                            </div>
                          </div>
                          <div className="w-full max-w-[220px]">
                            <div className="flex items-center justify-between gap-3 text-xs text-[var(--app-text-subtle)]">
                              <span>建议上限</span>
                              <span className="app-data text-[var(--app-text-strong)]">
                                {formatPct(item.suggestedMaxPct)}
                              </span>
                            </div>
                            <div className="mt-2 h-2 rounded-full bg-[rgba(255,255,255,0.06)]">
                              <div
                                className="h-2 rounded-full bg-[var(--app-brand)]"
                                style={{ width: `${width}%` }}
                              />
                            </div>
                            <div className="mt-2 text-xs text-[var(--app-text-subtle)]">
                              风险预算 {formatPct(item.riskBudgetPct)} ·
                              建议区间 {formatPct(item.suggestedMinPct)} 至{" "}
                              {formatPct(item.suggestedMaxPct)}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </BentoCard>

            <BentoCard
              span={3}
              title="研究执行队列"
              description="统一查看运行中的行业研究和机会池会话，避免在多个页面之间切换。"
            >
              {!signedIn ? (
                <EmptyState title="登录后查看运行队列" />
              ) : liveRuns.length === 0 &&
                liveScreeningSessions.length === 0 ? (
                <EmptyState
                  title="当前没有进行中的流程"
                  description="可以发起新的行业研究，或执行一次股票筛选。"
                />
              ) : (
                <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
                  <div className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4">
                    <div className="text-sm font-medium text-[var(--app-text-strong)]">
                      最近运行进度
                    </div>
                    <MiniTrendChart
                      values={chartValues}
                      className="mt-5"
                      tone="info"
                    />
                    <div className="mt-3 text-xs leading-6 text-[var(--app-text-muted)]">
                      趋势线基于当前运行中的行业研究与筛选会话进度，帮助快速判断队列是否接近完成。
                    </div>
                  </div>

                  <div className="grid gap-3">
                    {liveRuns.map((run) => (
                      <article
                        key={run.id}
                        className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
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
                            <div className="mt-3 text-sm font-medium text-[var(--app-text-strong)]">
                              {run.query}
                            </div>
                            <div className="mt-1 text-sm text-[var(--app-text-muted)]">
                              {run.currentNodeKey ?? "等待结果更新"}
                            </div>
                          </div>
                          <div className="text-xs text-[var(--app-text-subtle)]">
                            {formatDate(run.createdAt)}
                          </div>
                        </div>
                        <ProgressBar
                          value={run.progressPercent}
                          tone={statusTone(run.status)}
                          className="mt-4"
                        />
                      </article>
                    ))}

                    {liveScreeningSessions.map((item) => (
                      <article
                        key={item.id}
                        className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusPill label="机会池" tone="success" />
                              <StatusPill
                                label={`${item.progressPercent}%`}
                                tone={statusTone(item.status)}
                              />
                            </div>
                            <div className="mt-3 text-sm font-medium text-[var(--app-text-strong)]">
                              {item.strategyName}
                            </div>
                            <div className="mt-1 text-sm text-[var(--app-text-muted)]">
                              {item.currentStep ?? "等待结果更新"}
                            </div>
                          </div>
                          <div className="text-xs text-[var(--app-text-subtle)]">
                            {formatDate(item.executedAt)}
                          </div>
                        </div>
                        <ProgressBar
                          value={item.progressPercent}
                          tone={statusTone(item.status)}
                          className="mt-4"
                        />
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </BentoCard>

            <BentoCard
              span={1}
              title="风险框架"
              description="把当前组合约束和最新市场语境收进同一块，方便判断是否值得立刻行动。"
            >
              {!signedIn ? (
                <EmptyState title="登录后查看风险框架" />
              ) : portfolioSnapshot ? (
                <div className="grid gap-3">
                  <div className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-[var(--app-text-strong)]">
                          {portfolioSnapshot.name}
                        </div>
                        <div className="mt-1 text-xs text-[var(--app-text-subtle)]">
                          更新于 {formatDate(portfolioSnapshot.updatedAt)}
                        </div>
                      </div>
                      <StatusPill
                        label={`风险上限 ${formatPct(
                          portfolioSnapshot.riskPreferences
                            .maxPortfolioRiskBudgetPct,
                        )}`}
                        tone="warning"
                      />
                    </div>

                    <div className="mt-4 grid gap-3">
                      <div className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-floating)] px-4 py-3">
                        <div className="text-xs text-[var(--app-text-subtle)]">
                          总资产
                        </div>
                        <div className="app-data mt-2 text-lg text-[var(--app-text-strong)]">
                          {portfolioSnapshot.totalCapital.toFixed(2)}{" "}
                          {portfolioSnapshot.baseCurrency}
                        </div>
                      </div>
                      <div className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-floating)] px-4 py-3">
                        <div className="text-xs text-[var(--app-text-subtle)]">
                          可用现金
                        </div>
                        <div className="app-data mt-2 text-lg text-[var(--app-text-strong)]">
                          {portfolioSnapshot.cash.toFixed(2)}{" "}
                          {portfolioSnapshot.baseCurrency}
                        </div>
                      </div>
                    </div>
                  </div>

                  {priorityRecommendation ? (
                    <div className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusPill
                          label={
                            marketRegimeLabelMap[
                              priorityRecommendation.marketState
                            ] ?? priorityRecommendation.marketState
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
                      <div className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                        {priorityRecommendation.reasoning.marketContext.summary}
                      </div>
                    </div>
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
                      去维护组合
                    </Link>
                  }
                />
              )}
            </BentoCard>

            <BentoCard
              span={1}
              title="今日优先处理"
              description="把下一步动作压缩到最少，降低切换成本。"
            >
              {!signedIn ? (
                <EmptyState title="登录后查看优先事项" />
              ) : (
                <div className="grid gap-3">
                  <div className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4">
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
                    <div className="mt-3 text-base font-medium text-[var(--app-text-strong)]">
                      {priorityTitle}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                      {priorityDescription}
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4">
                      <div className="text-xs text-[var(--app-text-subtle)]">
                        行业研究
                      </div>
                      <div className="mt-2 text-sm font-medium text-[var(--app-text-strong)]">
                        {priorityResearch?.query ?? "当前没有进行中的行业研究"}
                      </div>
                      <div className="mt-1 text-xs text-[var(--app-text-muted)]">
                        {priorityResearch
                          ? `${getTemplateLabel(priorityResearch.templateCode)} · ${priorityResearch.progressPercent}%`
                          : "空闲"}
                      </div>
                    </div>

                    <div className="rounded-[10px] border border-[var(--app-border-soft)] bg-[var(--app-bg-inset)] p-4">
                      <div className="text-xs text-[var(--app-text-subtle)]">
                        机会池
                      </div>
                      <div className="mt-2 text-sm font-medium text-[var(--app-text-strong)]">
                        {priorityScreening?.strategyName ??
                          "当前没有进行中的筛选会话"}
                      </div>
                      <div className="mt-1 text-xs text-[var(--app-text-muted)]">
                        {priorityScreening
                          ? `${priorityScreening.currentStep ?? "等待结果"} · ${priorityScreening.progressPercent}%`
                          : "空闲"}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </BentoCard>
        </BentoGrid>
      </WorkspaceShell>
    </HydrateClient>
  );
}

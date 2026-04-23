import Link from "next/link";
import { getTemplateLabel } from "~/modules/research/ui/industry/research-view-models";
import { buildRunDetailHref } from "~/modules/research/ui/industry/run-detail-href";
import { api, HydrateClient } from "~/platform/trpc/rsc";
import { auth } from "~/server/auth";
import { primaryWorkflowStages } from "~/shared/ui/navigation/workflow-stage-config";
import { statusTone } from "~/shared/ui/primitives/status-tone";
import {
  ActionStrip,
  EmptyState,
  ProgressBar,
  SectionCard,
  StatusPill,
  WorkspaceShell,
} from "~/shared/ui/primitives/ui";

type WorkflowRunListItem = Awaited<
  ReturnType<typeof api.research.runs.listRuns>
>["items"][number];
type RecommendationListItem = Awaited<
  ReturnType<typeof api.timing.listRecommendations>
>[number];

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

export default async function Home() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  let loadError: string | null = null;
  let workflowRuns:
    | Awaited<ReturnType<typeof api.research.runs.listRuns>>["items"]
    | null = null;
  let screeningWorkspaces: Awaited<
    ReturnType<typeof api.screening.listWorkspaces>
  > | null = null;
  let recommendations: Awaited<
    ReturnType<typeof api.timing.listRecommendations>
  > | null = null;

  if (signedIn) {
    try {
      const [workflowRunResult, workspaces, latestRecommendations] =
        await Promise.all([
          api.research.runs.listRuns({ limit: 12 }),
          api.screening.listWorkspaces({ limit: 8, offset: 0 }),
          api.timing.listRecommendations({ limit: 12 }),
        ]);

      workflowRuns = workflowRunResult.items;
      screeningWorkspaces = workspaces;
      recommendations = latestRecommendations;
    } catch {
      loadError = "部分工作流状态暂时不可用，请稍后刷新。";
    }
  }

  const allWorkflowRuns: NonNullable<typeof workflowRuns> = workflowRuns ?? [];
  const liveRuns = allWorkflowRuns.filter(
    (run: WorkflowRunListItem) =>
      run.status === "PENDING" || run.status === "RUNNING",
  );
  const recentScreeningWorkspaces: NonNullable<typeof screeningWorkspaces> =
    screeningWorkspaces ?? [];
  const allRecommendations: NonNullable<typeof recommendations> =
    recommendations ?? [];
  const latestRecommendationRunId = recommendations?.[0]?.workflowRunId;
  const latestRecommendations = latestRecommendationRunId
    ? allRecommendations.filter(
        (item: RecommendationListItem) =>
          item.workflowRunId === latestRecommendationRunId,
      )
    : allRecommendations.slice(0, 4);

  const priorityRecommendation = latestRecommendations[0] ?? null;
  const priorityResearch = liveRuns[0] ?? allWorkflowRuns[0] ?? null;
  const priorityScreening = recentScreeningWorkspaces[0] ?? null;

  const priorityTitle = !signedIn
    ? "登录后继续今天的投资工作流"
    : priorityRecommendation
      ? `${priorityRecommendation.stockName} · ${
          actionLabelMap[priorityRecommendation.action] ??
          priorityRecommendation.action
        }`
      : priorityResearch
        ? `继续处理 ${priorityResearch.query}`
        : priorityScreening
          ? `打开工作台 ${priorityScreening.name}`
          : "开始新一轮筛选、研究与组合判断";

  const priorityDescription = !signedIn
    ? "登录后可以串起筛选、研究、公司判断和组合建议，在同一条流程里完成今天的决策。"
    : priorityRecommendation
      ? `${priorityRecommendation.reasoning.actionRationale} 当前建议区间 ${formatPct(
          priorityRecommendation.suggestedMinPct,
        )} 至 ${formatPct(priorityRecommendation.suggestedMaxPct)}。`
      : priorityResearch
        ? `${getTemplateLabel(priorityResearch.templateCode)} · ${
            priorityResearch.progressPercent
          }%`
        : priorityScreening
          ? `上次获取时间 ${formatDate(
              priorityScreening.lastFetchedAt
                ? new Date(priorityScreening.lastFetchedAt)
                : null,
            )}`
          : "从筛选开始压缩噪音，再把结论推进到行业研究、公司判断和择时组合。";

  const primaryHref = !signedIn
    ? "/login"
    : priorityRecommendation
      ? "/timing/history"
      : priorityResearch
        ? `/research/runs/${priorityResearch.id}`
        : priorityScreening
          ? `/screening?workspaceId=${priorityScreening.id}`
          : "/screening";

  const primaryLabel = !signedIn
    ? "进入工作流"
    : priorityRecommendation
      ? "查看报告历史"
      : priorityResearch
        ? "继续研究"
        : priorityScreening
          ? "打开工作台"
          : "开始筛选";

  return (
    <HydrateClient>
      <WorkspaceShell
        section="home"
        eyebrow="Mistral Workflow"
        title="用一条流程完成筛选、研究、判断和组合动作。"
        description="这不是看板。首页只保留今天最该继续的动作、四个主阶段的入口，以及最近已经形成结论的工作流。"
        actions={
          <Link href={primaryHref} className="app-button app-button-primary">
            {primaryLabel}
          </Link>
          /*
              <>
            <Link href="/screening" className="app-button">
              筛选
            </Link>
            <Link href="/research" className="app-button">
              行业研究
            </Link>
            <Link href="/research/company" className="app-button">
              公司判断
            </Link>
            <Link href="/timing" className="app-button">
              择时组合
            </Link>
              </>
          */
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
            <Link href={primaryHref} className="app-button app-button-primary">
              {primaryLabel}
            </Link>
          }
        />

        {loadError ? (
          <SectionCard surface="inset" density="compact">
            <div className="text-sm leading-6 text-[var(--app-danger)]">
              {loadError}
            </div>
          </SectionCard>
        ) : null}

        <SectionCard
          title="主流程"
          description="每个阶段都指向一个明确动作，而不是堆叠指标卡片。"
        >
          <div className="grid gap-4 lg:grid-cols-4">
            {primaryWorkflowStages.map((stage, index) => {
              const isScreening = stage.id === "screening";
              const isResearch = stage.id === "workflows";
              const isCompany = stage.id === "companyResearch";
              const stageMeta = isScreening
                ? `${recentScreeningWorkspaces.length} 个工作台`
                : isResearch
                  ? `${liveRuns.length} 条研究在运行`
                  : isCompany
                    ? `${allWorkflowRuns.length} 条研究可延伸为公司判断`
                    : `${latestRecommendations.length} 条最新组合建议`;

              return (
                <Link
                  key={stage.id}
                  href={stage.href}
                  className="border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-5 py-5 transition-colors hover:border-[var(--app-flame)] hover:bg-[var(--app-surface-strong)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--app-text-subtle)]">
                      Stage {index + 1}
                    </span>
                    <span className="app-workflow-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="mt-4 text-[30px] leading-none text-[var(--app-text-strong)]">
                    {stage.label}
                  </div>
                  <div className="mt-4 text-sm leading-6 text-[var(--app-text-muted)]">
                    {stage.summary}
                  </div>
                  <div className="mt-4 text-xs uppercase tracking-[0.14em] text-[var(--app-text-subtle)]">
                    {stageMeta}
                  </div>
                </Link>
              );
            })}
          </div>
        </SectionCard>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <SectionCard
            title="继续当前研究"
            description="优先展示正在推进中的工作，而不是总览式统计。"
            actions={
              <Link href="/research" className="app-button">
                打开研究入口
              </Link>
            }
          >
            {!signedIn ? (
              <EmptyState
                title="登录后查看进行中的研究"
                description="登录后会自动合并当前研究、筛选工作台和组合建议。"
                actions={
                  <Link href="/login" className="app-button app-button-primary">
                    登录
                  </Link>
                }
              />
            ) : liveRuns.length === 0 ? (
              <EmptyState
                title="当前没有进行中的研究"
                description="可以从行业研究页直接输入问题，或从筛选结果继续推进。"
              />
            ) : (
              <div className="grid gap-4">
                {liveRuns.slice(0, 4).map((run) => (
                  <article
                    key={run.id}
                    className="border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-5 py-5"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
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
                        <div className="mt-4 text-xl leading-tight text-[var(--app-text-strong)]">
                          {run.query}
                        </div>
                        <div className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                          {run.currentNodeKey ?? "等待结果更新"}
                        </div>
                      </div>
                      <div className="text-xs uppercase tracking-[0.14em] text-[var(--app-text-subtle)]">
                        {formatDate(run.createdAt)}
                      </div>
                    </div>
                    <ProgressBar
                      value={run.progressPercent}
                      tone={statusTone(run.status)}
                      className="mt-5"
                    />
                    <div className="mt-4">
                      <Link
                        href={buildRunDetailHref({
                          runId: run.id,
                          templateCode: run.templateCode,
                        })}
                        className="app-button app-button-primary"
                      >
                        继续处理
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="最近结论"
            description="最近一轮已经形成动作建议的输出，适合快速回到结论页面。"
            actions={
              <Link href="/timing" className="app-button">
                查看组合建议
              </Link>
            }
          >
            {!signedIn ? (
              <EmptyState title="登录后查看最新结论" />
            ) : latestRecommendations.length === 0 ? (
              <EmptyState
                title="还没有新的组合建议"
                description="先完成筛选或研究，再让工作流输出动作和区间。"
              />
            ) : (
              <div className="grid gap-4">
                {latestRecommendations.map((item) => (
                  <article
                    key={item.id}
                    className="border border-[var(--app-border-soft)] bg-[var(--app-surface)] px-5 py-5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill
                        label={actionLabelMap[item.action] ?? item.action}
                        tone="success"
                      />
                      <StatusPill
                        label={`优先级 ${item.priority}`}
                        tone="warning"
                      />
                    </div>
                    <div className="mt-4 text-xl leading-tight text-[var(--app-text-strong)]">
                      {item.stockName} · {item.stockCode}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                      {item.reasoning.actionRationale}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs uppercase tracking-[0.14em] text-[var(--app-text-subtle)]">
                      <span>
                        建议区间 {formatPct(item.suggestedMinPct)} 至{" "}
                        {formatPct(item.suggestedMaxPct)}
                      </span>
                      <Link
                        href="/timing/history"
                        className="app-button app-button-primary"
                      >
                        查看报告历史
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </WorkspaceShell>
    </HydrateClient>
  );
}

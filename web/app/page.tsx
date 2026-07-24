import Link from "next/link";
import { ImpactMappingWorkspace } from "~/app/_components/impact-mapping-workspace";
import { MarketContextSection } from "~/app/_components/market-context-section";
import { ActionStrip, SectionCard, WorkspaceShell } from "~/app/_components/ui";
import { MarketHeatmapClient } from "~/app/heatmap/market-heatmap-client";
import { formatTimingNarrative } from "~/app/timing/timing-labels";
import { getTemplateLabel } from "~/app/workflows/research-view-models";
import { auth } from "~/server/auth";
import { api, HydrateClient } from "~/trpc/server";

type WorkflowRunListItem = Awaited<
  ReturnType<typeof api.workflow.listRuns>
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
  WATCH: "观望",
  PROBE: "试仓",
  ADD: "加仓",
  HOLD: "持有",
  TRIM: "减仓",
  EXIT: "卖出",
};

export default async function Home() {
  const session = await auth();
  const signedIn = Boolean(session?.user);

  let loadError: string | null = null;
  let workflowRuns:
    | Awaited<ReturnType<typeof api.workflow.listRuns>>["items"]
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
          api.workflow.listRuns({ limit: 12 }),
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
      ? `${formatTimingNarrative(priorityRecommendation.reasoning.actionRationale)} 当前建议区间 ${formatPct(
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
        ? `/workflows/${priorityResearch.id}`
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
        actions={
          <Link href={primaryHref} className="app-button app-button-primary">
            {primaryLabel}
          </Link>
          /*
              <>
            <Link href="/screening" className="app-button">
              筛选
            </Link>
            <Link href="/workflows" className="app-button">
              行业研究
            </Link>
            <Link href="/company-research" className="app-button">
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

        {signedIn ? <MarketHeatmapClient /> : null}

        <ImpactMappingWorkspace signedIn={signedIn} />

        {loadError ? (
          <SectionCard surface="inset" density="compact">
            <div className="text-sm leading-6 text-[var(--app-danger)]">
              {loadError}
            </div>
          </SectionCard>
        ) : null}

        {signedIn ? <MarketContextSection section="home" /> : null}
      </WorkspaceShell>
    </HydrateClient>
  );
}

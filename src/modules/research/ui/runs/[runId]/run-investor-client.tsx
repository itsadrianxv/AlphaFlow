"use client";

import Link from "next/link";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  QUICK_RESEARCH_TEMPLATE_CODE,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
  TIMING_REVIEW_LOOP_TEMPLATE_CODE,
  TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
} from "~/modules/research/server/domain/workflow/types";
import {
  buildCompanyResearchDetailModel,
  CompanyResearchDetailContent,
  CompanyResearchPausedFallbackPanel,
} from "~/modules/research/ui/industry/company-research-detail";
import {
  formatSourceTypeLabel,
  formatWorkflowNodeLabel,
} from "~/modules/research/ui/industry/detail-labels";
import { ResearchOpsPanels } from "~/modules/research/ui/industry/research-ops-panels";
import {
  buildResearchDigest,
  extractConfidenceAnalysis,
  extractTimingReportCardIds,
  getQuickResearchModePills,
  isCompanyResearchResult,
} from "~/modules/research/ui/industry/research-view-models";
import { resolveWorkflowShellContext } from "~/modules/research/ui/industry/workflow-shell-context";
import { IndustryConclusionDetail } from "~/modules/research/ui/runs/[runId]/industry-conclusion-detail";
import { buildIndustryConclusionViewModel } from "~/modules/research/ui/runs/[runId]/industry-conclusion-view-model";
import { shouldShowRunDigestBanner } from "~/modules/research/ui/runs/[runId]/run-investor-layout";
import { api } from "~/platform/trpc/react";
import {
  buildScreeningWorkspaceHistoryItems,
  buildTimingReportHistoryItems,
  buildWorkflowRunHistoryItems,
} from "~/shared/ui/navigation/workspace-history";
import { MarkdownContent } from "~/shared/ui/primitives/markdown-content";
import { statusTone } from "~/shared/ui/primitives/status-tone";
import {
  ActionBanner,
  EmptyState,
  KeyPointList,
  KpiCard,
  Panel,
  StatusPill,
  WorkspaceShell,
} from "~/shared/ui/primitives/ui";

type RunInvestorClientProps = {
  runId: string;
};

type RunDetailData = {
  id: string;
  query: string;
  status:
    | "PENDING"
    | "RUNNING"
    | "PAUSED"
    | "SUCCEEDED"
    | "FAILED"
    | "CANCELLED";
  progressPercent: number;
  currentNodeKey?: string | null;
  input: unknown;
  errorCode: string | null;
  errorMessage: string | null;
  result: unknown;
  template: {
    code: string;
    version: number;
  };
  createdAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  nodes: Array<{
    id: string;
    nodeKey: string;
    agentName: string;
    attempt: number;
    status: "PENDING" | "RUNNING" | "SUCCEEDED" | "SKIPPED" | "FAILED";
    errorCode: string | null;
    errorMessage: string | null;
    durationMs: number | null;
    startedAt: Date | null;
    completedAt: Date | null;
    output: unknown;
  }>;
  events: Array<{
    id: string;
    sequence: number;
    eventType: string;
    payload: unknown;
    occurredAt: Date;
  }>;
};

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
    second: "2-digit",
  }).format(value);
}

function formatConfidenceLevel(level?: string) {
  switch (level) {
    case "high":
      return "高";
    case "medium":
      return "中";
    case "low":
      return "低";
    default:
      return "未知";
  }
}

const statusLabels: Record<string, string> = {
  PENDING: "排队中",
  RUNNING: "进行中",
  PAUSED: "已暂停",
  SUCCEEDED: "已完成",
  FAILED: "失败",
  CANCELLED: "已取消",
};

function getTitle(templateCode?: string) {
  if (templateCode === COMPANY_RESEARCH_TEMPLATE_CODE) {
    return "公司结论";
  }

  if (templateCode === QUICK_RESEARCH_TEMPLATE_CODE) {
    return "行业结论";
  }

  if (
    templateCode === TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE ||
    templateCode === WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE ||
    templateCode === WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE ||
    templateCode === TIMING_REVIEW_LOOP_TEMPLATE_CODE
  ) {
    return "择时结论";
  }

  return "研究结论";
}

function GenericRunResult(props: { run: RunDetailData }) {
  const { run } = props;
  const digest = buildResearchDigest({
    templateCode: run.template.code,
    query: run.query,
    status: run.status,
    progressPercent: run.progressPercent,
    currentNodeKey: run.currentNodeKey,
    result: run.result,
  });
  const confidenceAnalysis = extractConfidenceAnalysis(run.result);
  const companyResult = isCompanyResearchResult(run.result) ? run.result : null;
  const timingReportCardIds = extractTimingReportCardIds(run.result);
  const nextSectionItems =
    digest.gaps.length > 0 ? digest.gaps : digest.nextActions;

  return (
    <>
      <ActionBanner
        title={digest.headline}
        description={<MarkdownContent content={digest.summary} compact />}
        tone={digest.verdictTone}
        actions={
          <StatusPill label={digest.verdictLabel} tone={digest.verdictTone} />
        }
      />

      {timingReportCardIds.length > 0 ? (
        <Panel
          title="择时报告入口"
          description="这次工作流已经产出择时卡片，可以进入对应报告查看价格结构、证据引擎和复盘时间线。"
        >
          <div className="flex flex-wrap gap-2">
            {timingReportCardIds.map((cardId, index) => (
              <Link
                key={cardId}
                href={`/timing/reports/${cardId}`}
                className="app-button"
              >
                {timingReportCardIds.length === 1
                  ? "查看单股报告"
                  : `查看报告 ${index + 1}`}
              </Link>
            ))}
          </div>
        </Panel>
      ) : null}

      {run.errorMessage ? (
        <div className="rounded-[16px] border border-[var(--app-danger-border)] bg-[var(--app-danger-surface)] px-4 py-3 text-sm text-[var(--app-danger)]">
          {run.errorCode ? `${run.errorCode}: ` : ""}
          {run.errorMessage}
        </div>
      ) : null}

      <Panel
        title="可信度分析"
        description="在不改写原始结论的前提下，保留支持、证据不足与冲突信号。"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
            <div className="text-xs text-[var(--app-text-soft)]">
              可信度得分
            </div>
            <div className="app-data mt-2 text-lg text-[var(--app-text)]">
              {confidenceAnalysis?.finalScore ?? "未分析"}
            </div>
          </div>
          <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
            <div className="text-xs text-[var(--app-text-soft)]">等级</div>
            <div className="app-data mt-2 text-lg text-[var(--app-text)]">
              {formatConfidenceLevel(confidenceAnalysis?.level)}
            </div>
          </div>
          <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
            <div className="text-xs text-[var(--app-text-soft)]">
              支持/不足/冲突
            </div>
            <div className="app-data mt-2 text-lg text-[var(--app-text)]">
              {confidenceAnalysis
                ? `${confidenceAnalysis.supportedCount}/${confidenceAnalysis.insufficientCount}/${confidenceAnalysis.contradictedCount}`
                : "0/0/0"}
            </div>
          </div>
          <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
            <div className="text-xs text-[var(--app-text-soft)]">
              证据覆盖率
            </div>
            <div className="app-data mt-2 text-lg text-[var(--app-text)]">
              {confidenceAnalysis
                ? `${confidenceAnalysis.evidenceCoverageScore}%`
                : "未分析"}
            </div>
          </div>
        </div>
      </Panel>

      <Panel title="关键指标">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {digest.metrics.length === 0 ? (
            <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3 text-sm text-[var(--app-text-muted)]">
              暂无结构化指标。
            </div>
          ) : (
            digest.metrics.map((metric) => (
              <div
                key={`${metric.label}-${metric.value}`}
                className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3"
              >
                <div className="text-xs text-[var(--app-text-soft)]">
                  {metric.label}
                </div>
                <div className="app-data mt-2 text-lg text-[var(--app-text)]">
                  {metric.value}
                </div>
              </div>
            ))
          )}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <KeyPointList
          title="看多逻辑"
          items={digest.bullPoints.map((item) => (
            <MarkdownContent key={item} content={item} compact />
          ))}
          emptyText="暂未提取出看多逻辑。"
          tone="success"
        />
        <KeyPointList
          title="风险点"
          items={digest.bearPoints.map((item) => (
            <MarkdownContent key={item} content={item} compact />
          ))}
          emptyText="暂未提取出明确风险。"
          tone="warning"
        />
        <KeyPointList
          title="证据摘要"
          items={digest.evidence.map((item) => (
            <MarkdownContent key={item} content={item} compact />
          ))}
          emptyText="暂无结构化证据摘要。"
          tone="info"
        />
        <KeyPointList
          title={digest.gaps.length > 0 ? "待补缺口" : "下一步动作"}
          items={nextSectionItems.map((item) => (
            <MarkdownContent key={item} content={item} compact />
          ))}
          emptyText="暂无后续动作。"
          tone="neutral"
        />
      </div>

      <ResearchOpsPanels result={run.result} />

      {companyResult ? (
        <Panel
          title="引用覆盖情况"
          description="展示一手信源覆盖、采集器输出，以及最终公司结论使用到的结构化引用。"
        >
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
              <div className="text-xs text-[var(--app-text-soft)]">
                原始证据
              </div>
              <div className="app-data mt-2 text-lg text-[var(--app-text)]">
                {companyResult.collectionSummary?.totalRawCount ??
                  companyResult.evidence.length}
              </div>
            </div>
            <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
              <div className="text-xs text-[var(--app-text-soft)]">
                入选证据
              </div>
              <div className="app-data mt-2 text-lg text-[var(--app-text)]">
                {companyResult.collectionSummary?.totalCuratedCount ??
                  companyResult.evidence.length}
              </div>
            </div>
            <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
              <div className="text-xs text-[var(--app-text-soft)]">引用</div>
              <div className="app-data mt-2 text-lg text-[var(--app-text)]">
                {companyResult.collectionSummary?.totalReferenceCount ??
                  companyResult.evidence.length}
              </div>
            </div>
            <div className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3">
              <div className="text-xs text-[var(--app-text-soft)]">
                一手信源
              </div>
              <div className="app-data mt-2 text-lg text-[var(--app-text)]">
                {companyResult.collectionSummary?.totalFirstPartyCount ??
                  companyResult.evidence.filter((item) => item.isFirstParty)
                    .length}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3">
            {(companyResult.references ?? []).slice(0, 8).map((reference) => (
              <div
                key={reference.id}
                className="rounded-[12px] border border-[var(--app-border)] bg-[var(--app-panel)] px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill
                    label={formatSourceTypeLabel(reference.sourceType)}
                    tone="neutral"
                  />
                  <StatusPill
                    label={reference.isFirstParty ? "一手" : "外部"}
                    tone={reference.isFirstParty ? "success" : "neutral"}
                  />
                  {reference.url ? (
                    <a
                      href={reference.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-[var(--app-accent-strong)] hover:underline"
                    >
                      {reference.title}
                    </a>
                  ) : (
                    <span className="text-sm text-[var(--app-text)]">
                      {reference.title}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                  {reference.extractedFact}
                </p>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}
    </>
  );
}

export function RunInvestorClient({ runId }: RunInvestorClientProps) {
  const utils = api.useUtils();

  const runQuery = api.research.runs.getRun.useQuery(
    { runId },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status;

        if (
          status === "SUCCEEDED" ||
          status === "PAUSED" ||
          status === "FAILED" ||
          status === "CANCELLED"
        ) {
          return false;
        }

        return 10_000;
      },
    },
  );

  const cancelMutation = api.research.runs.cancelRun.useMutation({
    onSuccess: async () => {
      await utils.research.runs.getRun.invalidate({ runId });
    },
  });
  const approveMutation =
    api.research.runs.approveScreeningInsights.useMutation({
      onSuccess: async () => {
        await utils.research.runs.getRun.invalidate({ runId });
      },
    });

  const run = runQuery.data as RunDetailData | undefined;
  const shellContext = resolveWorkflowShellContext(run?.template.code);
  const screeningHistoryQuery = api.screening.listWorkspaces.useQuery(
    { limit: 8, offset: 0 },
    {
      enabled: shellContext.historyQueryKind === "screening",
      refetchOnWindowFocus: false,
    },
  );
  const companyHistoryQuery = api.research.runs.listRuns.useQuery(
    {
      limit: 8,
      templateCode: COMPANY_RESEARCH_TEMPLATE_CODE,
    },
    {
      enabled: shellContext.historyQueryKind === "companyResearch",
      refetchOnWindowFocus: false,
    },
  );
  const timingHistoryQuery = api.timing.listTimingCards.useQuery(
    {
      limit: 8,
    },
    {
      enabled: shellContext.historyQueryKind === "timing",
      refetchOnWindowFocus: false,
    },
  );
  const workflowHistoryQuery = api.research.runs.listRuns.useQuery(
    {
      limit: 8,
      templateCode: QUICK_RESEARCH_TEMPLATE_CODE,
    },
    {
      enabled: shellContext.historyQueryKind === "workflows",
      refetchOnWindowFocus: false,
    },
  );
  const historyItems =
    shellContext.historyQueryKind === "screening"
      ? buildScreeningWorkspaceHistoryItems(screeningHistoryQuery.data ?? [])
      : shellContext.historyQueryKind === "companyResearch"
        ? buildWorkflowRunHistoryItems(companyHistoryQuery.data?.items ?? [])
        : shellContext.historyQueryKind === "timing"
          ? buildTimingReportHistoryItems(timingHistoryQuery.data ?? [])
          : buildWorkflowRunHistoryItems(
              workflowHistoryQuery.data?.items ?? [],
            );
  const historyLoading =
    shellContext.historyQueryKind === "screening"
      ? screeningHistoryQuery.isLoading
      : shellContext.historyQueryKind === "companyResearch"
        ? companyHistoryQuery.isLoading
        : shellContext.historyQueryKind === "timing"
          ? timingHistoryQuery.isLoading
          : workflowHistoryQuery.isLoading;
  const canApprove =
    run?.template.code === SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE &&
    run.status === "PAUSED";
  const digest = buildResearchDigest({
    templateCode: run?.template.code,
    query: run?.query,
    status: run?.status,
    progressPercent: run?.progressPercent,
    currentNodeKey: run?.currentNodeKey,
    result: run?.result,
  });
  const companyDetailModel =
    run?.template.code === COMPANY_RESEARCH_TEMPLATE_CODE
      ? buildCompanyResearchDetailModel({
          status: run.status,
          result: run.result,
          input: run.input,
          currentNodeKey: run.currentNodeKey ?? undefined,
        })
      : null;
  const showCompanyDetailExperience =
    run?.template.code === COMPANY_RESEARCH_TEMPLATE_CODE &&
    (run.status === "SUCCEEDED" || run.status === "PAUSED") &&
    companyDetailModel !== null;
  const showDigestBanner = shouldShowRunDigestBanner({
    templateCode: run?.template.code,
    status: run?.status,
    hasCompanyDetailModel: companyDetailModel !== null,
  });
  const quickResearchModePills =
    run?.template.code === QUICK_RESEARCH_TEMPLATE_CODE
      ? getQuickResearchModePills(run?.result, run?.input)
      : [];
  const timingReportCardIds = extractTimingReportCardIds(run?.result);
  const industryConclusionModel = buildIndustryConclusionViewModel({
    runId,
    query: run?.query,
    status: run?.status,
    input: run?.input,
    result: run?.result,
    timingReportCardIds,
  });
  const showIndustryConclusion =
    run?.template.code === QUICK_RESEARCH_TEMPLATE_CODE &&
    run?.status === "SUCCEEDED" &&
    industryConclusionModel !== null;

  return (
    <WorkspaceShell
      section={shellContext.section}
      historyItems={historyItems}
      historyHref={shellContext.historyHref}
      activeHistoryId={
        shellContext.historyQueryKind === "timing"
          ? (timingReportCardIds[0] ?? undefined)
          : runId
      }
      historyLoading={historyLoading}
      eyebrow="投资结论"
      title={getTitle(run?.template.code)}
      description={
        showIndustryConclusion
          ? "把行业研究结论按步骤阅读，并将 Agent 状态图作为第一步。"
          : "把核心结论、证据摘要、风险、下一步动作和可信度分析放在同一页查看。"
      }
      contentWidth={showIndustryConclusion ? "wide" : "standard"}
      actions={
        <>
          <Link href={shellContext.backHref} className="app-button">
            返回
          </Link>
          <Link href={`/research/runs/${runId}/debug`} className="app-button">
            调试视图
          </Link>
          {timingReportCardIds[0] ? (
            <Link
              href={`/timing/reports/${timingReportCardIds[0]}`}
              className="app-button app-button-primary"
            >
              查看单股报告
            </Link>
          ) : null}
          <Link
            href={`/research/spaces?addRunId=${runId}`}
            className="app-button"
          >
            加入研究空间
          </Link>
          {canApprove ? (
            <button
              type="button"
              onClick={() => approveMutation.mutate({ runId })}
              disabled={approveMutation.isPending}
              className="app-button app-button-primary"
            >
              {approveMutation.isPending ? "恢复中..." : "审批并继续"}
            </button>
          ) : null}
          {run &&
          (run.status === "RUNNING" ||
            run.status === "PENDING" ||
            run.status === "PAUSED") ? (
            <button
              type="button"
              onClick={() => cancelMutation.mutate({ runId })}
              className="app-button app-button-danger"
            >
              取消任务
            </button>
          ) : null}
        </>
      }
      summary={
        showIndustryConclusion ? undefined : (
          <>
            <KpiCard
              label="状态"
              value={run ? (statusLabels[run.status] ?? run.status) : "-"}
              hint={
                run?.currentNodeKey
                  ? formatWorkflowNodeLabel(run.currentNodeKey)
                  : "暂无活动节点"
              }
              tone={statusTone(run?.status)}
            />
            <KpiCard
              label="发起时间"
              value={formatDate(run?.createdAt)}
              hint="任务创建时间"
              tone="neutral"
            />
            <KpiCard
              label="完成时间"
              value={formatDate(run?.completedAt)}
              hint="任务运行中会自动刷新"
              tone="info"
            />
            <KpiCard
              label="核心指标"
              value={digest.metrics[0]?.value ?? "-"}
              hint={digest.metrics[0]?.label ?? "暂无指标"}
              tone={digest.verdictTone}
            />
          </>
        )
      }
    >
      {runQuery.isLoading ? (
        <EmptyState
          title="正在加载结论详情"
          description="运行数据加载完成后，这里会显示结果摘要。"
        />
      ) : !run ? (
        <EmptyState
          title="未找到该任务"
          description="该任务可能已被删除，或当前账号没有访问权限。"
        />
      ) : showIndustryConclusion && industryConclusionModel ? (
        <IndustryConclusionDetail model={industryConclusionModel} run={run} />
      ) : (
        <>
          {showDigestBanner ? (
            <ActionBanner
              title={digest.headline}
              description={<MarkdownContent content={digest.summary} compact />}
              tone={digest.verdictTone}
              actions={
                <>
                  <StatusPill
                    label={digest.verdictLabel}
                    tone={digest.verdictTone}
                  />
                  {quickResearchModePills.map((label) => (
                    <StatusPill
                      key={label}
                      label={label}
                      tone={label === "已自动升级" ? "warning" : "info"}
                    />
                  ))}
                </>
              }
            />
          ) : null}

          {canApprove ? (
            <ActionBanner
              title="需要人工审批"
              description="这条筛选洞察流程已暂停，需要审批后才能继续执行。"
              tone="warning"
              actions={
                <button
                  type="button"
                  onClick={() => approveMutation.mutate({ runId })}
                  disabled={approveMutation.isPending}
                  className="app-button app-button-primary"
                >
                  {approveMutation.isPending ? "恢复中..." : "审批并继续"}
                </button>
              }
            />
          ) : null}

          {run.errorMessage ? (
            <div className="rounded-[16px] border border-[var(--app-danger-border)] bg-[var(--app-danger-surface)] px-4 py-3 text-sm text-[var(--app-danger)]">
              {run.errorCode ? `${run.errorCode}: ` : ""}
              {run.errorMessage}
            </div>
          ) : null}

          {approveMutation.error ? (
            <div className="rounded-[16px] border border-[var(--app-danger-border)] bg-[var(--app-danger-surface)] px-4 py-3 text-sm text-[var(--app-danger)]">
              {approveMutation.error.message}
            </div>
          ) : null}

          {showCompanyDetailExperience ? (
            companyDetailModel.kind === "detail" ? (
              <CompanyResearchDetailContent
                model={companyDetailModel}
                run={run}
              />
            ) : (
              <CompanyResearchPausedFallbackPanel
                model={companyDetailModel}
                run={run}
              />
            )
          ) : (
            <GenericRunResult run={run} />
          )}
        </>
      )}
    </WorkspaceShell>
  );
}

"use client";

import Link from "next/link";
import {
  EmptyState,
  InlineNotice,
  LoadingSkeleton,
  WorkspaceShell,
} from "~/app/_components/ui";
import { buildWorkflowRunHistoryItems } from "~/app/_components/workspace-history";
import { TimingReportView } from "~/app/timing/reports/[cardId]/timing-report-view";
import { timingTemplateCodes } from "~/app/workflows/workflow-shell-context";
import { api } from "~/trpc/react";

export function TimingReportClient(props: { cardId: string }) {
  const { cardId } = props;
  const reportQuery = api.timing.getTimingReport.useQuery(
    { cardId },
    { refetchOnWindowFocus: false },
  );
  const runsQuery = api.workflow.listRuns.useQuery(
    {
      limit: 8,
      templateCodes: [...timingTemplateCodes],
    },
    {
      refetchOnWindowFocus: false,
    },
  );
  const historyItems = buildWorkflowRunHistoryItems(
    runsQuery.data?.items ?? [],
  );
  const report = reportQuery.data;

  return (
    <WorkspaceShell
      section="timing"
      contentWidth="wide"
      historyItems={historyItems}
      historyHref="/timing/history"
      historyLoading={runsQuery.isLoading}
      historyEmptyText="还没有择时记录"
      eyebrow="单股择时报告"
      title={
        report ? `${report.card.stockName} · 择时研究报告` : "单股择时研究报告"
      }
      description={
        report
          ? `报告默认冻结在 ${report.card.asOfDate ?? report.card.signalSnapshot?.asOfDate ?? "-"} 的日线视角，用价格结构、证据引擎和复盘时间线解释当前判断。`
          : "从现有择时卡片进入详情，查看完整的单股研究报告。"
      }
      actions={
        <>
          <Link href="/timing" className="app-button">
            返回择时列表
          </Link>
          {report?.card.workflowRunId ? (
            <Link
              href={`/workflows/${report.card.workflowRunId}`}
              className="app-button"
            >
              查看工作流
            </Link>
          ) : null}
        </>
      }
    >
      {reportQuery.isLoading ? <LoadingSkeleton rows={4} /> : null}
      {reportQuery.error ? (
        <InlineNotice
          tone="danger"
          title="报告加载失败"
          description={reportQuery.error.message}
        />
      ) : null}
      {!reportQuery.isLoading && !reportQuery.error && !report ? (
        <EmptyState title="未找到对应的择时报告" />
      ) : null}
      {report ? <TimingReportView report={report} /> : null}
    </WorkspaceShell>
  );
}

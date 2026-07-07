"use client";

import Link from "next/link";
import {
  EmptyState,
  InlineNotice,
  LoadingSkeleton,
  WorkspaceShell,
} from "~/app/_components/ui";
import { buildTimingReportHistoryItems } from "~/app/_components/workspace-history";
import { TimingReportView } from "~/app/timing/reports/[cardId]/timing-report-view";
import { api } from "~/trpc/react";

export function TimingReportClient(props: { cardId: string }) {
  const { cardId } = props;
  const reportQuery = api.timing.getTimingReport.useQuery(
    { cardId },
    { refetchOnWindowFocus: false },
  );
  const historyCardsQuery = api.timing.listTimingCards.useQuery(
    {
      limit: 20,
    },
    {
      refetchOnWindowFocus: false,
    },
  );
  const report = reportQuery.data;
  const historyItems = buildTimingReportHistoryItems(
    report
      ? [
          report.card,
          ...(historyCardsQuery.data ?? []).filter(
            (item) => item.id !== report.card.id,
          ),
        ]
      : (historyCardsQuery.data ?? []),
  );

  return (
    <WorkspaceShell
      section="timing"
      contentWidth="wide"
      historyItems={historyItems}
      historyHref="/timing/history"
      activeHistoryId={cardId}
      historyLoading={historyCardsQuery.isLoading}
      historyEmptyText="还没有择时报告"
      titleSize="compact"
      title={
        report
          ? `${report.card.stockCode} ${report.card.stockName} · 择时研究报告`
          : "单股择时研究报告"
      }
      actions={
        <Link href="/timing" className="app-button">
          返回择时工作台
        </Link>
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

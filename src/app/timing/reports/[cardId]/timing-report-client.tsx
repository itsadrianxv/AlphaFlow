"use client";

import Link from "next/link";
/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React from "react";
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
  const runQuery = api.workflow.getRun.useQuery(
    { runId: report?.card.workflowRunId ?? "" },
    {
      enabled: Boolean(report?.card.workflowRunId),
      refetchOnWindowFocus: false,
    },
  );
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
      historyEmptyText="杩樻病鏈夋嫨鏃舵姤鍛?"
      titleSize="compact"
      title={
        report
          ? `${report.card.stockCode} ${report.card.stockName} 路 鎷╂椂鐮旂┒鎶ュ憡`
          : "鍗曡偂鎷╂椂鐮旂┒鎶ュ憡"
      }
      description={
        report
          ? `鎶ュ憡榛樿鍐荤粨鍦?${report.card.asOfDate ?? report.card.signalSnapshot?.asOfDate ?? "-"} 鐨勬棩绾胯瑙掞紝鐢ㄤ环鏍肩粨鏋勩€佽瘉鎹紩鎿庡拰澶嶇洏鏃堕棿绾胯В閲婂綋鍓嶅垽鏂€俙`
          : "浠庣幇鏈夋嫨鏃跺崱鐗囪繘鍏ヨ鎯咃紝鏌ョ湅瀹屾暣鐨勫崟鑲＄爺绌舵姤鍛娿€?"
      }
      actions={
        <Link href="/timing" className="app-button">
          杩斿洖鎷╂椂宸ヤ綔鍙?
        </Link>
      }
    >
      {reportQuery.isLoading ? <LoadingSkeleton rows={4} /> : null}
      {reportQuery.error ? (
        <InlineNotice
          tone="danger"
          title="鎶ュ憡鍔犺浇澶辫触"
          description={reportQuery.error.message}
        />
      ) : null}
      {!reportQuery.isLoading && !reportQuery.error && !report ? (
        <EmptyState title="鏈壘鍒板搴旂殑鎷╂椂鎶ュ憡" />
      ) : null}
      {report ? (
        <>
          {runQuery.error ? (
            <InlineNotice
              tone="warning"
              title="关联 workflow 加载失败"
              description={runQuery.error.message}
            />
          ) : null}
          <TimingReportView report={report} run={runQuery.data ?? null} />
        </>
      ) : null}
    </WorkspaceShell>
  );
}

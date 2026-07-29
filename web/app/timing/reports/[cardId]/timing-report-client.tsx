"use client";

import Link from "next/link";
import { useState } from "react";
import { HighlightToNote } from "~/app/_components/highlight-to-note";
import { EmptyState, InlineNotice, LoadingSkeleton, WorkspaceShell } from "~/app/_components/ui";
import { TimingReportView } from "~/app/timing/reports/[cardId]/timing-report-view";
import type { TimingTimeframe } from "~/server/domain/timing/types";
import { api } from "~/trpc/react";

export function TimingReportClient(props: { cardId: string }) {
  const [timeframe, setTimeframe] = useState<TimingTimeframe>("DAILY");
  const reportQuery = api.timing.getResearchReport.useQuery({ reportId: props.cardId }, { refetchOnWindowFocus: false });
  const seriesQuery = api.timing.getResearchSeries.useQuery({ reportId: props.cardId, timeframe }, { enabled: Boolean(reportQuery.data && timeframe !== "DAILY"), refetchOnWindowFocus: false });
  const report = reportQuery.data;
  return <WorkspaceShell section="timing" contentWidth="wide" titleSize="compact" title={report ? `${report.report.stockCode} ${report.report.stockName} · 择时研究报告` : "择时研究报告"} actions={<Link href="/timing" className="app-button">返回研究工作台</Link>}>
    {reportQuery.isLoading ? <LoadingSkeleton rows={4} /> : null}
    {reportQuery.error ? <InlineNotice tone="danger" title="报告加载失败" description={reportQuery.error.message} /> : null}
    {!reportQuery.isLoading && !reportQuery.error && !report ? <EmptyState title="未找到对应的研究报告" /> : null}
    {report ? <HighlightToNote floatingToolbar source={{ kind: "timing_report", cardId: props.cardId, stockCode: report.report.stockCode, stockName: report.report.stockName }}><TimingReportView report={report} timeframe={timeframe} series={timeframe === "DAILY" ? undefined : seriesQuery.data} seriesLoading={timeframe !== "DAILY" && seriesQuery.isLoading} onTimeframeChange={setTimeframe} /></HighlightToNote> : null}
  </WorkspaceShell>;
}

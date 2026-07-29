"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState, InlineNotice, LoadingSkeleton, StatusPill, WorkspaceShell } from "~/app/_components/ui";
import { formatTimingResearchStateLabel, formatTimingTrendStateLabel } from "~/app/timing/timing-labels";
import { api } from "~/trpc/react";

export function TimingHistoryClient() {
  const [keyword, setKeyword] = useState("");
  const reportsQuery = api.timing.listResearchReports.useQuery({ limit: 100 }, { refetchOnWindowFocus: false });
  const reports = useMemo(() => (reportsQuery.data ?? []).filter((item) => {
    const query = keyword.trim().toLowerCase();
    return !query || item.stockCode.includes(query) || item.stockName.toLowerCase().includes(query);
  }), [keyword, reportsQuery.data]);

  return <WorkspaceShell section="timing" sectionView="history" contentWidth="wide" title="研究档案" titleSize="compact" description="按数据日期归档的个股技术研究报告" actions={<Link href="/timing" className="app-button">返回择时研究</Link>}>
    <div className="grid gap-6">
      <label className="grid max-w-md gap-2 text-sm text-[var(--app-text-muted)]">搜索报告<input className="app-input" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="股票代码或名称" /></label>
      {reportsQuery.isLoading ? <LoadingSkeleton rows={5} /> : null}
      {reportsQuery.error ? <InlineNotice tone="danger" title="档案加载失败" description={reportsQuery.error.message} /> : null}
      {!reportsQuery.isLoading && !reportsQuery.error && reports.length === 0 ? <EmptyState title="暂无研究报告" /> : null}
      {reports.length ? <div className="overflow-x-auto border border-[var(--app-border-soft)]"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-[var(--app-surface-quiet)]"><tr><th className="px-3 py-2">股票</th><th className="px-3 py-2">研究状态</th><th className="px-3 py-2">趋势状态</th><th className="px-3 py-2">数据日期</th><th className="px-3 py-2">数据完整性</th><th className="px-3 py-2">生成时间</th><th className="px-3 py-2">报告</th></tr></thead><tbody>{reports.map((report) => <tr key={report.id} className="border-t border-[var(--app-border-soft)]"><td className="px-3 py-3 font-medium">{report.stockName}<span className="ml-2 font-mono text-xs text-[var(--app-text-muted)]">{report.stockCode}</span></td><td className="px-3 py-3"><StatusPill label={formatTimingResearchStateLabel(report.researchState)} tone="info" /></td><td className="px-3 py-3">{formatTimingTrendStateLabel(report.trendState)}</td><td className="px-3 py-3 font-mono text-xs">{report.asOfDate ?? "-"}</td><td className="px-3 py-3">{report.dataCompleteness.status}</td><td className="px-3 py-3 font-mono text-xs">{new Date(report.createdAt).toLocaleString("zh-CN")}</td><td className="px-3 py-3"><Link className="app-button" href={`/timing/reports/${report.id}`}>查看</Link></td></tr>)}</tbody></table></div> : null}
    </div>
  </WorkspaceShell>;
}

"use client";

import { useState } from "react";
import { EmptyState, StatusPill } from "~/app/_components/ui";
import { TimingReportChart } from "~/app/timing/reports/[cardId]/timing-report-chart";
import {
  formatTimingBreadthTrendLabel,
  formatTimingDimensionStatusLabel,
  formatTimingDirectionLabel,
  formatTimingMarketStateLabel,
  formatTimingMarketTransitionLabel,
  formatTimingResearchStateLabel,
  formatTimingRiskFlagLabel,
  formatTimingTrendStateLabel,
  formatTimingVolatilityTrendLabel,
} from "~/app/timing/timing-labels";
import type { TimingReportPayload, TimingReportSeriesPayload, TimingTimeframe } from "~/server/domain/timing/types";

const tabs = [
  ["overview", "研究概览"],
  ["technical", "技术结构"],
  ["market", "市场环境"],
  ["model", "模型预测"],
  ["evidence", "数据证据"],
] as const;

function toneForStatus(status: string) {
  if (["POSITIVE", "CONFIRMED", "COMPLETE"].includes(status)) return "success" as const;
  if (["NEGATIVE", "INVALIDATED", "INSUFFICIENT"].includes(status)) return "danger" as const;
  if (["MIXED", "FORMING", "PARTIAL"].includes(status)) return "warning" as const;
  return "neutral" as const;
}

export function TimingReportView(props: {
  report: TimingReportPayload;
  timeframe: TimingTimeframe;
  series?: TimingReportSeriesPayload;
  seriesLoading?: boolean;
  onTimeframeChange: (timeframe: TimingTimeframe) => void;
}) {
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("overview");
  const record = props.report.report;
  const displayed = props.series ?? props.report;

  return (
    <div className="grid gap-6">
      <div className="flex overflow-x-auto border-b border-[var(--app-border-soft)]">
        {tabs.map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} className={`shrink-0 border-b-2 px-4 py-3 text-sm ${tab === value ? "border-[var(--app-text-strong)] text-[var(--app-text-strong)]" : "border-transparent text-[var(--app-text-muted)]"}`}>{label}</button>)}
      </div>

      {tab === "overview" ? <>
        <div className="grid grid-cols-2 gap-px overflow-hidden border border-[var(--app-border-soft)] bg-[var(--app-border-soft)] lg:grid-cols-4">
          <Metric label="研究状态" value={formatTimingResearchStateLabel(record.researchState)} />
          <Metric label="趋势状态" value={formatTimingTrendStateLabel(record.trendState)} />
          <Metric label="数据完整性" value={`${record.dataCompleteness.available}/${record.dataCompleteness.total}`} />
          <Metric label="研究置信度" value={`${Math.round(record.confidence * 100)}%`} />
        </div>
        <section className="grid gap-3 border-b border-[var(--app-border-soft)] pb-6"><h2 className="text-base font-semibold">综合说明</h2><p className="max-w-5xl text-sm leading-7 text-[var(--app-text-muted)]">{record.summary}</p>{record.riskFlags.length ? <div className="flex flex-wrap gap-2">{record.riskFlags.map((flag) => <StatusPill key={flag} label={formatTimingRiskFlagLabel(flag)} tone="warning" />)}</div> : <p className="text-sm text-[var(--app-text-muted)]">未识别到主要结构风险标记。</p>}</section>
        <TimingReportChart bars={displayed.bars} chartLevels={displayed.chartLevels} forecast={displayed.modelOutlook} timeframe={props.timeframe} onTimeframeChange={props.onTimeframeChange} seriesLoading={props.seriesLoading} />
      </> : null}

      {tab === "technical" ? <div className="grid gap-8">
        <div className="overflow-x-auto border border-[var(--app-border-soft)]"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[var(--app-surface-quiet)]"><tr><th className="px-3 py-2">维度</th><th className="px-3 py-2">评价</th><th className="px-3 py-2">分数</th><th className="px-3 py-2">证据</th><th className="px-3 py-2">局限</th><th className="px-3 py-2">数据日期</th></tr></thead><tbody>{record.dimensions.map((item) => <tr key={item.key} className="border-t border-[var(--app-border-soft)] align-top"><td className="px-3 py-3 font-medium">{item.label}</td><td className="px-3 py-3"><StatusPill label={formatTimingDimensionStatusLabel(item.status)} tone={toneForStatus(item.status)} /></td><td className="px-3 py-3 font-mono">{item.score == null ? "-" : item.score.toFixed(1)}</td><td className="px-3 py-3 text-[var(--app-text-muted)]">{item.evidence.join("；") || "暂无"}</td><td className="px-3 py-3 text-[var(--app-text-muted)]">{item.limitations.join("；") || "无"}</td><td className="px-3 py-3 font-mono text-xs">{item.dataAsOf ?? "-"}</td></tr>)}</tbody></table></div>
        <section className="grid gap-3"><h2 className="text-base font-semibold">观察条件</h2>{record.observationConditions.length ? <div className="divide-y divide-[var(--app-border-soft)] border-y border-[var(--app-border-soft)]">{record.observationConditions.map((item) => <div key={item.id} className="grid gap-2 py-4 md:grid-cols-[180px_120px_1fr]"><div className="font-medium">{item.label}</div><StatusPill label={item.kind === "CONFIRMATION" ? "确认观察" : item.kind === "CHANGE" ? "变化观察" : "风险观察"} tone={item.kind === "RISK" ? "warning" : "info"} /><div className="text-sm leading-6 text-[var(--app-text-muted)]">{item.explanation}</div></div>)}</div> : <EmptyState title="暂无观察条件" />}</section>
      </div> : null}

      {tab === "market" ? <div className="grid gap-6"><InlineMetrics items={[["环境状态", formatTimingMarketStateLabel(props.report.marketContext.state)], ["状态变化", formatTimingMarketTransitionLabel(props.report.marketContext.transition)], ["市场广度", formatTimingBreadthTrendLabel(props.report.marketContext.breadthTrend)], ["波动趋势", formatTimingVolatilityTrendLabel(props.report.marketContext.volatilityTrend)]]} /><section className="grid gap-3"><h2 className="text-base font-semibold">环境解释</h2><p className="max-w-5xl text-sm leading-7 text-[var(--app-text-muted)]">{props.report.marketContext.summary}</p><p className="text-sm text-[var(--app-text-muted)]">领涨结构：{props.report.marketContext.leadership.leaderName || "暂无"}{props.report.marketContext.leadership.switched ? "，近期发生切换" : "，近期保持稳定"}</p></section><div className="border-l-2 border-[var(--app-info-border)] pl-4 text-sm leading-6 text-[var(--app-text-muted)]">市场环境用于解释研究背景，不参与个股研究状态判定。</div></div> : null}

      {tab === "model" ? props.report.modelOutlook ? <div className="grid gap-6"><InlineMetrics items={[["模型方向", formatTimingDirectionLabel(props.report.modelOutlook.summary.direction)], ["预测上沿", `${props.report.modelOutlook.summary.upsidePct.toFixed(2)}%`], ["不确定性", `${props.report.modelOutlook.summary.volatilityProxy.toFixed(2)}`], ["置信度", `${Math.round(props.report.modelOutlook.summary.confidence * 100)}%`]]} /><div className="overflow-x-auto border border-[var(--app-border-soft)]"><table className="w-full min-w-[620px] text-left text-sm"><tbody><Row label="模型版本" value={`${props.report.modelOutlook.modelName} ${props.report.modelOutlook.modelVersion}`} /><Row label="数据日期" value={props.report.modelOutlook.asOfDate} /><Row label="观察区间" value={`${props.report.modelOutlook.predictionLength} 个数据点`} /><Row label="输入窗口" value={`${props.report.modelOutlook.lookbackBars} 个数据点`} /></tbody></table></div><div className="border-l-2 border-[var(--app-info-border)] pl-4 text-sm leading-6 text-[var(--app-text-muted)]">模型预测为独立研究输出，不参与综合分数或研究状态。</div></div> : <EmptyState title="当前报告没有可用的模型预测" /> : null}

      {tab === "evidence" ? <div className="grid gap-8"><section className="grid gap-3"><h2 className="text-base font-semibold">数据清单</h2><div className="overflow-x-auto border border-[var(--app-border-soft)]"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[var(--app-surface-quiet)]"><tr><th className="px-3 py-2">数据集</th><th className="px-3 py-2">来源</th><th className="px-3 py-2">周期</th><th className="px-3 py-2">日期</th><th className="px-3 py-2">完整性</th><th className="px-3 py-2">内容哈希</th></tr></thead><tbody>{record.reasoning.dataManifest.map((item) => <tr key={`${item.dataset}:${item.timeframe ?? "all"}`} className="border-t border-[var(--app-border-soft)]"><td className="px-3 py-2">{item.dataset}</td><td className="px-3 py-2">{item.source}</td><td className="px-3 py-2">{item.timeframe ?? "-"}</td><td className="px-3 py-2 font-mono text-xs">{item.dataDate ?? "-"}</td><td className="px-3 py-2"><StatusPill label={item.completeness} tone={toneForStatus(item.completeness)} /></td><td className="max-w-[220px] truncate px-3 py-2 font-mono text-xs" title={item.contentHash}>{item.contentHash}</td></tr>)}</tbody></table></div></section><InlineMetrics items={[["引擎版本", record.ruleAudit.engineVersion], ["特征版本", record.ruleAudit.featureVersion], ["配置哈希", record.ruleAudit.configHash ?? "-"], ["输入哈希", record.reasoning.inputHash]]} /></div> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="bg-[var(--app-surface)] p-4"><div className="text-xs text-[var(--app-text-muted)]">{label}</div><div className="mt-2 text-lg font-semibold">{value}</div></div>; }
function InlineMetrics({ items }: { items: Array<[string, string]> }) { return <div className="grid grid-cols-2 gap-px overflow-hidden border border-[var(--app-border-soft)] bg-[var(--app-border-soft)] lg:grid-cols-4">{items.map(([label, value]) => <Metric key={label} label={label} value={value} />)}</div>; }
function Row({ label, value }: { label: string; value: string }) { return <tr className="border-t border-[var(--app-border-soft)] first:border-t-0"><th className="w-40 px-3 py-3 font-medium">{label}</th><td className="px-3 py-3 font-mono text-[var(--app-text-muted)]">{value}</td></tr>; }

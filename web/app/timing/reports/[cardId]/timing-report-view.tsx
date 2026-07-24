/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React, { useState } from "react";
import { EvidenceContextCitations } from "~/app/_components/evidence-context-citations";
import { EmptyState, Panel, StatusPill } from "~/app/_components/ui";
import type { WorkflowStageTab } from "~/app/_components/workflow-stage-config";
import { WorkflowStageSwitcher } from "~/app/_components/workflow-stage-switcher";
import { TimingReportChart } from "~/app/timing/reports/[cardId]/timing-report-chart";
import {
  formatTimingActionLabel,
  formatTimingDirectionLabel,
  formatTimingEngineLabel,
  formatTimingMarketStateLabel,
  formatTimingMarketTransitionLabel,
  formatTimingMetricLabel,
  formatTimingMetricValue,
  formatTimingNarrative,
  formatTimingReviewHorizonLabel,
  formatTimingReviewVerdictLabel,
  formatTimingRiskFlagLabel,
} from "~/app/timing/timing-labels";
import type {
  TimingReportPayload,
  TimingReportSeriesPayload,
  TimingSignalEngineKey,
  TimingTimeframe,
} from "~/server/domain/timing/types";

const actionToneMap: Record<
  string,
  "neutral" | "info" | "success" | "warning"
> = {
  WATCH: "neutral",
  PROBE: "warning",
  ADD: "success",
  HOLD: "info",
  TRIM: "warning",
  EXIT: "warning",
};

const marketToneMap: Record<
  string,
  "neutral" | "info" | "success" | "warning"
> = {
  RISK_ON: "success",
  NEUTRAL: "info",
  RISK_OFF: "warning",
};

const evidenceOrder: TimingSignalEngineKey[] = [
  "multiTimeframeAlignment",
  "relativeStrength",
  "volatilityPercentile",
  "liquidityStructure",
  "breakoutFailure",
  "gapVolumeQuality",
];

export type TimingReportStageId =
  | "summary"
  | "evidence"
  | "execution"
  | "review";

export const timingReportStageTabs: Array<
  WorkflowStageTab & { id: TimingReportStageId }
> = [
  {
    id: "summary",
    label: "当前结论",
    summary: "",
  },
  {
    id: "evidence",
    label: "结构证据",
    summary: "",
  },
  {
    id: "execution",
    label: "执行风控",
    summary: "",
  },
  {
    id: "review",
    label: "复盘跟踪",
    summary: "",
  },
];

function formatDate(value?: Date | string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatPct(value?: number | null) {
  if (value === null || value === undefined) {
    return "-";
  }

  return `${value.toFixed(2)}%`;
}

function formatPrice(value?: number | null) {
  if (value === null || value === undefined) {
    return "-";
  }

  return value.toFixed(2);
}

function formatDataStatus(value: "COMPLETE" | "FALLBACK") {
  return value === "COMPLETE" ? "完整" : "降级";
}

function SummaryTab(props: {
  report: TimingReportPayload;
  series?: TimingReportSeriesPayload;
  timeframe: TimingTimeframe;
  onTimeframeChange: (timeframe: TimingTimeframe) => void;
  seriesLoading: boolean;
}) {
  const { report, series, timeframe, onTimeframeChange, seriesLoading } = props;
  const signalContext = report.card.reasoning.signalContext;
  const signalSnapshot = report.card.signalSnapshot;
  const asOfDate = report.card.asOfDate ?? signalSnapshot?.asOfDate ?? "-";
  const kronosForecast = report.card.reasoning.kronosForecast;
  const modelPredictionText = kronosForecast
    ? `模型预测：${formatTimingDirectionLabel(kronosForecast.direction)}，预期收益 ${kronosForecast.expectedReturnPct.toFixed(2)}%，最大回撤 ${kronosForecast.maxDrawdownPct.toFixed(2)}%`
    : "模型预测：暂不可用";

  return (
    <div className="grid gap-6">
      <Panel title="当前结论" surface="inset">
        <div className="grid gap-3 text-sm leading-7 text-[var(--app-text)]">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2">
            <span>
              当前结论：{formatTimingActionLabel(report.card.actionBias)}
            </span>
            <span>报告日期 {asOfDate}</span>
          </div>
          <p>
            综合择时评分 {signalContext.compositeScore.toFixed(1)} / ±100，
            置信度 {report.card.confidence} / 100
          </p>
          <div className="text-sm text-[var(--app-text-muted)]">
            依据{" "}
            <EvidenceContextCitations
              citations={report.card.reasoning.evidenceCitations}
            />
          </div>
          <p>{modelPredictionText}</p>
          <p className="max-w-5xl text-[var(--app-text-muted)]">
            择时评分由多周期一致性、相对强弱、波动率分位、流动性结构、突破失败率、缺口与放量质量六个角度加权计算。
          </p>
        </div>
      </Panel>

      <Panel title="价格结构">
        <TimingReportChart
          bars={series?.bars ?? report.bars}
          chartLevels={series?.chartLevels ?? report.chartLevels}
          forecast={series?.kronosForecast ?? report.kronosForecast}
          timeframe={timeframe}
          onTimeframeChange={onTimeframeChange}
          seriesLoading={seriesLoading}
        />
      </Panel>
    </div>
  );
}

function EvidenceTab(props: {
  report: TimingReportPayload;
  series?: TimingReportSeriesPayload;
  timeframe: TimingTimeframe;
  onTimeframeChange: (timeframe: TimingTimeframe) => void;
  seriesLoading: boolean;
}) {
  const { report, series, timeframe, onTimeframeChange, seriesLoading } = props;

  return (
    <div className="grid gap-6">
      <Panel title="价格结构">
        <TimingReportChart
          bars={series?.bars ?? report.bars}
          chartLevels={series?.chartLevels ?? report.chartLevels}
          forecast={series?.kronosForecast ?? report.kronosForecast}
          timeframe={timeframe}
          onTimeframeChange={onTimeframeChange}
          seriesLoading={seriesLoading}
        />
      </Panel>

      <Panel title="六大择时模型">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {evidenceOrder.map((key) => {
            const evidence = report.evidence[key];

            return (
              <article
                key={evidence.key}
                className="rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-base font-medium text-[var(--app-text)]">
                    {formatTimingEngineLabel(evidence.key)}
                  </div>
                  <StatusPill
                    label={`${formatTimingDirectionLabel(evidence.direction)} · ${evidence.score}`}
                    tone={
                      evidence.direction === "bullish"
                        ? "success"
                        : evidence.direction === "bearish"
                          ? "warning"
                          : "info"
                    }
                  />
                </div>
                <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                  {formatTimingNarrative(evidence.detail)}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <StatusPill
                    label={`置信度 ${(evidence.confidence * 100).toFixed(0)}%`}
                    tone="info"
                  />
                  <StatusPill
                    label={`权重 ${(evidence.weight * 100).toFixed(0)}%`}
                  />
                </div>
                {evidence.warnings.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {evidence.warnings.map((warning) => (
                      <StatusPill
                        key={`${evidence.key}-${warning}`}
                        label={formatTimingRiskFlagLabel(warning)}
                        tone="warning"
                      />
                    ))}
                  </div>
                ) : null}
                <dl className="mt-4 grid gap-2 text-sm text-[var(--app-text-muted)]">
                  {Object.entries(evidence.metrics).map(
                    ([metricKey, value]) => (
                      <div
                        key={`${evidence.key}-${metricKey}`}
                        className="flex items-center justify-between gap-4 rounded-[10px] border border-[var(--app-border-soft)] px-3 py-2"
                      >
                        <dt className="text-[var(--app-text-soft)]">
                          {formatTimingMetricLabel(metricKey)}
                        </dt>
                        <dd className="text-[var(--app-text)]">
                          {formatTimingMetricValue(metricKey, value)}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              </article>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

function ExecutionTab(props: { report: TimingReportPayload }) {
  const plan = props.report.executionPlan;

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <Panel title="执行结论" surface="inset">
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                label={`原始 ${formatTimingActionLabel(plan.decision.rawAction)}`}
                tone="info"
              />
              <StatusPill
                label={`风控后 ${formatTimingActionLabel(plan.decision.finalAction)}`}
                tone={actionToneMap[plan.decision.finalAction] ?? "neutral"}
              />
              <StatusPill
                label={plan.decision.allowed ? "允许执行" : "暂不执行"}
                tone={plan.decision.allowed ? "success" : "warning"}
              />
            </div>
            {plan.decision.downgradeReasons.length > 0 ? (
              <InfoList items={plan.decision.downgradeReasons} />
            ) : (
              <p className="text-sm leading-7 text-[var(--app-text-muted)]">
                当前动作未被组合风控降级。
              </p>
            )}
            {plan.decision.requiredConfirmations.length > 0 ? (
              <div className="grid gap-2">
                <div className="text-xs text-[var(--app-text-soft)]">
                  待确认项
                </div>
                <InfoList items={plan.decision.requiredConfirmations} />
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="仓位预算" surface="inset">
          <MetricGrid
            items={[
              {
                label: "当前仓位",
                value: formatPct(plan.budget.currentWeightPct),
              },
              {
                label: "建议下沿",
                value: formatPct(plan.budget.suggestedMinPct),
              },
              {
                label: "建议上沿",
                value: formatPct(plan.budget.suggestedMaxPct),
              },
              {
                label: "本次变化",
                value: formatPct(plan.budget.targetDeltaPct),
              },
              {
                label: "现金可用",
                value: formatPct(plan.budget.availableCashPct),
              },
              {
                label: "单票上限",
                value: formatPct(plan.budget.maxSingleNamePct),
              },
              {
                label: "组合预算",
                value: formatPct(plan.budget.portfolioRiskBudgetPct),
              },
              {
                label: "数据状态",
                value: formatDataStatus(plan.budget.dataStatus),
              },
            ]}
          />
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Panel title="订单计划">
          <div className="grid gap-4">
            <MetricGrid
              items={[
                {
                  label: "参考价",
                  value: formatPrice(plan.orderPlan.referencePrice),
                },
                {
                  label: "执行下沿",
                  value: formatPrice(plan.orderPlan.entryZoneLow),
                },
                {
                  label: "执行上沿",
                  value: formatPrice(plan.orderPlan.entryZoneHigh),
                },
                {
                  label: "追价上限",
                  value: formatPrice(plan.orderPlan.chaseLimitPrice),
                },
                {
                  label: "失效价",
                  value: formatPrice(plan.orderPlan.stopPrice),
                },
              ]}
            />
            <InfoList items={plan.orderPlan.splitPlan} />
            {plan.orderPlan.notes.length > 0 ? (
              <InfoList items={plan.orderPlan.notes} muted />
            ) : null}
          </div>
        </Panel>

        <Panel title="组合约束" surface="inset">
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                label={formatTimingMarketStateLabel(
                  plan.constraints.marketState,
                )}
                tone={marketToneMap[plan.constraints.marketState] ?? "info"}
              />
              <StatusPill
                label={formatTimingMarketTransitionLabel(
                  plan.constraints.marketTransition,
                )}
                tone="info"
              />
              <StatusPill
                label={formatDataStatus(plan.constraints.dataStatus)}
                tone={
                  plan.constraints.dataStatus === "COMPLETE"
                    ? "success"
                    : "warning"
                }
              />
            </div>
            {plan.constraints.blockedActions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {plan.constraints.blockedActions.map((action) => (
                  <StatusPill
                    key={action}
                    label={`阻断 ${formatTimingActionLabel(action)}`}
                    tone="warning"
                  />
                ))}
              </div>
            ) : null}
            {plan.constraints.riskFlags.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {plan.constraints.riskFlags.map((flag) => (
                  <StatusPill
                    key={flag}
                    label={formatTimingRiskFlagLabel(flag)}
                    tone="warning"
                  />
                ))}
              </div>
            ) : null}
            {plan.constraints.portfolioWarnings.length > 0 ? (
              <InfoList items={plan.constraints.portfolioWarnings} />
            ) : null}
            {plan.constraints.missingContext.length > 0 ? (
              <InfoList
                items={plan.constraints.missingContext.map(
                  (item) => `缺少${item}，当前为降级风控展示`,
                )}
                muted
              />
            ) : null}
            {plan.constraints.blockedActions.length === 0 &&
            plan.constraints.riskFlags.length === 0 &&
            plan.constraints.portfolioWarnings.length === 0 &&
            plan.constraints.missingContext.length === 0 ? (
              <EmptyState title="暂无组合约束" />
            ) : null}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function MetricGrid(props: { items: Array<{ label: string; value: string }> }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {props.items.map((item) => (
        <div
          key={item.label}
          className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] px-3 py-3"
        >
          <dt className="text-xs text-[var(--app-text-soft)]">{item.label}</dt>
          <dd className="mt-1 text-sm font-medium text-[var(--app-text)]">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function InfoList(props: { items: string[]; muted?: boolean }) {
  return (
    <ul className="grid gap-2 text-sm leading-6 text-[var(--app-text-muted)]">
      {props.items.map((item) => (
        <li
          key={item}
          className={
            props.muted
              ? "rounded-[12px] border border-[var(--app-border-soft)] px-3 py-2 text-[var(--app-text-soft)]"
              : "rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] px-3 py-2"
          }
        >
          {formatTimingNarrative(item)}
        </li>
      ))}
    </ul>
  );
}

function ReviewTab(props: { report: TimingReportPayload }) {
  const { report } = props;

  return (
    <Panel title="轻量复盘时间线">
      {report.reviewTimeline.length === 0 ? (
        <EmptyState title="暂无已完成复盘记录" />
      ) : (
        <div className="grid gap-3">
          {report.reviewTimeline.map((item) => (
            <article
              key={item.id}
              className="rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill
                    label={formatTimingReviewHorizonLabel(item.reviewHorizon)}
                    tone="info"
                  />
                  <StatusPill
                    label={formatTimingActionLabel(item.expectedAction)}
                    tone={actionToneMap[item.expectedAction] ?? "neutral"}
                  />
                  {item.verdict ? (
                    <StatusPill
                      label={formatTimingReviewVerdictLabel(item.verdict)}
                      tone={item.verdict === "SUCCESS" ? "success" : "warning"}
                    />
                  ) : null}
                </div>
                <div className="text-xs text-[var(--app-text-soft)]">
                  {formatDate(item.completedAt ?? item.scheduledAt)}
                </div>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <MetricBlock
                  label="区间收益"
                  value={formatPct(item.actualReturnPct)}
                />
                <MetricBlock
                  label="最大顺行"
                  value={formatPct(item.maxFavorableExcursionPct)}
                />
                <MetricBlock
                  label="最大逆行"
                  value={formatPct(item.maxAdverseExcursionPct)}
                />
              </div>
              {item.reviewSummary ? (
                <p className="mt-3 text-sm leading-6 text-[var(--app-text-muted)]">
                  {item.reviewSummary}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </Panel>
  );
}

function MetricBlock(props: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--app-text-soft)]">{props.label}</div>
      <div className="mt-1 text-base text-[var(--app-text)]">{props.value}</div>
    </div>
  );
}

export function TimingReportPanels(props: {
  report: TimingReportPayload;
  series?: TimingReportSeriesPayload;
  timeframe?: TimingTimeframe;
  onTimeframeChange?: (timeframe: TimingTimeframe) => void;
  seriesLoading?: boolean;
  activeTabId?: TimingReportStageId;
  onTabChange?: (tabId: TimingReportStageId) => void;
}) {
  const activeTabId =
    props.activeTabId ?? timingReportStageTabs[0]?.id ?? "summary";

  return (
    <WorkflowStageSwitcher
      tabs={timingReportStageTabs}
      activeTabId={activeTabId}
      onChange={(tabId) => props.onTabChange?.(tabId as TimingReportStageId)}
      panels={{
        summary: (
          <SummaryTab
            report={props.report}
            series={props.series}
            timeframe={props.timeframe ?? "DAILY"}
            onTimeframeChange={props.onTimeframeChange ?? (() => undefined)}
            seriesLoading={props.seriesLoading ?? false}
          />
        ),
        evidence: (
          <EvidenceTab
            report={props.report}
            series={props.series}
            timeframe={props.timeframe ?? "DAILY"}
            onTimeframeChange={props.onTimeframeChange ?? (() => undefined)}
            seriesLoading={props.seriesLoading ?? false}
          />
        ),
        execution: <ExecutionTab report={props.report} />,
        review: <ReviewTab report={props.report} />,
      }}
    />
  );
}

export function TimingReportView(props: {
  report: TimingReportPayload;
  series?: TimingReportSeriesPayload;
  timeframe?: TimingTimeframe;
  onTimeframeChange?: (timeframe: TimingTimeframe) => void;
  seriesLoading?: boolean;
}) {
  const [activeTabId, setActiveTabId] =
    useState<TimingReportStageId>("summary");

  return (
    <div className="grid gap-6">
      <TimingReportPanels
        report={props.report}
        series={props.series}
        timeframe={props.timeframe}
        onTimeframeChange={props.onTimeframeChange}
        seriesLoading={props.seriesLoading}
        activeTabId={activeTabId}
        onTabChange={setActiveTabId}
      />
    </div>
  );
}

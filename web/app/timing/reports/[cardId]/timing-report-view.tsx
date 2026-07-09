/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React, { useState } from "react";
import { EmptyState, Panel, StatusPill } from "~/app/_components/ui";
import type { WorkflowStageTab } from "~/app/_components/workflow-stage-config";
import { WorkflowStageSwitcher } from "~/app/_components/workflow-stage-switcher";
import { TimingReportChart } from "~/app/timing/reports/[cardId]/timing-report-chart";
import {
  formatTimingActionLabel,
  formatTimingBreadthTrendLabel,
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
  formatTimingVolatilityTrendLabel,
} from "~/app/timing/timing-labels";
import type {
  TimingExecutionCondition,
  TimingReportPayload,
  TimingSignalEngineKey,
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

const conditionStatusLabelMap: Record<string, string> = {
  TRIGGERED: "已触发",
  NEAR: "接近",
  PENDING: "待确认",
  INVALIDATED: "已失效",
};

const conditionStatusToneMap: Record<
  string,
  "neutral" | "info" | "success" | "warning"
> = {
  TRIGGERED: "success",
  NEAR: "warning",
  PENDING: "neutral",
  INVALIDATED: "warning",
};

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

function formatDate(value?: Date | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function formatPct(value?: number | null) {
  if (value === null || value === undefined) {
    return "-";
  }

  return `${value.toFixed(2)}%`;
}

function _BackgroundStrip(props: { report: TimingReportPayload }) {
  const { report } = props;
  const items = [
    {
      label: "股票名称/代码",
      value: `${report.card.stockName} / ${report.card.stockCode}`,
    },
    {
      label: "报告日期",
      value:
        report.card.asOfDate ?? report.card.signalSnapshot?.asOfDate ?? "-",
    },
    {
      label: "操作倾向",
      value: formatTimingActionLabel(report.card.actionBias),
    },
    {
      label: "置信度",
      value: String(report.card.confidence),
    },
    {
      label: "市场状态",
      value: formatTimingMarketStateLabel(report.marketContext.state),
    },
  ];

  return (
    <Panel surface="inset" density="compact">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {items.map((item) => (
          <div
            key={item.label}
            className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-bg-floating)] px-4 py-3"
          >
            <div className="text-xs text-[var(--app-text-soft)]">
              {item.label}
            </div>
            <div className="mt-2 text-sm leading-6 text-[var(--app-text)]">
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SummaryTab(props: { report: TimingReportPayload }) {
  const { report } = props;
  const signalContext = report.card.reasoning.signalContext;
  const signalSnapshot = report.card.signalSnapshot;
  const asOfDate = report.card.asOfDate ?? signalSnapshot?.asOfDate ?? "-";
  const kronosForecast = report.card.reasoning.kronosForecast;
  const modelPredictionText = kronosForecast
    ? `模型预测：${formatTimingDirectionLabel(kronosForecast.direction)}, 预期收益 ${kronosForecast.expectedReturnPct.toFixed(2)}%, 最大回撤 ${kronosForecast.maxDrawdownPct.toFixed(2)}%`
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
            综合择时评分 {signalContext.compositeScore.toFixed(1)} /
            ±100，置信度 {report.card.confidence} / 100
          </p>
          <p>{modelPredictionText}</p>
          <p className="max-w-5xl text-[var(--app-text-muted)]">
            注：择时评分计算公式从多周期一致性、相对强弱、波动率分位、流动性/换手结构、突破失败率、缺口与放量质量六个角度进行加权评分。具体计算公式为：综合分
            = Σ(单角度得分 × 该角度权重 × 该角度证据强度) / Σ(该角度权重 ×
            该角度证据强度)。综合分 &gt; 20 认为偏多；综合分 &lt; -20
            认为偏空；其它得分认为中性。
          </p>
        </div>
      </Panel>

      <Panel title="价格结构">
        <TimingReportChart
          bars={report.bars}
          chartLevels={report.chartLevels}
          forecast={report.kronosForecast}
        />
      </Panel>
    </div>
  );
}

function EvidenceTab(props: { report: TimingReportPayload }) {
  const { report } = props;

  return (
    <div className="grid gap-6">
      <Panel title="价格结构">
        <TimingReportChart
          bars={report.bars}
          chartLevels={report.chartLevels}
          forecast={report.kronosForecast}
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
  const { report } = props;
  const signalContext = report.card.reasoning.signalContext;
  const triggerConditions = signalContext.triggerConditions ?? [];
  const invalidationConditions = signalContext.invalidationConditions ?? [];

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="触发条件" surface="inset">
          {triggerConditions.length > 0 ? (
            <ConditionList conditions={triggerConditions} />
          ) : signalContext.triggerNotes.length > 0 ? (
            <ul className="grid gap-2 text-sm leading-6 text-[var(--app-text-muted)]">
              {signalContext.triggerNotes.map((item) => (
                <li
                  key={item}
                  className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] px-3 py-2"
                >
                  {formatTimingNarrative(item)}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="暂无触发条件" />
          )}
        </Panel>

        <Panel title="失效条件" surface="inset">
          {invalidationConditions.length > 0 ? (
            <ConditionList conditions={invalidationConditions} />
          ) : signalContext.invalidationNotes.length > 0 ? (
            <ul className="grid gap-2 text-sm leading-6 text-[var(--app-text-muted)]">
              {signalContext.invalidationNotes.map((item) => (
                <li
                  key={item}
                  className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] px-3 py-2"
                >
                  {formatTimingNarrative(item)}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="暂无失效条件" />
          )}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Panel title="市场环境">
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                label={formatTimingMarketStateLabel(report.marketContext.state)}
                tone={marketToneMap[report.marketContext.state] ?? "info"}
              />
              <StatusPill
                label={formatTimingMarketTransitionLabel(
                  report.marketContext.transition,
                )}
                tone="info"
              />
              <StatusPill
                label={`持续 ${report.marketContext.persistenceDays} 天`}
              />
              <StatusPill
                label={formatTimingBreadthTrendLabel(
                  report.marketContext.breadthTrend,
                )}
              />
              <StatusPill
                label={formatTimingVolatilityTrendLabel(
                  report.marketContext.volatilityTrend,
                )}
              />
            </div>
            <p className="text-sm leading-7 text-[var(--app-text-muted)]">
              {report.marketContext.summary}
            </p>
            <ul className="grid gap-2 text-sm leading-6 text-[var(--app-text-muted)]">
              {report.marketContext.constraints.map((item) => (
                <li
                  key={item}
                  className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] px-3 py-2"
                >
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel title="风险标签" surface="inset">
          {report.card.riskFlags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {report.card.riskFlags.map((flag) => (
                <StatusPill
                  key={flag}
                  label={formatTimingRiskFlagLabel(flag)}
                  tone="warning"
                />
              ))}
            </div>
          ) : (
            <EmptyState title="暂无风险标签" />
          )}
        </Panel>
      </div>
    </div>
  );
}

function ConditionList(props: { conditions: TimingExecutionCondition[] }) {
  return (
    <div className="grid gap-3">
      {props.conditions.map((condition) => (
        <article
          key={condition.id}
          className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] px-3 py-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-[var(--app-text)]">
              {condition.label}
            </span>
            <StatusPill
              label={
                conditionStatusLabelMap[condition.status] ?? condition.status
              }
              tone={conditionStatusToneMap[condition.status] ?? "neutral"}
            />
            <StatusPill label={condition.severity} tone="info" />
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
            {formatTimingNarrative(condition.explanation)}
          </p>
          <dl className="mt-2 grid gap-2 text-xs text-[var(--app-text-soft)] sm:grid-cols-3">
            <div>
              <dt>指标</dt>
              <dd className="mt-1 text-[var(--app-text-muted)]">
                {condition.metric}
              </dd>
            </div>
            <div>
              <dt>阈值</dt>
              <dd className="mt-1 text-[var(--app-text-muted)]">
                {condition.operator} {String(condition.threshold)}
                {condition.unit ?? ""}
              </dd>
            </div>
            <div>
              <dt>当前</dt>
              <dd className="mt-1 text-[var(--app-text-muted)]">
                {condition.actual === undefined || condition.actual === null
                  ? "-"
                  : `${condition.actual}${condition.unit ?? ""}`}
              </dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
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
                <div>
                  <div className="text-xs text-[var(--app-text-soft)]">
                    区间收益
                  </div>
                  <div className="mt-1 text-base text-[var(--app-text)]">
                    {formatPct(item.actualReturnPct)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[var(--app-text-soft)]">
                    最大顺行
                  </div>
                  <div className="mt-1 text-base text-[var(--app-text)]">
                    {formatPct(item.maxFavorableExcursionPct)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[var(--app-text-soft)]">
                    最大逆行
                  </div>
                  <div className="mt-1 text-base text-[var(--app-text)]">
                    {formatPct(item.maxAdverseExcursionPct)}
                  </div>
                </div>
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

export function TimingReportPanels(props: {
  report: TimingReportPayload;
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
        summary: <SummaryTab report={props.report} />,
        evidence: <EvidenceTab report={props.report} />,
        execution: <ExecutionTab report={props.report} />,
        review: <ReviewTab report={props.report} />,
      }}
    />
  );
}

export function TimingReportView(props: { report: TimingReportPayload }) {
  const [activeTabId, setActiveTabId] =
    useState<TimingReportStageId>("summary");

  return (
    <div className="grid gap-6">
      <TimingReportPanels
        report={props.report}
        activeTabId={activeTabId}
        onTabChange={setActiveTabId}
      />
    </div>
  );
}

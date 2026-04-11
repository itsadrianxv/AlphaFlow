/* biome-ignore lint/correctness/noUnusedImports: React is required by the current JSX transform in tests. */
import React from "react";
import { EmptyState, SectionCard, StatusPill } from "~/app/_components/ui";
import { TimingReportChart } from "~/app/timing/reports/[cardId]/timing-report-chart";
import type {
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

const actionLabelMap: Record<string, string> = {
  WATCH: "观察",
  PROBE: "试仓",
  ADD: "加仓",
  HOLD: "持有",
  TRIM: "减仓",
  EXIT: "退出",
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

function formatMetricValue(
  value: string | number | boolean | null | undefined,
) {
  if (value === null || value === undefined) {
    return "-";
  }

  return typeof value === "number" ? value.toString() : String(value);
}

export function TimingReportView(props: { report: TimingReportPayload }) {
  const { report } = props;
  const signalContext = report.card.reasoning.signalContext;
  const asOfDate = report.card.asOfDate ?? report.card.signalSnapshot?.asOfDate;

  return (
    <div className="grid gap-6">
      <SectionCard title="结论摘要" surface="inset">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                label={
                  actionLabelMap[report.card.actionBias] ??
                  report.card.actionBias
                }
                tone={actionToneMap[report.card.actionBias] ?? "neutral"}
              />
              <StatusPill
                label={`置信度 ${report.card.confidence}`}
                tone="info"
              />
              <StatusPill label={`报告日期 ${asOfDate ?? "-"}`} />
            </div>
            <p className="max-w-4xl text-base leading-7 text-[var(--app-text)]">
              {report.card.summary}
            </p>
            <p className="max-w-4xl text-sm leading-7 text-[var(--app-text-muted)]">
              {report.card.reasoning.actionRationale}
            </p>
          </div>
          <div className="grid gap-3 rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-4">
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <div className="text-xs text-[var(--app-text-soft)]">
                  收盘价
                </div>
                <div className="mt-2 text-2xl text-[var(--app-text)]">
                  {report.card.signalSnapshot?.indicators.close.toFixed(2) ??
                    "-"}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--app-text-soft)]">RSI</div>
                <div className="mt-2 text-2xl text-[var(--app-text)]">
                  {report.card.signalSnapshot?.indicators.rsi.value.toFixed(
                    1,
                  ) ?? "-"}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--app-text-soft)]">
                  量比 20D
                </div>
                <div className="mt-2 text-2xl text-[var(--app-text)]">
                  {report.card.signalSnapshot?.indicators.volumeRatio20.toFixed(
                    2,
                  ) ?? "-"}
                </div>
              </div>
            </div>
            <p className="text-sm leading-6 text-[var(--app-text-muted)]">
              {signalContext.summary}
            </p>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="价格结构"
        description="主图默认冻结在信号当日的日线视角，先用结构和量能建立信任，再看其他证据。"
      >
        <TimingReportChart
          bars={report.bars}
          chartLevels={report.chartLevels}
        />
      </SectionCard>

      <SectionCard title="为什么当前偏这个方向" surface="inset">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.9fr)]">
          <div className="grid gap-3">
            <p className="text-sm leading-7 text-[var(--app-text)]">
              {signalContext.explanation}
            </p>
            <p className="text-sm leading-7 text-[var(--app-text-muted)]">
              {report.card.reasoning.actionRationale}
            </p>
          </div>
          <div className="grid gap-3 rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-4">
            <div className="text-xs text-[var(--app-text-soft)]">核心结构</div>
            <div className="text-sm leading-6 text-[var(--app-text-muted)]">
              EMA5{" "}
              {report.card.signalSnapshot?.indicators.ema5.toFixed(2) ?? "-"} ·
              EMA20{" "}
              {report.card.signalSnapshot?.indicators.ema20.toFixed(2) ?? "-"} ·
              EMA60{" "}
              {report.card.signalSnapshot?.indicators.ema60.toFixed(2) ?? "-"}
            </div>
            <div className="text-sm leading-6 text-[var(--app-text-muted)]">
              MACD 柱值{" "}
              {report.card.signalSnapshot?.indicators.macd.histogram.toFixed(
                2,
              ) ?? "-"}{" "}
              · OBV 斜率{" "}
              {report.card.signalSnapshot?.indicators.obv.slope.toFixed(2) ??
                "-"}
            </div>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="六大证据引擎">
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
                    {evidence.label}
                  </div>
                  <StatusPill
                    label={`${evidence.direction} · ${evidence.score}`}
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
                  {evidence.detail}
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
                <dl className="mt-4 grid gap-2 text-sm text-[var(--app-text-muted)]">
                  {Object.entries(evidence.metrics).map(
                    ([metricKey, value]) => (
                      <div
                        key={`${evidence.key}-${metricKey}`}
                        className="flex items-center justify-between gap-4 rounded-[10px] border border-[var(--app-border-soft)] px-3 py-2"
                      >
                        <dt className="text-[var(--app-text-soft)]">
                          {metricKey}
                        </dt>
                        <dd className="text-[var(--app-text)]">
                          {formatMetricValue(value)}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              </article>
            );
          })}
        </div>
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="触发条件" surface="inset">
          {signalContext.triggerNotes.length > 0 ? (
            <ul className="grid gap-2 text-sm leading-6 text-[var(--app-text-muted)]">
              {signalContext.triggerNotes.map((item) => (
                <li
                  key={item}
                  className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] px-3 py-2"
                >
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="暂无触发条件" />
          )}
        </SectionCard>

        <SectionCard title="失效条件" surface="inset">
          {signalContext.invalidationNotes.length > 0 ? (
            <ul className="grid gap-2 text-sm leading-6 text-[var(--app-text-muted)]">
              {signalContext.invalidationNotes.map((item) => (
                <li
                  key={item}
                  className="rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] px-3 py-2"
                >
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="暂无失效条件" />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <SectionCard title="市场环境">
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                label={report.marketContext.state}
                tone={marketToneMap[report.marketContext.state] ?? "info"}
              />
              <StatusPill label={report.marketContext.transition} tone="info" />
              <StatusPill
                label={`持续 ${report.marketContext.persistenceDays} 天`}
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
        </SectionCard>

        <SectionCard title="风险标签" surface="inset">
          {report.card.riskFlags.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {report.card.riskFlags.map((flag) => (
                <StatusPill key={flag} label={flag} tone="warning" />
              ))}
            </div>
          ) : (
            <EmptyState title="暂无风险标签" />
          )}
        </SectionCard>
      </div>

      <SectionCard title="轻量复盘时间线">
        {report.reviewTimeline.length === 0 ? (
          <EmptyState
            title="暂无已完成复盘记录"
            description="这只股票的历史证明会在后续复盘写回后出现在这里。"
          />
        ) : (
          <div className="grid gap-3">
            {report.reviewTimeline.map((item) => (
              <article
                key={item.id}
                className="rounded-[14px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill label={item.reviewHorizon} tone="info" />
                    <StatusPill
                      label={
                        actionLabelMap[item.expectedAction] ??
                        item.expectedAction
                      }
                      tone={actionToneMap[item.expectedAction] ?? "neutral"}
                    />
                    {item.verdict ? (
                      <StatusPill
                        label={item.verdict}
                        tone={
                          item.verdict === "SUCCESS" ? "success" : "warning"
                        }
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
      </SectionCard>
    </div>
  );
}

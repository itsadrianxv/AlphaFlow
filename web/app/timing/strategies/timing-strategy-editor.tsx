"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  EmptyState,
  InlineNotice,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { createTimingPresetConfigV2 } from "~/server/domain/timing/strategy-v2";
import type {
  TimingHorizonTemplate,
  TimingPresetConfigV2,
  TimingRuleDefinition,
  TimingSetupType,
  TimingTimeframe,
} from "~/server/domain/timing/types";
import { api } from "~/trpc/react";
type ViewKey = "intent" | "timeframe" | "rules" | "risk" | "publish";

const views: Array<{ key: ViewKey; label: string }> = [
  { key: "intent", label: "交易意图" },
  { key: "timeframe", label: "周期结构" },
  { key: "rules", label: "规则配置" },
  { key: "risk", label: "风控复盘" },
  { key: "publish", label: "回放发布" },
];
const setupLabels: Record<TimingSetupType, string> = {
  TREND_CONTINUATION: "趋势延续",
  BREAKOUT: "突破",
  PULLBACK: "回撤承接",
  OVERSOLD_REVERSAL: "超跌反转",
};
const timeframeLabels: Record<TimingTimeframe, string> = {
  MONTHLY: "月线",
  WEEKLY: "周线",
  DAILY: "日线",
  MINUTE_60: "60分钟",
  MINUTE_30: "30分钟",
  MINUTE_15: "15分钟",
  MINUTE_1: "1分钟",
};
const statusLabels: Record<string, string> = {
  DRAFT: "草稿",
  VALIDATING: "验证中",
  PUBLISHED: "已发布",
  ARCHIVED: "已归档",
};

function parseThreshold(
  value: string,
  previous: TimingRuleDefinition["threshold"],
) {
  if (typeof previous === "boolean") return value === "true";
  if (typeof previous === "number") return Number(value);
  return value;
}

function isQualityPassed(value: unknown) {
  return Boolean(
    value &&
      typeof value === "object" &&
      "gatePassed" in value &&
      value.gatePassed === true,
  );
}

function metric(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) return "-";
  return String((value as Record<string, unknown>)[key] ?? "-");
}

export function TimingStrategyEditor() {
  const utils = api.useUtils();
  const [view, setView] = useState<ViewKey>("intent");
  const [strategyId, setStrategyId] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [watchListId, setWatchListId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState<TimingPresetConfigV2 | null>(null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [createName, setCreateName] = useState("波段择时策略");
  const [createSetup, setCreateSetup] =
    useState<TimingSetupType>("TREND_CONTINUATION");
  const [createTemplate, setCreateTemplate] =
    useState<TimingHorizonTemplate>("SWING");

  const strategies = api.timing.listTimingStrategies.useQuery();
  const watchlists = api.watchlist.list.useQuery({
    limit: 50,
    offset: 0,
    sortBy: "updatedAt",
    sortDirection: "desc",
  });
  const selectedStrategy = strategies.data?.find(
    (item) => item.id === strategyId,
  );
  const selectedRevision = selectedStrategy?.revisions.find(
    (item) => item.id === revisionId,
  );
  const backtests = api.timing.listTimingBacktests.useQuery(
    { revisionId },
    { enabled: Boolean(revisionId) },
  );

  useEffect(() => {
    const first = strategies.data?.[0];
    if (!strategyId && first) setStrategyId(first.id);
  }, [strategies.data, strategyId]);
  useEffect(() => {
    if (!selectedStrategy) return;
    const preferred =
      selectedStrategy.revisions.find((item) => item.status === "DRAFT") ??
      selectedStrategy.activeRevision ??
      selectedStrategy.revisions[0];
    if (
      !selectedStrategy.revisions.some((item) => item.id === revisionId) &&
      preferred
    )
      setRevisionId(preferred.id);
  }, [revisionId, selectedStrategy]);
  useEffect(() => {
    if (!selectedRevision || dirty) return;
    setName(selectedStrategy?.name ?? "");
    setDescription(selectedStrategy?.description ?? "");
    setConfig(structuredClone(selectedRevision.config));
  }, [dirty, selectedRevision, selectedStrategy]);
  useEffect(() => {
    if (!watchListId && watchlists.data?.[0]?.id)
      setWatchListId(watchlists.data[0].id);
  }, [watchListId, watchlists.data]);

  const create = api.timing.createTimingStrategy.useMutation({
    onSuccess: async (strategy) => {
      setNotice("策略草稿已创建。");
      setStrategyId(strategy.id);
      setRevisionId(strategy.revisions[0]?.id ?? "");
      await utils.timing.listTimingStrategies.invalidate();
    },
  });
  const save = api.timing.updateTimingStrategyDraft.useMutation({
    onSuccess: async () => {
      setDirty(false);
      setNotice("草稿已保存，旧回放结果不会用于新配置发布。");
      await utils.timing.listTimingStrategies.invalidate();
    },
  });
  const clone = api.timing.cloneTimingStrategyRevision.useMutation({
    onSuccess: async (revision) => {
      setRevisionId(revision.id);
      setDirty(false);
      setNotice("已复制为新草稿。");
      await utils.timing.listTimingStrategies.invalidate();
    },
  });
  const runBacktest = api.timing.runTimingBacktest.useMutation({
    onSuccess: async () => {
      setNotice("冻结证据回放已完成，请检查质量门禁与偏差提示。");
      await Promise.all([
        utils.timing.listTimingStrategies.invalidate(),
        utils.timing.listTimingBacktests.invalidate(),
      ]);
    },
  });
  const publish = api.timing.publishTimingStrategyRevision.useMutation({
    onSuccess: async () => {
      setNotice("策略修订已发布，日常运行台可以引用该不可变版本。");
      await utils.timing.listTimingStrategies.invalidate();
    },
  });

  function patchConfig(patch: Partial<TimingPresetConfigV2>) {
    setConfig((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  }

  function replaceTemplate(template: TimingHorizonTemplate) {
    if (!config) return;
    const next = createTimingPresetConfigV2(config.setup, template);
    patchConfig({
      timeframePlan: next.timeframePlan,
      reviewTradingDays: next.reviewTradingDays,
    });
  }

  function patchRule(
    groupIndex: number,
    ruleIndex: number,
    patch: Partial<TimingRuleDefinition>,
  ) {
    if (!config) return;
    const ruleGroups = structuredClone(config.ruleGroups);
    const rule = ruleGroups[groupIndex]?.rules[ruleIndex];
    if (!rule) return;
    const group = ruleGroups[groupIndex];
    if (!group) return;
    group.rules[ruleIndex] = { ...rule, ...patch };
    patchConfig({ ruleGroups });
  }

  const latestBacktest = backtests.data?.[0];
  const canEdit = selectedRevision?.status === "DRAFT";
  const canPublish =
    selectedRevision?.status === "VALIDATING" &&
    isQualityPassed(latestBacktest?.qualityMetrics);
  const error =
    create.error ??
    save.error ??
    clone.error ??
    runBacktest.error ??
    publish.error;

  return (
    <WorkspaceShell
      section="timing"
      title="择时策略编辑器"
      titleSize="compact"
      contentWidth="wide"
      actions={
        <Link href="/timing" className="app-button">
          返回运行台
        </Link>
      }
    >
      {notice ? <InlineNotice tone="success" description={notice} /> : null}
      {error ? (
        <InlineNotice tone="danger" description={error.message} />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="border border-[var(--app-border-soft)] bg-[var(--app-surface)]">
          <div className="border-b border-[var(--app-border-soft)] p-3">
            <select
              className="app-input w-full"
              value={strategyId}
              onChange={(event) => {
                setStrategyId(event.target.value);
                setRevisionId("");
                setDirty(false);
              }}
            >
              <option value="">选择策略</option>
              {(strategies.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1 p-2">
            {(selectedStrategy?.revisions ?? []).map((revision) => (
              <button
                key={revision.id}
                type="button"
                onClick={() => {
                  setRevisionId(revision.id);
                  setDirty(false);
                }}
                className={`flex items-center justify-between border px-3 py-2 text-left text-sm ${revision.id === revisionId ? "border-[var(--app-border-strong)] bg-[var(--app-bg-inset)]" : "border-transparent text-[var(--app-text-muted)]"}`}
              >
                <span>修订 v{revision.revisionNumber}</span>
                <span className="text-xs">{statusLabels[revision.status]}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-[var(--app-border-soft)] p-3">
            <div className="grid gap-2">
              <input
                className="app-input"
                value={createName}
                onChange={(event) => setCreateName(event.target.value)}
                aria-label="新策略名称"
              />
              <select
                className="app-input"
                value={createSetup}
                onChange={(event) =>
                  setCreateSetup(event.target.value as TimingSetupType)
                }
              >
                {Object.entries(setupLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                className="app-input"
                value={createTemplate}
                onChange={(event) =>
                  setCreateTemplate(event.target.value as TimingHorizonTemplate)
                }
              >
                <option value="SHORT_SWING">短波段</option>
                <option value="SWING">波段</option>
                <option value="MEDIUM_TERM">中期</option>
              </select>
              <button
                type="button"
                className="app-button"
                onClick={() =>
                  create.mutate({
                    name: createName,
                    setup: createSetup,
                    timeframeTemplate: createTemplate,
                  })
                }
              >
                新建策略
              </button>
            </div>
          </div>
        </aside>

        <main className="min-w-0 border border-[var(--app-border-soft)] bg-[var(--app-surface)]">
          {!selectedRevision || !config ? (
            <div className="p-4">
              <EmptyState title="选择或创建策略修订" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--app-border-soft)] px-4 py-3">
                <nav className="flex flex-wrap gap-5" aria-label="策略配置视图">
                  {views.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setView(item.key)}
                      className={`border-b-2 py-2 text-sm ${view === item.key ? "border-[var(--app-brand)] text-[var(--app-text-strong)]" : "border-transparent text-[var(--app-text-muted)]"}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </nav>
                <div className="flex items-center gap-2">
                  <StatusPill
                    label={statusLabels[selectedRevision.status]}
                    tone={
                      selectedRevision.status === "PUBLISHED"
                        ? "success"
                        : selectedRevision.status === "VALIDATING"
                          ? "warning"
                          : "neutral"
                    }
                  />
                  {dirty ? (
                    <span className="text-xs text-[var(--app-warning)]">
                      未保存
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="p-4 sm:p-5">
                {view === "intent" ? (
                  <div className="grid gap-5 lg:grid-cols-2">
                    <label className="grid gap-2 text-sm">
                      <span>策略名称</span>
                      <input
                        disabled={!canEdit}
                        className="app-input"
                        value={name}
                        onChange={(event) => {
                          setName(event.target.value);
                          setDirty(true);
                        }}
                      />
                    </label>
                    <label className="grid gap-2 text-sm">
                      <span>交易范式</span>
                      <select
                        disabled={!canEdit}
                        className="app-input"
                        value={config.setup}
                        onChange={(event) => {
                          const next = createTimingPresetConfigV2(
                            event.target.value as TimingSetupType,
                            config.timeframePlan.template,
                          );
                          setConfig(next);
                          setDirty(true);
                        }}
                      >
                        {Object.entries(setupLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-2 text-sm lg:col-span-2">
                      <span>说明</span>
                      <textarea
                        disabled={!canEdit}
                        className="app-input min-h-24"
                        value={description}
                        onChange={(event) => {
                          setDescription(event.target.value);
                          setDirty(true);
                        }}
                      />
                    </label>
                    <div className="text-sm text-[var(--app-text-muted)]">
                      风险偏好：均衡。动作不使用综合分或置信度，按主判据、确认法定数、否决项和市场门控确定。
                    </div>
                  </div>
                ) : null}

                {view === "timeframe" ? (
                  <div className="grid gap-5">
                    <label className="grid max-w-sm gap-2 text-sm">
                      <span>周期模板</span>
                      <select
                        disabled={!canEdit}
                        className="app-input"
                        value={config.timeframePlan.template}
                        onChange={(event) =>
                          replaceTemplate(
                            event.target.value as TimingHorizonTemplate,
                          )
                        }
                      >
                        <option value="SHORT_SWING">短波段</option>
                        <option value="SWING">波段</option>
                        <option value="MEDIUM_TERM">中期</option>
                      </select>
                    </label>
                    <div className="overflow-x-auto">
                      <table className="app-table min-w-full">
                        <thead>
                          <tr>
                            <th>上位环境</th>
                            <th>决策周期</th>
                            <th>执行周期</th>
                            <th>缺失回退</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>
                              {config.timeframePlan.contextTimeframes
                                .map((item) => timeframeLabels[item])
                                .join("、")}
                            </td>
                            <td>
                              {
                                timeframeLabels[
                                  config.timeframePlan.decisionTimeframe
                                ]
                              }
                            </td>
                            <td>
                              {
                                timeframeLabels[
                                  config.timeframePlan.executionTimeframe
                                ]
                              }
                            </td>
                            <td>
                              {config.timeframePlan.fallbackExecutionTimeframe
                                ? timeframeLabels[
                                    config.timeframePlan
                                      .fallbackExecutionTimeframe
                                  ]
                                : "不回退"}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <InlineNotice
                      tone="info"
                      description="未收盘周线和月线只保留为观察证据，不参与正式规则判断。"
                    />
                  </div>
                ) : null}

                {view === "rules" ? (
                  <div className="grid gap-6">
                    {config.ruleGroups.map((group, groupIndex) => (
                      <section
                        key={group.role}
                        className="border border-[var(--app-border-soft)]"
                      >
                        <div className="flex items-center justify-between border-b border-[var(--app-border-soft)] px-3 py-2">
                          <h3 className="text-sm font-medium">{group.role}</h3>
                          {group.role !== "VETO" ? (
                            <label className="flex items-center gap-2 text-xs">
                              至少满足
                              <input
                                disabled={!canEdit}
                                type="number"
                                min={1}
                                max={group.rules.length}
                                className="app-input w-16"
                                value={group.minSatisfied}
                                onChange={(event) => {
                                  const groups = structuredClone(
                                    config.ruleGroups,
                                  );
                                  const target = groups[groupIndex];
                                  if (!target) return;
                                  target.minSatisfied = Number(
                                    event.target.value,
                                  );
                                  patchConfig({ ruleGroups: groups });
                                }}
                              />
                            </label>
                          ) : null}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="app-table min-w-[980px]">
                            <thead>
                              <tr>
                                <th>启用</th>
                                <th>规则 / 指标</th>
                                <th>周期</th>
                                <th>判断</th>
                                <th>阈值</th>
                                <th>连续根数</th>
                                <th>必选</th>
                                <th>否决级别</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.rules.map((rule, ruleIndex) => (
                                <tr key={rule.id}>
                                  <td>
                                    <input
                                      disabled={!canEdit}
                                      type="checkbox"
                                      checked={rule.enabled}
                                      onChange={(event) =>
                                        patchRule(groupIndex, ruleIndex, {
                                          enabled: event.target.checked,
                                        })
                                      }
                                    />
                                  </td>
                                  <td>
                                    <div className="font-medium text-[var(--app-text-strong)]">
                                      {rule.name}
                                    </div>
                                    <div className="text-xs text-[var(--app-text-subtle)]">
                                      {rule.indicatorId}
                                    </div>
                                  </td>
                                  <td>
                                    <select
                                      disabled={!canEdit}
                                      className="app-input min-w-28"
                                      value={rule.timeframe}
                                      onChange={(event) =>
                                        patchRule(groupIndex, ruleIndex, {
                                          timeframe: event.target
                                            .value as TimingTimeframe,
                                        })
                                      }
                                    >
                                      {Object.entries(timeframeLabels).map(
                                        ([value, label]) => (
                                          <option key={value} value={value}>
                                            {label}
                                          </option>
                                        ),
                                      )}
                                    </select>
                                  </td>
                                  <td>
                                    <select
                                      disabled={!canEdit}
                                      className="app-input"
                                      value={rule.operator}
                                      onChange={(event) =>
                                        patchRule(groupIndex, ruleIndex, {
                                          operator: event.target
                                            .value as TimingRuleDefinition["operator"],
                                        })
                                      }
                                    >
                                      {[
                                        ">=",
                                        ">",
                                        "<=",
                                        "<",
                                        "==",
                                        "crosses_above",
                                        "crosses_below",
                                      ].map((value) => (
                                        <option key={value}>{value}</option>
                                      ))}
                                    </select>
                                  </td>
                                  <td>
                                    {typeof rule.threshold === "boolean" ? (
                                      <select
                                        disabled={!canEdit}
                                        className="app-input"
                                        value={String(rule.threshold)}
                                        onChange={(event) =>
                                          patchRule(groupIndex, ruleIndex, {
                                            threshold: parseThreshold(
                                              event.target.value,
                                              rule.threshold,
                                            ),
                                          })
                                        }
                                      >
                                        <option value="true">是</option>
                                        <option value="false">否</option>
                                      </select>
                                    ) : (
                                      <input
                                        disabled={!canEdit}
                                        className="app-input w-24"
                                        value={String(rule.threshold)}
                                        onChange={(event) =>
                                          patchRule(groupIndex, ruleIndex, {
                                            threshold: parseThreshold(
                                              event.target.value,
                                              rule.threshold,
                                            ),
                                          })
                                        }
                                      />
                                    )}
                                  </td>
                                  <td>
                                    <input
                                      disabled={!canEdit}
                                      type="number"
                                      min={1}
                                      max={20}
                                      className="app-input w-16"
                                      value={rule.confirmationBars}
                                      onChange={(event) =>
                                        patchRule(groupIndex, ruleIndex, {
                                          confirmationBars: Number(
                                            event.target.value,
                                          ),
                                        })
                                      }
                                    />
                                  </td>
                                  <td>
                                    <input
                                      disabled={!canEdit}
                                      type="checkbox"
                                      checked={rule.required}
                                      onChange={(event) =>
                                        patchRule(groupIndex, ruleIndex, {
                                          required: event.target.checked,
                                        })
                                      }
                                    />
                                  </td>
                                  <td>
                                    {rule.role === "VETO" ? (
                                      <select
                                        disabled={!canEdit}
                                        className="app-input"
                                        value={rule.vetoSeverity ?? "WARNING"}
                                        onChange={(event) =>
                                          patchRule(groupIndex, ruleIndex, {
                                            vetoSeverity: event.target.value as
                                              | "WARNING"
                                              | "CRITICAL",
                                          })
                                        }
                                      >
                                        <option value="WARNING">警告</option>
                                        <option value="CRITICAL">严重</option>
                                      </select>
                                    ) : (
                                      "-"
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </section>
                    ))}
                  </div>
                ) : null}

                {view === "risk" ? (
                  <div className="grid gap-6 lg:grid-cols-2">
                    <section>
                      <h3 className="mb-3 text-sm font-medium">市场执行门控</h3>
                      <table className="app-table w-full">
                        <tbody>
                          <tr>
                            <td>中性环境建仓</td>
                            <td>降为试仓</td>
                          </tr>
                          <tr>
                            <td>中性环境加仓</td>
                            <td>降为持有</td>
                          </tr>
                          <tr>
                            <td>防守环境</td>
                            <td>阻止试仓、建仓、加仓</td>
                          </tr>
                        </tbody>
                      </table>
                    </section>
                    <section>
                      <h3 className="mb-3 text-sm font-medium">数据门控</h3>
                      <table className="app-table w-full">
                        <tbody>
                          <tr>
                            <td>主判据缺失</td>
                            <td>不产生动作</td>
                          </tr>
                          <tr>
                            <td>确认项缺失</td>
                            <td>保持形成中</td>
                          </tr>
                          <tr>
                            <td>否决项缺失</td>
                            <td>禁止新增风险</td>
                          </tr>
                        </tbody>
                      </table>
                    </section>
                    <label className="grid gap-2 text-sm lg:col-span-2">
                      <span>复盘交易日节点（1-120，以逗号分隔）</span>
                      <input
                        disabled={!canEdit}
                        className="app-input"
                        value={config.reviewTradingDays.join(", ")}
                        onChange={(event) =>
                          patchConfig({
                            reviewTradingDays: event.target.value
                              .split(/[,，\s]+/)
                              .filter(Boolean)
                              .map(Number),
                          })
                        }
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3 text-sm lg:col-span-2 lg:grid-cols-4">
                      {Object.entries(config.backtestPolicy).map(
                        ([key, value]) => (
                          <label key={key} className="grid gap-2">
                            <span className="text-[var(--app-text-muted)]">
                              {key}
                            </span>
                            <input
                              disabled={!canEdit}
                              type="number"
                              className="app-input"
                              value={value}
                              onChange={(event) =>
                                patchConfig({
                                  backtestPolicy: {
                                    ...config.backtestPolicy,
                                    [key]: Number(event.target.value),
                                  },
                                })
                              }
                            />
                          </label>
                        ),
                      )}
                    </div>
                  </div>
                ) : null}

                {view === "publish" ? (
                  <div className="grid gap-5">
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="grid min-w-64 gap-2 text-sm">
                        <span>冻结成分自选股</span>
                        <select
                          className="app-input"
                          value={watchListId}
                          onChange={(event) =>
                            setWatchListId(event.target.value)
                          }
                        >
                          <option value="">请选择</option>
                          {(watchlists.data ?? []).map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}（{item.stockCount}）
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="app-button"
                        disabled={
                          !watchListId ||
                          !["DRAFT", "VALIDATING"].includes(
                            selectedRevision.status,
                          ) ||
                          runBacktest.isPending ||
                          dirty
                        }
                        onClick={() =>
                          runBacktest.mutate({
                            revisionId: selectedRevision.id,
                            watchListId,
                          })
                        }
                      >
                        {runBacktest.isPending ? "回放中" : "运行冻结证据回放"}
                      </button>
                      <button
                        type="button"
                        className="app-button app-button-primary"
                        disabled={!canPublish || publish.isPending}
                        onClick={() =>
                          publish.mutate({ revisionId: selectedRevision.id })
                        }
                      >
                        发布修订
                      </button>
                    </div>
                    <InlineNotice
                      tone="warning"
                      description="回放使用当前自选股冻结成分，属于样本内验证并存在幸存偏差；只强制数据质量与无未来数据，不以收益表现阻止发布。"
                    />
                    {latestBacktest ? (
                      <div className="overflow-x-auto">
                        <table className="app-table min-w-full">
                          <thead>
                            <tr>
                              <th>状态</th>
                              <th>覆盖月数</th>
                              <th>股票数</th>
                              <th>完整触发</th>
                              <th>主数据完整率</th>
                              <th>无未来数据</th>
                              <th>质量门禁</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>{latestBacktest.status}</td>
                              <td>
                                {metric(
                                  latestBacktest.qualityMetrics,
                                  "coveredMonths",
                                )}
                              </td>
                              <td>
                                {metric(
                                  latestBacktest.qualityMetrics,
                                  "stockCount",
                                )}
                              </td>
                              <td>
                                {metric(
                                  latestBacktest.qualityMetrics,
                                  "triggeredEvents",
                                )}
                              </td>
                              <td>
                                {metric(
                                  latestBacktest.qualityMetrics,
                                  "primaryCompletenessPct",
                                )}
                                %
                              </td>
                              <td>
                                {metric(
                                  latestBacktest.qualityMetrics,
                                  "noLookaheadPassed",
                                )}
                              </td>
                              <td>
                                {isQualityPassed(latestBacktest.qualityMetrics)
                                  ? "通过"
                                  : "未通过"}
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <EmptyState title="尚未运行当前修订的历史回放" />
                    )}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--app-border-soft)] px-4 py-3">
                {selectedRevision.status !== "DRAFT" ? (
                  <button
                    type="button"
                    className="app-button"
                    onClick={() =>
                      clone.mutate({ revisionId: selectedRevision.id })
                    }
                  >
                    复制为新草稿
                  </button>
                ) : null}
                <button
                  type="button"
                  className="app-button app-button-primary"
                  disabled={
                    !canEdit ||
                    !dirty ||
                    !name.trim() ||
                    !config ||
                    save.isPending
                  }
                  onClick={() =>
                    config &&
                    save.mutate({
                      revisionId: selectedRevision.id,
                      name,
                      description: description || undefined,
                      config,
                    })
                  }
                >
                  {save.isPending ? "保存中" : "保存草稿"}
                </button>
              </div>
            </>
          )}
        </main>
      </div>
    </WorkspaceShell>
  );
}

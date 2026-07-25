"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  StockSearchPicker,
  type StockSearchPickerSelection,
} from "~/app/_components/stock-search-picker";
import {
  EmptyState,
  InlineNotice,
  StatusPill,
  WorkspaceShell,
} from "~/app/_components/ui";
import { useWorkflowRunEvents } from "~/app/workflows/use-workflow-run-events";
import type { TimingDecisionInput } from "~/contracts/timing-decision";
import { TIMING_RISK_PROFILE_DEFAULTS } from "~/server/domain/timing/strategy-v2";
import type { PortfolioRiskPreferences } from "~/server/domain/timing/types";
import { api } from "~/trpc/react";

const horizonOptions = [
  { value: "SHORT_SWING", label: "短波段", hint: "更快响应短期变化" },
  { value: "SWING", label: "波段", hint: "兼顾信号质量与机会" },
  { value: "MEDIUM_TERM", label: "中期", hint: "减少短期波动干扰" },
] as const;

const riskOptions = [
  { value: "STEADY", label: "稳健", hint: "确认更严格，仓位更克制" },
  { value: "BALANCED", label: "均衡", hint: "适合多数市场环境" },
  { value: "AGGRESSIVE", label: "进攻", hint: "更早行动，承受更多波动" },
] as const;

const actionLabels: Record<string, string> = {
  WATCH: "观察",
  PROBE: "试仓",
  ENTER: "建仓",
  ADD: "加仓",
  HOLD: "持有",
  TRIM: "减仓",
  EXIT: "退出",
};

type Mode = "SINGLE" | "PORTFOLIO";
type Horizon = (typeof horizonOptions)[number]["value"];
type RiskProfile = (typeof riskOptions)[number]["value"];

function numeric(value: string, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function TimingRunConsole() {
  const [mode, setMode] = useState<Mode>("SINGLE");
  const [step, setStep] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [targets, setTargets] = useState<StockSearchPickerSelection[]>([]);
  const [held, setHeld] = useState(false);
  const [singleWeight, setSingleWeight] = useState("20");
  const [singleCash, setSingleCash] = useState("80");
  const [totalCapital, setTotalCapital] = useState("100000");
  const [cash, setCash] = useState("100000");
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [horizon, setHorizon] = useState<Horizon>("SWING");
  const [riskProfile, setRiskProfile] = useState<RiskProfile>("BALANCED");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [analysisMode, setAnalysisMode] = useState<
    "LATEST_COMPLETE" | "CURRENT_PARTIAL" | "EXPLICIT"
  >("LATEST_COMPLETE");
  const [asOfDate, setAsOfDate] = useState("");
  const [sourceWatchListId, setSourceWatchListId] = useState("");
  const [runId, setRunId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [riskOverrides, setRiskOverrides] = useState<PortfolioRiskPreferences>(
    TIMING_RISK_PROFILE_DEFAULTS.BALANCED,
  );

  const defaults = api.timing.getDecisionDefaults.useQuery();
  const watchlists = api.watchlist.list.useQuery({
    limit: 50,
    offset: 0,
    sortBy: "updatedAt",
    sortDirection: "desc",
  });
  const importedList = api.watchlist.getDetail.useQuery(
    { id: sourceWatchListId },
    { enabled: Boolean(sourceWatchListId) },
  );

  useEffect(() => {
    setRiskOverrides(TIMING_RISK_PROFILE_DEFAULTS[riskProfile]);
  }, [riskProfile]);

  const selectedTargets = mode === "SINGLE" ? targets.slice(0, 1) : targets;
  const positionContext = useMemo<TimingDecisionInput["positionContext"]>(
    () =>
      mode === "SINGLE"
        ? {
            mode: "SINGLE",
            held,
            currentWeightPct: held ? numeric(singleWeight) : 0,
            availableCashPct: numeric(singleCash, 100),
          }
        : {
            mode: "PORTFOLIO",
            totalCapital: numeric(totalCapital),
            cash: numeric(cash),
            positions: selectedTargets
              .filter((stock) => numeric(weights[stock.stockCode] ?? "0") > 0)
              .map((stock) => ({
                stockCode: stock.stockCode,
                stockName: stock.stockName,
                currentWeightPct: numeric(weights[stock.stockCode] ?? "0"),
              })),
          },
    [
      cash,
      held,
      mode,
      selectedTargets,
      singleCash,
      singleWeight,
      totalCapital,
      weights,
    ],
  );
  const decisionInput = useMemo<TimingDecisionInput>(
    () => ({
      mode,
      targets: selectedTargets.map(({ stockCode, stockName }) => ({
        stockCode,
        stockName,
      })),
      positionContext,
      strategySelection: { kind: "SYSTEM", horizon, riskProfile },
      riskPreferences: riskOverrides,
      analysisDate: {
        mode: analysisMode,
        asOfDate:
          analysisMode === "EXPLICIT" ? asOfDate || undefined : undefined,
      },
      sourceWatchListId: sourceWatchListId || undefined,
    }),
    [
      analysisMode,
      asOfDate,
      horizon,
      mode,
      positionContext,
      riskOverrides,
      riskProfile,
      selectedTargets,
      sourceWatchListId,
    ],
  );

  const canPreview =
    selectedTargets.length > 0 &&
    (mode === "SINGLE" || numeric(totalCapital) > 0) &&
    (analysisMode !== "EXPLICIT" || Boolean(asOfDate));
  const preview = api.timing.previewDecision.useQuery(decisionInput, {
    enabled: step === 3 && canPreview,
    retry: false,
  });
  const start = api.workflow.startTimingDecision.useMutation({
    onSuccess: (run) => {
      setRunId(run.runId);
      setNotice("分析已开始，页面会持续更新本次进度。");
    },
  });
  const run = api.workflow.getRun.useQuery(
    { runId },
    {
      enabled: Boolean(runId),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(status)
          ? false
          : 2000;
      },
    },
  );
  const live = useWorkflowRunEvents({ runId, enabled: Boolean(runId) });
  const recommendations = api.timing.listRecommendations.useQuery(
    { limit: 50, workflowRunId: runId || undefined },
    {
      enabled: Boolean(runId),
      refetchInterval: run.data?.status === "SUCCEEDED" ? false : 2000,
    },
  );
  const cards = api.timing.listTimingCards.useQuery(
    { limit: 50, workflowRunId: runId || undefined },
    {
      enabled: Boolean(runId),
      refetchInterval: run.data?.status === "SUCCEEDED" ? false : 2000,
    },
  );

  function toggleStock(stock: StockSearchPickerSelection) {
    setTargets((current) => {
      if (current.some((item) => item.stockCode === stock.stockCode)) {
        return current.filter((item) => item.stockCode !== stock.stockCode);
      }
      return mode === "SINGLE" ? [stock] : [...current, stock].slice(0, 50);
    });
  }

  function importWatchList() {
    const stocks = importedList.data?.stocks ?? [];
    setTargets(
      stocks.slice(0, 50).map((stock) => ({
        stockCode: String(stock.stockCode ?? ""),
        stockName: String(stock.stockName ?? stock.stockCode ?? ""),
        market: String(stock.market ?? "A股"),
      })),
    );
    setNotice(
      `已从“${importedList.data?.name ?? "已有列表"}”导入 ${stocks.length} 只股票。`,
    );
  }

  function applyPreviousInput() {
    const previous = defaults.data?.previousInput as TimingDecisionInput | null;
    if (!previous?.targets?.length) return;
    setMode(previous.mode);
    setTargets(previous.targets.map((item) => ({ ...item, market: "A股" })));
    if (previous.strategySelection.kind === "SYSTEM") {
      setHorizon(previous.strategySelection.horizon);
      setRiskProfile(previous.strategySelection.riskProfile);
    }
    if (previous.positionContext.mode === "SINGLE") {
      setHeld(previous.positionContext.held);
      setSingleWeight(String(previous.positionContext.currentWeightPct));
      setSingleCash(String(previous.positionContext.availableCashPct));
    } else {
      setTotalCapital(String(previous.positionContext.totalCapital));
      setCash(String(previous.positionContext.cash));
      setWeights(
        Object.fromEntries(
          previous.positionContext.positions.map((item) => [
            item.stockCode,
            String(item.currentWeightPct),
          ]),
        ),
      );
    }
    setNotice("已带入上次配置，你可以在运行前继续修改。");
  }

  async function submit() {
    if (!preview.data?.canRun) return;
    await start.mutateAsync({
      ...decisionInput,
      idempotencyKey: crypto.randomUUID(),
    });
  }

  const resultRows = recommendations.data?.length
    ? recommendations.data
    : (cards.data ?? []);
  const terminal =
    run.data && ["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.data.status);

  return (
    <WorkspaceShell
      section="timing"
      title="择时分析"
      titleSize="compact"
      contentWidth="wide"
      actions={
        <Link href="/timing/history" className="app-button">
          历史记录
        </Link>
      }
    >
      {notice ? <InlineNotice tone="success" description={notice} /> : null}
      {defaults.data?.previousInput ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)] px-4 py-3 text-sm">
          <span>检测到上一次分析输入，系统不会自动替你选择。</span>
          <button
            type="button"
            className="app-button"
            onClick={applyPreviousInput}
          >
            带入上次配置
          </button>
        </div>
      ) : null}

      <nav
        aria-label="分析步骤"
        className="grid grid-cols-3 border border-[var(--app-border-soft)] bg-[var(--app-surface)]"
      >
        {["分析对象", "当前仓位", "周期与风格"].map((label, index) => {
          const number = index + 1;
          return (
            <button
              key={label}
              type="button"
              onClick={() => number < step && setStep(number)}
              className={`min-h-14 border-r border-[var(--app-border-soft)] px-3 text-left text-sm last:border-r-0 ${step === number ? "bg-[var(--app-panel-soft)] font-medium text-[var(--app-text-strong)]" : "text-[var(--app-text-muted)]"}`}
            >
              <span className="mr-2 tabular-nums">{number}</span>
              {label}
            </button>
          );
        })}
      </nav>

      <section className="border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4 sm:p-6">
        {step === 1 ? (
          <div className="grid gap-6">
            <div>
              <h2 className="text-lg font-medium text-[var(--app-text-strong)]">
                选择分析对象
              </h2>
              <fieldset className="mt-4 inline-grid grid-cols-2 border border-[var(--app-border-strong)]">
                <legend className="sr-only">分析模式</legend>
                {(["SINGLE", "PORTFOLIO"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setMode(value);
                      setTargets(
                        value === "SINGLE" ? targets.slice(0, 1) : targets,
                      );
                    }}
                    className={`min-w-28 px-4 py-2 text-sm ${mode === value ? "bg-[var(--app-text-strong)] text-[var(--app-surface)]" : "bg-[var(--app-surface)]"}`}
                  >
                    {value === "SINGLE" ? "单股" : "组合"}
                  </button>
                ))}
              </fieldset>
            </div>
            {mode === "PORTFOLIO" ? (
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                  从已有列表导入
                  <select
                    className="app-input"
                    value={sourceWatchListId}
                    onChange={(event) =>
                      setSourceWatchListId(event.target.value)
                    }
                  >
                    <option value="">请选择列表</option>
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
                  disabled={!importedList.data}
                  onClick={importWatchList}
                >
                  导入
                </button>
              </div>
            ) : null}
            <StockSearchPicker
              label={mode === "SINGLE" ? "搜索一只股票" : "搜索并添加股票"}
              keyword={keyword}
              onKeywordChange={setKeyword}
              selectedStocks={selectedTargets}
              onToggleStock={toggleStock}
              maxSelection={mode === "SINGLE" ? 1 : 50}
            />
            <div className="flex justify-end">
              <button
                type="button"
                className="app-button app-button-primary"
                disabled={!selectedTargets.length}
                onClick={() => setStep(2)}
              >
                下一步：当前仓位
              </button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-6">
            <h2 className="text-lg font-medium text-[var(--app-text-strong)]">
              补充当前仓位
            </h2>
            {mode === "SINGLE" ? (
              <div className="grid gap-5 md:grid-cols-3">
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={held}
                    onChange={(event) => setHeld(event.target.checked)}
                  />
                  当前持有这只股票
                </label>
                <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                  当前仓位比例（%）
                  <input
                    className="app-input"
                    type="number"
                    min="0"
                    max="100"
                    disabled={!held}
                    value={held ? singleWeight : "0"}
                    onChange={(event) => setSingleWeight(event.target.value)}
                  />
                </label>
                <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                  可用现金比例（%）
                  <input
                    className="app-input"
                    type="number"
                    min="0"
                    max="100"
                    value={singleCash}
                    onChange={(event) => setSingleCash(event.target.value)}
                  />
                </label>
              </div>
            ) : (
              <div className="grid gap-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                    总资产（元）
                    <input
                      className="app-input"
                      type="number"
                      min="1"
                      value={totalCapital}
                      onChange={(event) => setTotalCapital(event.target.value)}
                    />
                  </label>
                  <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
                    可用现金（元）
                    <input
                      className="app-input"
                      type="number"
                      min="0"
                      value={cash}
                      onChange={(event) => setCash(event.target.value)}
                    />
                  </label>
                </div>
                <div className="divide-y divide-[var(--app-border-soft)] border-y border-[var(--app-border-soft)]">
                  {selectedTargets.map((stock) => (
                    <label
                      key={stock.stockCode}
                      className="grid gap-3 py-3 text-sm sm:grid-cols-[1fr_180px] sm:items-center"
                    >
                      <span>
                        <span className="font-medium text-[var(--app-text-strong)]">
                          {stock.stockName}
                        </span>
                        <span className="ml-2 text-[var(--app-text-subtle)]">
                          {stock.stockCode}
                        </span>
                      </span>
                      <span className="grid grid-cols-[1fr_auto] items-center gap-2">
                        <input
                          className="app-input"
                          type="number"
                          min="0"
                          max="100"
                          value={weights[stock.stockCode] ?? ""}
                          placeholder="0"
                          onChange={(event) =>
                            setWeights((current) => ({
                              ...current,
                              [stock.stockCode]: event.target.value,
                            }))
                          }
                        />
                        <span>%</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap justify-between gap-3">
              <button
                type="button"
                className="app-button"
                onClick={() => setStep(1)}
              >
                返回
              </button>
              <button
                type="button"
                className="app-button app-button-primary"
                disabled={
                  mode === "PORTFOLIO" &&
                  (numeric(totalCapital) <= 0 ||
                    numeric(cash) > numeric(totalCapital))
                }
                onClick={() => setStep(3)}
              >
                下一步：选择偏好
              </button>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="grid gap-7">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium text-[var(--app-text-strong)]">
                  选择周期与风格
                </h2>
                <p className="mt-1 text-sm text-[var(--app-text-muted)]">
                  默认配置已经适合多数波段分析。
                </p>
              </div>
              <button
                type="button"
                className="app-button"
                onClick={() => setAdvancedOpen(true)}
              >
                高级设置
              </button>
            </div>
            <fieldset className="grid gap-3">
              <legend className="mb-2 text-sm font-medium">周期</legend>
              <div className="grid gap-2 md:grid-cols-3">
                {horizonOptions.map((option) => (
                  <label
                    key={option.value}
                    className={`cursor-pointer border p-4 ${horizon === option.value ? "border-[var(--app-text-strong)] bg-[var(--app-panel-soft)]" : "border-[var(--app-border-soft)]"}`}
                  >
                    <input
                      className="sr-only"
                      type="radio"
                      name="horizon"
                      checked={horizon === option.value}
                      onChange={() => setHorizon(option.value)}
                    />
                    <span className="block font-medium">{option.label}</span>
                    <span className="mt-1 block text-xs text-[var(--app-text-muted)]">
                      {option.hint}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="grid gap-3">
              <legend className="mb-2 text-sm font-medium">风格</legend>
              <div className="grid gap-2 md:grid-cols-3">
                {riskOptions.map((option) => (
                  <label
                    key={option.value}
                    className={`cursor-pointer border p-4 ${riskProfile === option.value ? "border-[var(--app-text-strong)] bg-[var(--app-panel-soft)]" : "border-[var(--app-border-soft)]"}`}
                  >
                    <input
                      className="sr-only"
                      type="radio"
                      name="risk"
                      checked={riskProfile === option.value}
                      onChange={() => setRiskProfile(option.value)}
                    />
                    <span className="block font-medium">{option.label}</span>
                    <span className="mt-1 block text-xs text-[var(--app-text-muted)]">
                      {option.hint}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="border-t border-[var(--app-border-soft)] pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="font-medium text-[var(--app-text-strong)]">
                  运行前检查
                </h3>
                {preview.isFetching ? (
                  <StatusPill label="检查中" tone="info" />
                ) : preview.data ? (
                  <StatusPill
                    label={preview.data.complete ? "可以运行" : "部分仅观察"}
                    tone={preview.data.complete ? "success" : "warning"}
                  />
                ) : null}
              </div>
              {preview.error ? (
                <div className="mt-3">
                  <InlineNotice
                    tone="danger"
                    description={preview.error.message}
                  />
                </div>
              ) : null}
              {preview.data ? (
                <div className="mt-3 text-sm">
                  <p className="font-medium">{preview.data.summary}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {preview.data.items.map((item) => (
                      <div
                        key={item.stockCode}
                        className="flex items-center justify-between border-b border-[var(--app-border-soft)] py-2"
                      >
                        <span>
                          {item.stockName}{" "}
                          <span className="text-[var(--app-text-subtle)]">
                            {item.stockCode}
                          </span>
                        </span>
                        <span
                          className={
                            item.status === "READY"
                              ? "text-[var(--app-success)]"
                              : "text-[var(--app-warning)]"
                          }
                        >
                          {item.status === "READY" ? "数据齐全" : "仅观察"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex flex-wrap justify-between gap-3">
              <button
                type="button"
                className="app-button"
                onClick={() => setStep(2)}
              >
                返回
              </button>
              <button
                type="button"
                className="app-button app-button-primary"
                disabled={!preview.data?.canRun || start.isPending}
                onClick={submit}
              >
                {start.isPending ? "正在启动" : "开始分析"}
              </button>
            </div>
            {start.error ? (
              <InlineNotice tone="danger" description={start.error.message} />
            ) : null}
          </div>
        ) : null}
      </section>

      {runId ? (
        <section className="border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-medium text-[var(--app-text-strong)]">
              本次分析
            </h2>
            <StatusPill
              label={
                run.data?.status === "SUCCEEDED"
                  ? "已完成"
                  : run.data?.status === "FAILED"
                    ? "失败"
                    : "运行中"
              }
              tone={
                run.data?.status === "SUCCEEDED"
                  ? "success"
                  : run.data?.status === "FAILED"
                    ? "danger"
                    : "info"
              }
            />
          </div>
          <div className="mt-4 h-2 overflow-hidden bg-[var(--app-panel-soft)]">
            <div
              className="h-full bg-[var(--app-brand)] transition-all"
              style={{
                width: `${run.data?.progressPercent ?? live.events.at(-1)?.progressPercent ?? 0}%`,
              }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-[var(--app-text-muted)]">
            <span>
              {run.data?.currentNodeKey
                ? "正在生成分析结果"
                : terminal
                  ? "流程已结束"
                  : "正在准备数据"}
            </span>
            <span>
              {run.data?.progressPercent ?? 0}% ·{" "}
              {live.connectionState === "connected" ? "实时更新" : "自动刷新"}
            </span>
          </div>
          {run.data?.errorMessage ? (
            <div className="mt-4">
              <InlineNotice tone="danger" description={run.data.errorMessage} />
            </div>
          ) : null}
          {resultRows.length ? (
            <div className="mt-6 overflow-x-auto">
              <table className="app-table min-w-full">
                <thead>
                  <tr>
                    <th>股票</th>
                    <th>建议</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {resultRows.map((item) => {
                    const audit =
                      item.decisionAudit ?? item.reasoning?.decisionAudit;
                    const persistedAction =
                      "action" in item ? item.action : item.actionBias;
                    return (
                      <tr key={item.id}>
                        <td>
                          <span className="font-medium">{item.stockName}</span>
                          <span className="ml-2 text-xs text-[var(--app-text-subtle)]">
                            {item.stockCode}
                          </span>
                        </td>
                        <td className="font-medium">
                          {actionLabels[
                            audit?.finalAction ?? persistedAction
                          ] ?? "观察"}
                        </td>
                        <td>
                          {"signalSnapshotId" in item ? (
                            <Link
                              className="text-[var(--app-brand)]"
                              href={`/timing/reports/${item.id}`}
                            >
                              查看依据
                            </Link>
                          ) : (
                            "已纳入组合风险约束"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : terminal ? (
            <div className="mt-5">
              <EmptyState title="本次运行没有生成可执行建议" />
            </div>
          ) : null}
        </section>
      ) : null}

      {advancedOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="关闭高级设置"
            onClick={() => setAdvancedOpen(false)}
          />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="高级设置"
            className="relative h-full w-full max-w-xl overflow-y-auto bg-[var(--app-surface)] p-5 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">高级设置</h2>
              <button
                type="button"
                className="app-button"
                onClick={() => setAdvancedOpen(false)}
                aria-label="关闭高级设置"
              >
                关闭
              </button>
            </div>
            <div className="mt-6 grid gap-5">
              <div>
                <h3 className="font-medium">分析日期</h3>
                <select
                  className="app-input mt-2"
                  value={analysisMode}
                  onChange={(event) =>
                    setAnalysisMode(event.target.value as typeof analysisMode)
                  }
                >
                  <option value="LATEST_COMPLETE">最新完整交易日</option>
                  <option value="CURRENT_PARTIAL">当日不完整数据</option>
                  <option value="EXPLICIT">指定交易日</option>
                </select>
                {analysisMode === "EXPLICIT" ? (
                  <input
                    type="date"
                    className="app-input mt-2"
                    value={asOfDate}
                    onChange={(event) => setAsOfDate(event.target.value)}
                  />
                ) : null}
              </div>
              <div>
                <h3 className="font-medium">组合风险边界</h3>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  {(
                    [
                      ["maxSingleNamePct", "单股上限（%）"],
                      ["maxThemeExposurePct", "主题上限（%）"],
                      ["defaultProbePct", "试仓比例（%）"],
                      ["maxPortfolioRiskBudgetPct", "风险预算（%）"],
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="grid gap-2 text-sm text-[var(--app-text-muted)]"
                    >
                      {label}
                      <input
                        className="app-input"
                        type="number"
                        min="0.5"
                        max="100"
                        value={riskOverrides[key]}
                        onChange={(event) =>
                          setRiskOverrides((current) => ({
                            ...current,
                            [key]: numeric(event.target.value),
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div className="border-t border-[var(--app-border-soft)] pt-5">
                <h3 className="font-medium">完整策略规则</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--app-text-muted)]">
                  自定义规则会保存为你的草稿，系统模板始终保持只读。草稿需通过历史回放后才能发布。
                </p>
                <iframe
                  title="完整策略规则编辑器"
                  src="/timing/strategies"
                  className="mt-4 h-[70vh] min-h-[560px] w-full border border-[var(--app-border-soft)] bg-[var(--app-surface)]"
                />
              </div>
            </div>
            <div className="mt-8 flex justify-end">
              <button
                type="button"
                className="app-button app-button-primary"
                onClick={() => setAdvancedOpen(false)}
              >
                应用到本次分析
              </button>
            </div>
          </aside>
        </div>
      ) : null}
    </WorkspaceShell>
  );
}

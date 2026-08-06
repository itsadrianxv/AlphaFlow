"use client";

import { Play, Scale, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { FavoriteStockPicker } from "~/app/_components/favorite-stock-picker";
import {
  StockSearchPicker,
  type StockSearchPickerSelection,
} from "~/app/_components/stock-search-picker";
import { InlineNotice, StatusPill, WorkspaceShell } from "~/app/_components/ui";
import {
  formatTimingResearchStateLabel,
  formatTimingTrendStateLabel,
} from "~/app/timing/timing-labels";
import { api, type RouterOutputs } from "~/trpc/react";

type Mode = "INDIVIDUAL" | "PORTFOLIO";
type PositionDraft = StockSearchPickerSelection & {
  weightPct: string;
  sector: string;
  themes: string;
};
type ResearchRunResult = RouterOutputs["timing"]["startResearchRun"];
type ResearchPreview = RouterOutputs["timing"]["previewResearchRun"];
type RiskDiagnostic = NonNullable<ResearchRunResult["portfolioDiagnostic"]>;

const horizons = [
  { value: "SHORT_SWING", label: "短波段" },
  { value: "SWING", label: "波段" },
  { value: "MEDIUM_TERM", label: "中期" },
] as const;

function roundWeight(value: number) {
  return String(Math.round(value * 100) / 100);
}

export function TimingRunConsole() {
  const [mode, setMode] = useState<Mode>("INDIVIDUAL");
  const [keyword, setKeyword] = useState("");
  const [targets, setTargets] = useState<StockSearchPickerSelection[]>([]);
  const [positions, setPositions] = useState<PositionDraft[]>([]);
  const [portfolioName, setPortfolioName] = useState("研究组合");
  const [horizon, setHorizon] =
    useState<(typeof horizons)[number]["value"]>("SWING");
  const [analysisDateMode, setAnalysisDateMode] = useState<
    "LATEST_COMPLETE" | "CURRENT_PARTIAL" | "EXPLICIT"
  >("LATEST_COMPLETE");
  const [asOfDate, setAsOfDate] = useState("");
  const [result, setResult] = useState<ResearchRunResult | null>(null);
  const [preview, setPreview] = useState<ResearchPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const runMutation = api.timing.startResearchRun.useMutation();
  const utils = api.useUtils();
  const [notice, setNotice] = useState<string | null>(null);

  const selected = mode === "INDIVIDUAL" ? targets.slice(0, 1) : positions;
  const totalWeight = useMemo(
    () =>
      positions.reduce((sum, item) => sum + (Number(item.weightPct) || 0), 0),
    [positions],
  );

  function toggleStock(stock: StockSearchPickerSelection) {
    if (mode === "INDIVIDUAL") {
      setTargets((current) =>
        current.some((item) => item.stockCode === stock.stockCode)
          ? []
          : [stock],
      );
      return;
    }
    setPositions((current) => {
      if (current.some((item) => item.stockCode === stock.stockCode)) {
        return current.filter((item) => item.stockCode !== stock.stockCode);
      }
      const nextCount = current.length + 1;
      const evenWeight = roundWeight(100 / nextCount);
      return [
        ...current.map((item) => ({ ...item, weightPct: evenWeight })),
        { ...stock, weightPct: evenWeight, sector: "", themes: "" },
      ];
    });
  }

  function updatePosition(stockCode: string, patch: Partial<PositionDraft>) {
    setPositions((current) =>
      current.map((item) =>
        item.stockCode === stockCode ? { ...item, ...patch } : item,
      ),
    );
  }

  function normalizeWeights() {
    if (!positions.length) return;
    const denominator = totalWeight > 0 ? totalWeight : positions.length;
    let assigned = 0;
    setPositions((current) =>
      current.map((item, index) => {
        const source = totalWeight > 0 ? Number(item.weightPct) || 0 : 1;
        const weight =
          index === current.length - 1
            ? 100 - assigned
            : Math.round((source / denominator) * 10_000) / 100;
        assigned += weight;
        return { ...item, weightPct: roundWeight(weight) };
      }),
    );
  }

  function buildInput() {
    const portfolioComposition =
      mode === "PORTFOLIO"
        ? {
            name: portfolioName,
            positions: positions.map((item) => ({
              stockCode: item.stockCode,
              stockName: item.stockName,
              weightPct: Number(item.weightPct),
              sector: item.sector.trim() || undefined,
              themes: item.themes
                .split(/[，,]/)
                .map((value) => value.trim())
                .filter(Boolean),
            })),
          }
        : undefined;
    return {
      mode,
      targets: selected.map((item) => ({
        stockCode: item.stockCode,
        stockName: item.stockName,
      })),
      portfolioComposition,
      strategySelection: { kind: "SYSTEM" as const, horizon },
      analysisDate: {
        mode: analysisDateMode,
        asOfDate: analysisDateMode === "EXPLICIT" ? asOfDate : undefined,
      },
    };
  }

  async function startResearch() {
    setNotice(null);
    try {
      const result = await runMutation.mutateAsync(buildInput());
      setResult(result);
      await utils.timing.listResearchReports.invalidate();
    } catch (error) {
      setNotice((error as Error).message);
    }
  }

  async function previewResearch() {
    setNotice(null);
    setPreviewing(true);
    try {
      setPreview(await utils.timing.previewResearchRun.fetch(buildInput()));
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setPreviewing(false);
    }
  }

  const canSubmit =
    selected.length > 0 &&
    (mode === "INDIVIDUAL" || Math.abs(totalWeight - 100) <= 0.1);
  const reports = result?.reports ?? [];
  const diagnostic = result?.portfolioDiagnostic;

  return (
    <WorkspaceShell
      section="timing"
      contentWidth="wide"
      title="择时研究"
      titleSize="compact"
      description="技术结构研究与组合风险诊断"
      actions={
        <>
          <Link className="app-button" href="/timing/strategies">
            研究规则
          </Link>
          <Link className="app-button" href="/timing/history">
            研究档案
          </Link>
        </>
      }
    >
      <div className="grid gap-8">
        <div className="flex w-fit border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-1">
          {(["INDIVIDUAL", "PORTFOLIO"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setMode(value);
                setResult(null);
              }}
              className={`px-4 py-2 text-sm ${mode === value ? "bg-[var(--app-text-strong)] text-[var(--app-surface)]" : "text-[var(--app-text-muted)]"}`}
            >
              {value === "INDIVIDUAL" ? "个股研究" : "组合诊断"}
            </button>
          ))}
        </div>

        <section className="grid gap-5 border-b border-[var(--app-border-soft)] pb-8">
          <div>
            <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">
              研究对象
            </h2>
            <p className="mt-1 text-sm text-[var(--app-text-muted)]">
              {mode === "INDIVIDUAL"
                ? "选择一只股票采集技术证据。"
                : "选择股票并描述相对权重、行业和主题暴露。"}
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <FavoriteStockPicker
              selectedStockCodes={selected.map((stock) => stock.stockCode)}
              onToggleStock={toggleStock}
              maxSelection={mode === "INDIVIDUAL" ? 1 : 50}
            />
            <StockSearchPicker
              label="搜索全部股票"
              keyword={keyword}
              onKeywordChange={setKeyword}
              selectedStocks={mode === "INDIVIDUAL" ? targets : positions}
              onToggleStock={toggleStock}
              maxSelection={mode === "INDIVIDUAL" ? 1 : 50}
            />
          </div>

          {mode === "PORTFOLIO" && positions.length ? (
            <div className="grid gap-3">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <label className="grid min-w-[240px] gap-2 text-sm text-[var(--app-text-muted)]">
                  组合名称
                  <input
                    className="app-input"
                    value={portfolioName}
                    onChange={(event) => setPortfolioName(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="app-button"
                  onClick={normalizeWeights}
                >
                  <Scale className="h-4 w-4" />
                  归一化权重
                </button>
              </div>
              <div className="overflow-x-auto border border-[var(--app-border-soft)]">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-[var(--app-surface-quiet)] text-[var(--app-text-muted)]">
                    <tr>
                      <th className="px-3 py-2">股票</th>
                      <th className="px-3 py-2">权重 %</th>
                      <th className="px-3 py-2">行业</th>
                      <th className="px-3 py-2">主题</th>
                      <th className="w-12 px-3 py-2">移除</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((item) => (
                      <tr
                        key={item.stockCode}
                        className="border-t border-[var(--app-border-soft)]"
                      >
                        <td className="px-3 py-2 font-medium">
                          {item.stockName}
                          <span className="ml-2 text-[var(--app-text-muted)]">
                            {item.stockCode}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="app-input w-28"
                            type="number"
                            min="0.01"
                            max="100"
                            step="0.01"
                            value={item.weightPct}
                            onChange={(event) =>
                              updatePosition(item.stockCode, {
                                weightPct: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="app-input"
                            value={item.sector}
                            onChange={(event) =>
                              updatePosition(item.stockCode, {
                                sector: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className="app-input"
                            placeholder="逗号分隔"
                            value={item.themes}
                            onChange={(event) =>
                              updatePosition(item.stockCode, {
                                themes: event.target.value,
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            title="移除股票"
                            className="app-button p-2"
                            onClick={() => toggleStock(item)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-[var(--app-border-strong)]">
                      <td className="px-3 py-2 font-medium">合计</td>
                      <td
                        className={`px-3 py-2 font-mono ${Math.abs(totalWeight - 100) <= 0.1 ? "text-[var(--app-success)]" : "text-[var(--app-danger)]"}`}
                      >
                        {totalWeight.toFixed(2)}%
                      </td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : null}
        </section>

        <section className="grid gap-5 border-b border-[var(--app-border-soft)] pb-8 md:grid-cols-2">
          <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
            研究周期
            <select
              className="app-input"
              value={horizon}
              onChange={(event) =>
                setHorizon(event.target.value as typeof horizon)
              }
            >
              {horizons.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
            数据日期
            <select
              className="app-input"
              value={analysisDateMode}
              onChange={(event) =>
                setAnalysisDateMode(
                  event.target.value as typeof analysisDateMode,
                )
              }
            >
              <option value="LATEST_COMPLETE">最近完整交易日</option>
              <option value="CURRENT_PARTIAL">当前可用数据</option>
              <option value="EXPLICIT">指定日期</option>
            </select>
          </label>
          {analysisDateMode === "EXPLICIT" ? (
            <label className="grid gap-2 text-sm text-[var(--app-text-muted)]">
              研究日期
              <input
                className="app-input"
                type="date"
                value={asOfDate}
                onChange={(event) => setAsOfDate(event.target.value)}
              />
            </label>
          ) : null}
          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              disabled={!canSubmit || previewing}
              className="app-button disabled:cursor-not-allowed disabled:opacity-50"
              onClick={previewResearch}
            >
              {previewing ? "检查中" : "预检数据"}
            </button>
            <button
              type="button"
              disabled={!canSubmit || runMutation.isPending}
              className="app-button app-button-primary disabled:cursor-not-allowed disabled:opacity-50"
              onClick={startResearch}
            >
              <Play className="h-4 w-4" />
              {runMutation.isPending ? "采集证据中" : "生成研究报告"}
            </button>
          </div>
        </section>

        {notice ? (
          <InlineNotice
            tone="danger"
            title="研究运行失败"
            description={notice}
          />
        ) : null}
        {preview ? (
          <section className="grid gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-semibold">数据预检</h2>
              <StatusPill
                label={`${preview.readyCount}/${preview.totalCount} 可用`}
                tone={preview.incompleteCount ? "warning" : "success"}
              />
              <span className="font-mono text-xs text-[var(--app-text-muted)]">
                配置 {preview.configHash.slice(0, 12)}
              </span>
            </div>
            <div className="overflow-x-auto border border-[var(--app-border-soft)]">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="bg-[var(--app-surface-quiet)]">
                  <tr>
                    <th className="px-3 py-2">股票</th>
                    <th className="px-3 py-2">数据日期</th>
                    <th className="px-3 py-2">状态</th>
                    <th className="px-3 py-2">缺失证据</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.map((item) => (
                    <tr
                      key={item.stockCode}
                      className="border-t border-[var(--app-border-soft)]"
                    >
                      <td className="px-3 py-2">
                        {item.stockName}{" "}
                        <span className="font-mono text-xs text-[var(--app-text-muted)]">
                          {item.stockCode}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {item.asOfDate}
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill
                          label={
                            item.status === "READY" ? "可用" : "数据不完整"
                          }
                          tone={item.status === "READY" ? "success" : "warning"}
                        />
                      </td>
                      <td className="px-3 py-2 text-[var(--app-text-muted)]">
                        {item.missing.join("；") || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
        {reports.length ? (
          <section className="grid gap-4">
            <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">
              研究结果
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {reports.map((report) => (
                <Link
                  key={report.id}
                  href={`/timing/reports/${report.id}`}
                  className="border border-[var(--app-border-soft)] bg-[var(--app-surface)] p-4 transition-colors hover:border-[var(--app-border-strong)]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong>
                      {report.stockName}{" "}
                      <span className="font-mono text-sm text-[var(--app-text-muted)]">
                        {report.stockCode}
                      </span>
                    </strong>
                    <StatusPill
                      label={formatTimingResearchStateLabel(
                        report.researchState,
                      )}
                      tone="info"
                    />
                  </div>
                  <div className="mt-3 text-sm text-[var(--app-text-muted)]">
                    {formatTimingTrendStateLabel(report.trendState)}
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm leading-6">
                    {report.summary}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
        {diagnostic ? (
          <PortfolioDiagnosticView diagnostic={diagnostic} />
        ) : null}
      </div>
    </WorkspaceShell>
  );
}

const liquidityLabels = {
  HIGH: "高",
  MEDIUM: "中",
  LOW: "低",
  UNAVAILABLE: "不可用",
} as const;

function ExposureBars({
  items,
  emptyLabel,
}: {
  items: RiskDiagnostic["exposures"]["sectors"];
  emptyLabel: string;
}) {
  if (!items.length) {
    return <p className="text-sm text-[var(--app-text-muted)]">{emptyLabel}</p>;
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <div
          key={item.name}
          className="grid grid-cols-[minmax(5rem,9rem)_1fr_4.5rem] items-center gap-3 text-sm"
        >
          <span
            className="truncate text-[var(--app-text-strong)]"
            title={item.name}
          >
            {item.name}
          </span>
          <div
            className="h-2 overflow-hidden bg-[var(--app-surface-quiet)]"
            aria-hidden="true"
          >
            <div
              className="h-full bg-[var(--app-info)]"
              style={{
                width: `${Math.min(100, Math.max(0, item.weightPct))}%`,
              }}
            />
          </div>
          <span className="text-right font-mono text-xs">
            {item.weightPct.toFixed(2)}%
          </span>
        </div>
      ))}
    </div>
  );
}

function correlationColor(value: number | null) {
  if (value === null) return "transparent";
  if (value >= 0) return `rgba(37, 99, 235, ${0.08 + Math.abs(value) * 0.34})`;
  return `rgba(220, 38, 38, ${0.08 + Math.abs(value) * 0.34})`;
}

function PortfolioDiagnosticView({
  diagnostic,
}: {
  diagnostic: RiskDiagnostic;
}) {
  const maxContribution = Math.max(
    1,
    ...diagnostic.volatility.contributions.map((item) =>
      Math.abs(item.contributionPct ?? 0),
    ),
  );

  return (
    <section className="grid gap-8 border-t border-[var(--app-border-strong)] pt-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--app-text-strong)]">
            组合风险诊断
          </h2>
          <p className="mt-1 text-sm text-[var(--app-text-muted)]">
            数据日期 {diagnostic.dataQuality.asOfDate}，
            {diagnostic.dataQuality.completeStocks}/
            {diagnostic.dataQuality.totalStocks} 个标的具备完整收益序列
          </p>
        </div>
        <StatusPill
          label={
            diagnostic.dataQuality.warnings.length ? "数据存在局限" : "数据完整"
          }
          tone={diagnostic.dataQuality.warnings.length ? "warning" : "success"}
        />
      </div>

      {diagnostic.dataQuality.warnings.length ? (
        <InlineNotice
          tone="warning"
          title="数据局限"
          description={diagnostic.dataQuality.warnings.join("；")}
        />
      ) : null}

      <div className="grid gap-px border border-[var(--app-border-soft)] bg-[var(--app-border-soft)] sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Top 1", `${diagnostic.concentration.top1Pct.toFixed(2)}%`],
          ["Top 3", `${diagnostic.concentration.top3Pct.toFixed(2)}%`],
          ["Top 5", `${diagnostic.concentration.top5Pct.toFixed(2)}%`],
          ["HHI", diagnostic.concentration.hhi.toFixed(4)],
          ["有效持仓数", diagnostic.concentration.effectiveHoldings.toFixed(2)],
        ].map(([label, value]) => (
          <div key={label} className="bg-[var(--app-surface)] px-4 py-4">
            <div className="text-xs text-[var(--app-text-muted)]">{label}</div>
            <div className="mt-2 font-mono text-xl font-semibold text-[var(--app-text-strong)]">
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="grid content-start gap-4">
          <h3 className="font-semibold text-[var(--app-text-strong)]">
            行业暴露
          </h3>
          <ExposureBars
            items={diagnostic.exposures.sectors}
            emptyLabel="暂无行业分类。"
          />
        </div>
        <div className="grid content-start gap-4">
          <h3 className="font-semibold text-[var(--app-text-strong)]">
            主题暴露
          </h3>
          <ExposureBars
            items={diagnostic.exposures.themes}
            emptyLabel="暂无主题分类。"
          />
        </div>
      </div>

      <div className="grid gap-4">
        <div>
          <h3 className="font-semibold text-[var(--app-text-strong)]">
            {diagnostic.correlation.lookbackDays} 日收益相关矩阵
          </h3>
          <p className="mt-1 text-sm text-[var(--app-text-muted)]">
            蓝色表示正相关，红色表示负相关；颜色深浅仅作辅助，单元格为相关系数。
          </p>
        </div>
        <div className="overflow-x-auto border border-[var(--app-border-soft)]">
          <table className="w-full min-w-[640px] border-collapse text-center text-xs">
            <thead>
              <tr className="bg-[var(--app-surface-quiet)]">
                <th className="sticky left-0 z-10 bg-[var(--app-surface-quiet)] px-3 py-2 text-left font-medium">
                  股票
                </th>
                {diagnostic.correlation.stockCodes.map((stockCode) => (
                  <th
                    key={stockCode}
                    className="px-3 py-2 font-mono font-medium"
                  >
                    {stockCode}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {diagnostic.correlation.stockCodes.map((stockCode, rowIndex) => (
                <tr
                  key={stockCode}
                  className="border-t border-[var(--app-border-soft)]"
                >
                  <th className="sticky left-0 z-10 bg-[var(--app-surface)] px-3 py-2 text-left font-mono font-medium">
                    {stockCode}
                  </th>
                  {(diagnostic.correlation.matrix[rowIndex] ?? []).map(
                    (value, columnIndex) => (
                      <td
                        key={`${stockCode}-${diagnostic.correlation.stockCodes[columnIndex] ?? columnIndex}`}
                        className="px-3 py-2 font-mono tabular-nums"
                        style={{ backgroundColor: correlationColor(value) }}
                      >
                        {value === null ? "-" : value.toFixed(2)}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="grid gap-2 text-sm">
          <strong className="text-[var(--app-text-strong)]">
            高相关聚类（系数不低于 0.70）
          </strong>
          {diagnostic.correlation.clusters.length ? (
            diagnostic.correlation.clusters.map((cluster, index) => (
              <div
                key={`${cluster.stockCodes.join("-")}-${index}`}
                className="flex flex-wrap justify-between gap-3 border-b border-[var(--app-border-soft)] py-2"
              >
                <span className="font-mono">
                  {cluster.stockCodes.join(" · ")}
                </span>
                <span className="font-mono text-[var(--app-text-muted)]">
                  平均 {cluster.averageCorrelation.toFixed(2)}
                </span>
              </div>
            ))
          ) : (
            <p className="text-[var(--app-text-muted)]">未识别到高相关聚类。</p>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[14rem_1fr]">
        <div>
          <div className="text-sm text-[var(--app-text-muted)]">
            {diagnostic.volatility.lookbackDays} 日年化组合波动
          </div>
          <div className="mt-2 font-mono text-3xl font-semibold text-[var(--app-text-strong)]">
            {diagnostic.volatility.annualizedPct === null
              ? "不可用"
              : `${diagnostic.volatility.annualizedPct.toFixed(2)}%`}
          </div>
        </div>
        <div className="grid gap-3">
          <h3 className="font-semibold text-[var(--app-text-strong)]">
            成分波动贡献
          </h3>
          {diagnostic.volatility.contributions.map((item) => (
            <div
              key={item.stockCode}
              className="grid grid-cols-[5rem_1fr_5rem] items-center gap-3 text-sm"
            >
              <span className="font-mono">{item.stockCode}</span>
              <div
                className="h-2 overflow-hidden bg-[var(--app-surface-quiet)]"
                aria-hidden="true"
              >
                <div
                  className={`h-full ${typeof item.contributionPct === "number" && item.contributionPct < 0 ? "bg-[var(--app-danger)]" : "bg-[var(--app-info)]"}`}
                  style={{
                    width: `${(Math.abs(item.contributionPct ?? 0) / maxContribution) * 100}%`,
                  }}
                />
              </div>
              <span className="text-right font-mono text-xs">
                {item.contributionPct === null
                  ? "-"
                  : `${item.contributionPct.toFixed(2)}%`}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4">
        <h3 className="font-semibold text-[var(--app-text-strong)]">
          相对流动性暴露
        </h3>
        <div className="grid gap-px border border-[var(--app-border-soft)] bg-[var(--app-border-soft)] sm:grid-cols-4">
          {diagnostic.liquidity.buckets.map((bucket) => (
            <div
              key={bucket.level}
              className="bg-[var(--app-surface)] px-4 py-3"
            >
              <div className="text-xs text-[var(--app-text-muted)]">
                {liquidityLabels[bucket.level]}
              </div>
              <div className="mt-1 font-mono text-lg">
                {bucket.weightPct.toFixed(2)}%
              </div>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto border border-[var(--app-border-soft)]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-[var(--app-surface-quiet)]">
              <tr>
                <th className="px-3 py-2">股票</th>
                <th className="px-3 py-2">流动性分位</th>
                <th className="px-3 py-2">20 日平均成交额</th>
                <th className="px-3 py-2">20 日平均换手率</th>
              </tr>
            </thead>
            <tbody>
              {diagnostic.liquidity.items.map((item) => (
                <tr
                  key={item.stockCode}
                  className="border-t border-[var(--app-border-soft)]"
                >
                  <td className="px-3 py-2 font-mono">{item.stockCode}</td>
                  <td className="px-3 py-2">{liquidityLabels[item.level]}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {item.averageAmount20 === null
                      ? "-"
                      : item.averageAmount20.toLocaleString("zh-CN", {
                          maximumFractionDigits: 2,
                        })}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {item.turnoverRate20 === null
                      ? "-"
                      : `${item.turnoverRate20.toFixed(4)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4">
        <div>
          <h3 className="font-semibold text-[var(--app-text-strong)]">
            固定压力情景
          </h3>
          <p className="mt-1 text-sm text-[var(--app-text-muted)]">
            以下结果用于暴露诊断，不表示情景发生概率。
          </p>
        </div>
        <div className="overflow-x-auto border border-[var(--app-border-soft)]">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-[var(--app-surface-quiet)]">
              <tr>
                <th className="px-3 py-2">情景</th>
                <th className="px-3 py-2">估算影响</th>
                <th className="px-3 py-2">压力说明</th>
              </tr>
            </thead>
            <tbody>
              {diagnostic.scenarios.map((scenario) => (
                <tr
                  key={scenario.id}
                  className="border-t border-[var(--app-border-soft)] align-top"
                >
                  <td className="px-3 py-3 font-medium text-[var(--app-text-strong)]">
                    {scenario.name}
                  </td>
                  <td className="px-3 py-3 font-mono tabular-nums">
                    {scenario.estimatedImpactPct === null
                      ? "不适用"
                      : `${scenario.estimatedImpactPct.toFixed(2)}%`}
                  </td>
                  <td className="px-3 py-3 text-[var(--app-text-muted)]">
                    {scenario.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs leading-5 text-[var(--app-text-muted)]">
          压力假设，不代表发生概率或投资建议。
        </p>
      </div>
    </section>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { cn, Panel, StatusPill } from "~/app/_components/ui";
import { companyOverviewHref } from "~/app/company-research/company-overview-link";
import { TimingReportChart } from "~/app/timing/reports/[cardId]/timing-report-chart";
import type { TimingTimeframe } from "~/server/domain/timing/types";
import { api } from "~/trpc/react";

function number(value: number | null | undefined, suffix = "") {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "暂无数据";
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value)}${suffix}`;
}

function amount(value: number | null | undefined) {
  if (value === null || value === undefined) return "暂无数据";
  return `${number(value / 100_000_000)} 亿`;
}

type FinancialMode = "quarter" | "annual";
type ReportPeriodOrder = "asc" | "desc";
const defaultFinancialMetricIds = [
  "income.total_revenue",
  "income.n_income_attr_p",
  "income.basic_eps",
  "balancesheet.total_assets",
  "balancesheet.total_liab",
  "cashflow.n_cashflow_act",
];
const financialMetricPreferenceKey = "company-overview.financial-metrics.v1";

function reportPeriodLabel(endDate: string, mode: FinancialMode) {
  const quarterMatch = /^(\d{4})Q([1-4])$/.exec(endDate);
  if (quarterMatch) return `${quarterMatch[1]?.slice(-2)}Q${quarterMatch[2]}`;
  if (/^\d{4}$/.test(endDate)) return `${endDate.slice(-2)}年报`;
  const normalized = endDate.replaceAll("-", "");
  const match = /^(\d{4})(\d{2})/.exec(normalized);
  const year = match?.[1];
  const month = match?.[2];
  if (!year || !month) return endDate;
  if (mode === "annual") return `${year.slice(-2)}年报`;

  const quarter = { "03": "Q1", "06": "Q2", "09": "Q3", "12": "Q4" }[month];
  return quarter ? `${year.slice(-2)}${quarter}` : endDate;
}

function compareReportPeriods(left: string, right: string) {
  const normalize = (period: string) => {
    const trimmed = period.trim().toUpperCase();
    const quarterMatch = /^(\d{4})Q([1-4])$/.exec(trimmed);
    if (quarterMatch) return `${quarterMatch[1]}-${quarterMatch[2]}`;
    return trimmed.replaceAll("-", "").replaceAll("/", "");
  };

  return normalize(left).localeCompare(normalize(right), "en", {
    numeric: true,
  });
}

function sortByReportPeriod<T extends { endDate: string }>(
  items: T[],
  order: ReportPeriodOrder,
) {
  return [...items].sort((left, right) => {
    const comparison = compareReportPeriods(left.endDate, right.endDate);
    return order === "asc" ? comparison : -comparison;
  });
}

function ReportPeriodOrderSelect(props: {
  id: string;
  value: ReportPeriodOrder;
  onChange: (value: ReportPeriodOrder) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--app-text-muted)]">
      <span>报告期排序</span>
      <select
        id={props.id}
        value={props.value}
        onChange={(event) =>
          props.onChange(event.target.value as ReportPeriodOrder)
        }
        className="app-input w-auto min-w-[172px] py-1.5"
      >
        <option value="asc">按报告期升序排列</option>
        <option value="desc">按报告期降序排列</option>
      </select>
    </label>
  );
}

function chartLevels(
  bars: Array<{ tradeDate: string; close: number; volume: number }>,
) {
  const closes = bars.map((bar) => bar.close);
  const average = (windowSize: number) =>
    bars.map((bar, index) => ({
      tradeDate: bar.tradeDate,
      value:
        closes
          .slice(Math.max(0, index - windowSize + 1), index + 1)
          .reduce((sum, item) => sum + item, 0) /
        Math.min(index + 1, windowSize),
    }));
  const latest = bars.slice(-60);
  return {
    ema5: average(5),
    ema20: average(20),
    ema60: average(60),
    ema120: average(120),
    recentHigh60d: Math.max(...latest.map((bar) => bar.close), 0),
    recentLow20d: Math.min(...bars.slice(-20).map((bar) => bar.close), 0),
    avgVolume20:
      bars.slice(-20).reduce((sum, bar) => sum + bar.volume, 0) /
      Math.max(1, bars.slice(-20).length),
    volumeSpikeDates: [],
  };
}

function QuestionList(props: { title: string; items: string[] }) {
  return (
    <aside className="border-l border-[var(--app-border-soft)] pl-5">
      <h3 className="text-sm font-medium text-[var(--app-text)]">
        {props.title}
      </h3>
      <ol className="mt-3 grid gap-3 text-sm leading-6 text-[var(--app-text-muted)]">
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    </aside>
  );
}

export function CompanyOverviewPanel(props: {
  stockCode?: string;
  onStartResearch: (companyName: string, stockCode: string) => void;
}) {
  const router = useRouter();
  const [keyword, setKeyword] = useState("");
  const deferredKeyword = useDeferredValue(keyword.trim());
  const [timeframe, setTimeframe] = useState<TimingTimeframe>("DAILY");
  const [financialMode, setFinancialMode] = useState<FinancialMode>("quarter");
  const [financialPeriodOrder, setFinancialPeriodOrder] =
    useState<ReportPeriodOrder>("asc");
  const [financialPeriodCount, setFinancialPeriodCount] = useState(8);
  const [financialMetricIds, setFinancialMetricIds] = useState(
    defaultFinancialMetricIds,
  );
  const [financialMetricSearch, setFinancialMetricSearch] = useState("");
  const stockSearch = api.screening.searchStocks.useQuery(
    { keyword: deferredKeyword, limit: 8 },
    { enabled: deferredKeyword.length > 0, refetchOnWindowFocus: false },
  );
  const overview = api.companyOverview.get.useQuery(
    { stockCode: props.stockCode ?? "000001", metricIds: financialMetricIds },
    { enabled: Boolean(props.stockCode), refetchOnWindowFocus: false },
  );
  const financialCatalog = api.screening.listIndicatorCatalog.useQuery(
    undefined,
    { refetchOnWindowFocus: false },
  );
  const bars = api.companyOverview.bars.useQuery(
    { stockCode: props.stockCode ?? "000001", timeframe },
    { enabled: Boolean(props.stockCode), refetchOnWindowFocus: false },
  );
  const data = overview.data;
  const usableBars = bars.data?.bars ?? [];
  const levels = useMemo(() => chartLevels(usableBars), [usableBars]);
  const visibleFinancials = useMemo(() => {
    const source =
      financialMode === "quarter"
        ? (data?.financials.quarters ?? [])
        : (data?.financials.annuals ?? []);
    return sortByReportPeriod(
      source.slice(0, financialPeriodCount),
      financialPeriodOrder,
    );
  }, [data, financialMode, financialPeriodCount, financialPeriodOrder]);
  const financialMetricOptions = useMemo(() => {
    const query = financialMetricSearch.trim().toLocaleLowerCase("zh-CN");
    if (!query) return [];
    return (financialCatalog.data?.items ?? [])
      .filter((item) =>
        [item.name, item.id, ...item.keywords]
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(query),
      )
      .slice(0, 12);
  }, [financialCatalog.data, financialMetricSearch]);

  useEffect(() => {
    try {
      const stored = JSON.parse(
        window.localStorage.getItem(financialMetricPreferenceKey) ?? "null",
      ) as unknown;
      if (Array.isArray(stored)) {
        const ids = stored
          .filter((item): item is string => typeof item === "string")
          .slice(0, 30);
        if (ids.length > 0) setFinancialMetricIds(ids);
      }
    } catch {
      window.localStorage.removeItem(financialMetricPreferenceKey);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      financialMetricPreferenceKey,
      JSON.stringify(financialMetricIds),
    );
  }, [financialMetricIds]);

  function formatFinancialValue(
    value: number | null | undefined,
    metric: NonNullable<typeof data>["financials"]["metrics"][number],
  ) {
    if (metric.valueKind === "currency") return amount(value);
    if (metric.valueKind === "ratio")
      return number(value == null ? value : value * 100, "%");
    return number(value, metric.displayUnit ? ` ${metric.displayUnit}` : "");
  }

  const chooseStock = (stock: { stockCode: string }) => {
    setKeyword("");
    router.push(companyOverviewHref(stock.stockCode));
  };

  return (
    <div className="grid gap-6">
      <Panel title="公司概况">
        <div className="grid gap-3">
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="输入股票代码或名称"
            className="app-input"
          />
          {deferredKeyword ? (
            <div className="overflow-hidden rounded-[8px] border border-[var(--app-border-soft)]">
              {stockSearch.data?.map((stock) => (
                <button
                  key={stock.stockCode}
                  type="button"
                  onClick={() => chooseStock(stock)}
                  className="flex w-full items-center justify-between border-b border-[var(--app-border-soft)] px-4 py-3 text-left text-sm last:border-0 hover:bg-[var(--app-panel-soft)]"
                >
                  <span>{stock.stockName}</span>
                  <span className="app-data text-[var(--app-text-muted)]">
                    {stock.stockCode}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </Panel>
      {!props.stockCode ? (
        <Panel title="选择公司">
          <p className="text-sm text-[var(--app-text-muted)]">
            搜索并选择一只 A 股公司，即可加载经营、财务和行情数据。
          </p>
        </Panel>
      ) : null}
      {overview.isLoading ? (
        <Panel title="正在加载">
          <p className="text-sm text-[var(--app-text-muted)]">
            正在汇集公司基础资料与财务报表。
          </p>
        </Panel>
      ) : null}
      {overview.isError ? (
        <Panel title="加载失败">
          <p className="text-sm text-[var(--app-danger)]">
            {overview.error.message}
          </p>
        </Panel>
      ) : null}
      {data ? (
        <>
          <Panel
            title={`${data.companyName} (${data.stockCode})`}
            actions={
              <button
                type="button"
                className="app-button app-button-primary"
                onClick={() =>
                  props.onStartResearch(data.companyName, data.stockCode)
                }
              >
                开始公司研究
              </button>
            }
          >
            <div className="flex flex-wrap gap-2">
              <StatusPill label={data.exchange || "A股"} tone="info" />
              <StatusPill label={`数据更新 ${data.updatedAt.slice(0, 10)}`} />
            </div>
          </Panel>
          <Panel title="公司简介">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="grid gap-5 text-sm leading-7 text-[var(--app-text-muted)]">
                <section>
                  <h3 className="text-sm font-medium text-[var(--app-text)]">
                    公司介绍
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap">
                    {data.profile.introduction ?? "暂无数据"}
                  </p>
                </section>
                <section>
                  <h3 className="text-sm font-medium text-[var(--app-text)]">
                    主要业务及产品
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap">
                    {data.profile.mainBusiness ?? "暂无数据"}
                  </p>
                </section>
                <section>
                  <h3 className="text-sm font-medium text-[var(--app-text)]">
                    经营范围
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap">
                    {data.profile.businessScope ?? "暂无数据"}
                  </p>
                </section>
              </div>
              <QuestionList
                title="建议继续研究"
                items={data.questions.profile}
              />
            </div>
          </Panel>
          <Panel title="财务指标">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="overflow-x-auto">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--app-border-soft)] pb-4">
                  <div className="flex items-center">
                    {(
                      [
                        ["quarter", "季报"],
                        ["annual", "年报"],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        aria-pressed={financialMode === mode}
                        onClick={() => setFinancialMode(mode)}
                        className={cn(
                          "border border-[var(--app-border-soft)] px-3 py-1.5 text-sm transition-colors first:rounded-l-[6px] last:-ml-px last:rounded-r-[6px]",
                          financialMode === mode
                            ? "bg-[var(--app-text-strong)] text-[var(--app-bg)]"
                            : "text-[var(--app-text-muted)] hover:bg-[var(--app-panel-soft)] hover:text-[var(--app-text)]",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-[var(--app-text-muted)]">
                    <label htmlFor="financial-period-count">报告期数</label>
                    <select
                      id="financial-period-count"
                      aria-label="报告期数"
                      value={financialPeriodCount}
                      onChange={(event) =>
                        setFinancialPeriodCount(Number(event.target.value))
                      }
                      className="app-input w-auto min-w-[84px] py-1.5"
                    >
                      <option value={4}>4 期</option>
                      <option value={8}>8 期</option>
                    </select>
                    <span className="text-xs text-[var(--app-text-subtle)]">
                      {visibleFinancials.length} / {financialPeriodCount} 期
                    </span>
                  </div>
                  <ReportPeriodOrderSelect
                    id="financial-period-order"
                    value={financialPeriodOrder}
                    onChange={setFinancialPeriodOrder}
                  />
                </div>
                <div className="mb-4 border-b border-[var(--app-border-soft)] pb-4">
                  <input
                    value={financialMetricSearch}
                    onChange={(event) =>
                      setFinancialMetricSearch(event.target.value)
                    }
                    className="app-input"
                    placeholder="搜索财务指标"
                  />
                  {financialMetricOptions.length > 0 ? (
                    <div className="mt-2 grid gap-1 border border-[var(--app-border-soft)] p-2 sm:grid-cols-2">
                      {financialMetricOptions.map((metric) => {
                        const checked = financialMetricIds.includes(metric.id);
                        return (
                          <label
                            key={metric.id}
                            className="flex items-start gap-2 px-2 py-1.5 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setFinancialMetricIds((current) =>
                                  checked
                                    ? current.filter((id) => id !== metric.id)
                                    : current.length < 30
                                      ? [...current, metric.id]
                                      : current,
                                )
                              }
                            />
                            <span>
                              <span className="block text-[var(--app-text)]">
                                {metric.name}
                              </span>
                              <span className="font-mono text-xs text-[var(--app-text-subtle)]">
                                {metric.id}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <table className="min-w-[720px] text-sm">
                  <thead className="border-b border-[var(--app-border-soft)] text-left text-[var(--app-text-muted)]">
                    <tr>
                      <th className="sticky left-0 bg-[var(--app-panel)] px-2 py-2">
                        指标
                      </th>
                      {visibleFinancials.map((item) => (
                        <th
                          key={item.endDate}
                          className="app-data whitespace-nowrap px-2 py-2 text-right"
                        >
                          {reportPeriodLabel(item.endDate, financialMode)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.financials.metrics.map((metric) => (
                      <tr
                        key={metric.id}
                        className="border-b border-[var(--app-border-soft)]"
                      >
                        <th
                          scope="row"
                          className="sticky left-0 bg-[var(--app-panel)] px-2 py-2 text-left font-medium text-[var(--app-text)]"
                        >
                          {metric.name}
                        </th>
                        {visibleFinancials.map((item) => (
                          <td
                            key={`${metric.id}-${item.endDate}`}
                            className="app-data whitespace-nowrap px-2 py-2 text-right text-[var(--app-text-muted)]"
                          >
                            {formatFinancialValue(
                              item.values[metric.id],
                              metric,
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 flex flex-wrap gap-2">
                  {data.financials.metrics.map((metric) => (
                    <button
                      key={metric.id}
                      type="button"
                      className="app-button"
                      onClick={() =>
                        setFinancialMetricIds((current) =>
                          current.filter((id) => id !== metric.id),
                        )
                      }
                    >
                      {metric.name} ×
                    </button>
                  ))}
                </div>
              </div>
              <QuestionList
                title="建议继续研究"
                items={data.questions.financials}
              />
            </div>
          </Panel>
          <Panel title="主营业务构成">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-[var(--app-border-soft)] text-left text-[var(--app-text-muted)]">
                    <tr>
                      <th className="px-2 py-2">业务</th>
                      <th className="px-2 py-2">角色</th>
                      <th className="px-2 py-2">收入增速</th>
                      <th className="px-2 py-2">
                        最近三年收入 / 占比 / 毛利率
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.businesses.map((business) => (
                      <tr
                        key={business.name}
                        className="border-b border-[var(--app-border-soft)]"
                      >
                        <td className="px-2 py-3">{business.name}</td>
                        <td className="px-2 py-3">
                          <StatusPill label={business.role} tone="info" />
                        </td>
                        <td className="px-2 py-3">
                          {number(business.revenueGrowth, "%")}
                        </td>
                        <td className="px-2 py-3">
                          {business.history
                            .map(
                              (item) =>
                                `${item.year}: ${amount(item.revenue)} / ${number(item.revenueShare, "%")} / ${number(item.grossMargin, "%")}`,
                            )
                            .join("；")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <QuestionList
                title="建议继续研究"
                items={data.questions.businesses}
              />
            </div>
          </Panel>
          <Panel title="K线图">
            {bars.isError ? (
              <p className="text-sm text-[var(--app-danger)]">
                {bars.error.message}
              </p>
            ) : (
              <TimingReportChart
                bars={usableBars}
                chartLevels={levels}
                timeframe={timeframe}
                onTimeframeChange={setTimeframe}
                seriesLoading={bars.isLoading}
              />
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}

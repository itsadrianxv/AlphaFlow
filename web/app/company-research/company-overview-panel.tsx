"use client";

import { useRouter } from "next/navigation";
import { useDeferredValue, useMemo, useState } from "react";
import { Panel, StatusPill } from "~/app/_components/ui";
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
  const stockSearch = api.screening.searchStocks.useQuery(
    { keyword: deferredKeyword, limit: 8 },
    { enabled: deferredKeyword.length > 0, refetchOnWindowFocus: false },
  );
  const overview = api.companyOverview.get.useQuery(
    { stockCode: props.stockCode ?? "000001" },
    { enabled: Boolean(props.stockCode), refetchOnWindowFocus: false },
  );
  const bars = api.companyOverview.bars.useQuery(
    { stockCode: props.stockCode ?? "000001", timeframe },
    { enabled: Boolean(props.stockCode), refetchOnWindowFocus: false },
  );
  const data = overview.data;
  const usableBars = bars.data?.bars ?? [];
  const levels = useMemo(() => chartLevels(usableBars), [usableBars]);

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
                <table className="min-w-full text-sm">
                  <thead className="border-b border-[var(--app-border-soft)] text-left text-[var(--app-text-muted)]">
                    <tr>
                      <th className="px-2 py-2">报告期</th>
                      <th className="px-2 py-2">营收</th>
                      <th className="px-2 py-2">归母净利</th>
                      <th className="px-2 py-2">扣非净利</th>
                      <th className="px-2 py-2">毛利率</th>
                      <th className="px-2 py-2">净利率</th>
                      <th className="px-2 py-2">经营现金流</th>
                      <th className="px-2 py-2">自由现金流</th>
                      <th className="px-2 py-2">ROE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.financials.quarters.map((item) => (
                      <tr
                        key={item.endDate}
                        className="border-b border-[var(--app-border-soft)]"
                      >
                        <td className="px-2 py-2">{item.endDate}</td>
                        <td className="px-2 py-2">{amount(item.revenue)}</td>
                        <td className="px-2 py-2">{amount(item.netProfit)}</td>
                        <td className="px-2 py-2">
                          {amount(item.deductedNetProfit)}
                        </td>
                        <td className="px-2 py-2">
                          {number(item.grossMargin, "%")}
                        </td>
                        <td className="px-2 py-2">
                          {number(item.netMargin, "%")}
                        </td>
                        <td className="px-2 py-2">
                          {amount(item.operatingCashflow)}
                        </td>
                        <td className="px-2 py-2">
                          {amount(item.freeCashflow)}
                        </td>
                        <td className="px-2 py-2">{number(item.roe, "%")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-[var(--app-text-subtle)]">
                  自由现金流 = 经营活动现金流量净额 - 购建长期资产支付的现金。
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <StatusPill
                    label={`PE ${number(data.financials.valuation.pe)}`}
                  />
                  <StatusPill
                    label={`PB ${number(data.financials.valuation.pb)}`}
                  />
                  <StatusPill
                    label={`PS ${number(data.financials.valuation.ps)}`}
                  />
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

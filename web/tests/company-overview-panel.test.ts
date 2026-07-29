import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "app/company-research/company-overview-panel.tsx",
  "utf8",
);

describe("公司概况财务与主营业务布局", () => {
  it("按当前股票和周期加载模型预测并叠加到 K 线图", () => {
    expect(source).toContain("api.companyOverview.forecast.useQuery(");
    expect(source).toContain(
      "forecast={kronosForecast.data?.forecast ?? undefined}",
    );
    expect(source).toContain("retry: false");
  });

  it("按动态指标行和报告期列展示财务数据，并格式化报告期", () => {
    expect(source).toContain("defaultFinancialMetricIds");
    expect(source).toContain("data.financials.metrics.map((metric)");
    expect(source).toContain("visibleFinancials.map((item)");
    expect(source).toContain("item.values[metric.id]");
    expect(source).toContain("reportPeriodLabel(item.endDate, financialMode)");
    expect(source).toContain("financialMetricPreferenceKey");
    expect(source).toContain('placeholder="搜索财务指标"');
    expect(source).not.toContain("financials.valuation");
    expect(source).not.toContain("{item.endDate}</td>");
  });

  it("默认使用季报八期，并允许切换年报和报告期数", () => {
    expect(source).toContain('useState<FinancialMode>("quarter")');
    expect(source).toContain("useState(8)");
    expect(source).toContain('mode === "annual"');
    expect(source).toContain("setFinancialMode(mode)");
    expect(source).toContain("setFinancialPeriodCount(Number(event.target.value))");
    expect(source).toContain("<option value={4}>4 期</option>");
    expect(source).toContain("<option value={8}>8 期</option>");
    expect(source).toContain("source.slice(0, financialPeriodCount)");
  });

  it("20日低点不把零混入正常价格的最小值计算", () => {
    expect(source).toContain("const recent20 = bars.slice(-20);");
    expect(source).toContain(
      "recent20.length > 0 ? Math.min(...recent20.map((bar) => bar.close)) : 0",
    );
    expect(source).not.toContain(
      "Math.min(...bars.slice(-20).map((bar) => bar.close), 0)",
    );
  });

  it("允许两张表按报告期升序或降序排列，且默认升序", () => {
    expect(source).toContain('useState<ReportPeriodOrder>("asc")');
    expect(source).toContain("sortByReportPeriod(");
    expect(source).toContain("financialPeriodOrder");
    expect(source).toContain("businessPeriodOrder");
    expect(source).toContain('id="financial-period-order"');
    expect(source).toContain('id="business-period-order"');
    expect(source).toContain("按报告期升序排列");
    expect(source).toContain("按报告期降序排列");
  });

  it("展开最近三年的九个主营业务指标，并直接显示角色文本", () => {
    expect(source).toContain("{year}营收");
    expect(source).toContain("{year}占营收比例");
    expect(source).toContain("{year}毛利率");
    expect(source).not.toContain("最近三年收入 / 占比 / 毛利率");
    expect(source).not.toContain("<StatusPill label={business.role}");
    expect(source).toContain("{business.role}");
  });
});

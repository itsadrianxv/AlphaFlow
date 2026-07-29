import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "app/company-research/company-overview-panel.tsx",
  "utf8",
);

describe("公司概况财务指标布局", () => {
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

  it("允许财务表按报告期升序或降序排列，且默认升序", () => {
    expect(source).toContain('useState<ReportPeriodOrder>("asc")');
    expect(source).toContain("sortByReportPeriod(");
    expect(source).toContain("financialPeriodOrder");
    expect(source).toContain('id="financial-period-order"');
    expect(source).toContain("按报告期升序排列");
    expect(source).toContain("按报告期降序排列");
  });
});

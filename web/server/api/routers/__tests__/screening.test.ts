import { describe, expect, it } from "vitest";
import {
  createFormulaInputSchema,
  createWorkspaceInputSchema,
  searchStocksInputSchema,
  updateWorkspaceInputSchema,
  workspaceFilterRuleSchema,
  workspaceQuerySchema,
  workspaceTimeConfigSchema,
} from "~/contracts/screening";

describe("screening contracts", () => {
  it("accepts valid stock search input", () => {
    const result = searchStocksInputSchema.safeParse({
      keyword: "茅台",
      limit: 10,
    });

    expect(result.success).toBe(true);
  });

  it("rejects workspace queries above the 20-stock limit", () => {
    const result = workspaceQuerySchema.safeParse({
      stockCodes: Array.from({ length: 21 }, (_, index) => `${600000 + index}`),
      indicatorIds: ["revenue"],
      formulaIds: [],
      timeConfig: {
        periodType: "ANNUAL",
        rangeMode: "PRESET",
        presetKey: "3Y",
      },
    });

    expect(result.success).toBe(false);
  });

  it("requires preset keys compatible with the selected period type", () => {
    const annualResult = workspaceTimeConfigSchema.safeParse({
      periodType: "ANNUAL",
      rangeMode: "PRESET",
      presetKey: "8Q",
    });

    const quarterlyResult = workspaceTimeConfigSchema.safeParse({
      periodType: "QUARTERLY",
      rangeMode: "PRESET",
      presetKey: "8Q",
    });

    expect(annualResult.success).toBe(false);
    expect(quarterlyResult.success).toBe(true);
  });

  it("requires complete custom time ranges", () => {
    const result = workspaceTimeConfigSchema.safeParse({
      periodType: "QUARTERLY",
      rangeMode: "CUSTOM",
      customStart: "2024Q1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects formulas with more than five target indicators", () => {
    const result = createFormulaInputSchema.safeParse({
      name: "超长公式",
      expression: "var[0] + var[1]",
      targetIndicators: ["A", "B", "C", "D", "E", "F"],
      categoryId: "custom",
    });

    expect(result.success).toBe(false);
  });

  it("locks local filters to latest snapshot scope", () => {
    const result = workspaceFilterRuleSchema.safeParse({
      metricId: "revenue",
      operator: ">=",
      value: 10,
      valueType: "NUMBER",
      applyScope: "LATEST_DEFAULT",
    });

    expect(result.success).toBe(true);
  });

  it("accepts a complete workspace payload with saved snapshot metadata", () => {
    const result = createWorkspaceInputSchema.safeParse({
      name: "高质量成长",
      description: "小批量筛选工作台",
      stockCodes: ["600519", "000001"],
      indicatorIds: ["revenue", "net_profit_parent"],
      formulaIds: [],
      timeConfig: {
        periodType: "ANNUAL",
        rangeMode: "PRESET",
        presetKey: "5Y",
      },
      filterRules: [
        {
          metricId: "revenue",
          operator: ">",
          value: 100,
          valueType: "NUMBER",
          applyScope: "LATEST_DEFAULT",
        },
      ],
      sortState: {
        metricId: "revenue",
        direction: "desc",
      },
      columnState: {
        hiddenMetricIds: [],
        pinnedMetricIds: ["stockCode", "stockName"],
      },
      resultSnapshot: {
        periods: ["2022", "2023", "2024"],
        indicatorMeta: [
          {
            id: "revenue",
            name: "营业收入",
            valueType: "NUMBER",
            periodScope: "series",
            retrievalMode: "statement_series",
          },
        ],
        rows: [
          {
            stockCode: "600519",
            stockName: "贵州茅台",
            metrics: {
              revenue: {
                byPeriod: {
                  "2022": 1200,
                  "2023": 1300,
                  "2024": 1400,
                },
              },
            },
          },
        ],
        latestSnapshotRows: [
          {
            stockCode: "600519",
            stockName: "贵州茅台",
            metrics: {
              revenue: {
                value: 1400,
                period: "2024",
              },
            },
          },
        ],
        warnings: [],
        dataStatus: "READY",
        provider: "tushare",
      },
      lastFetchedAt: "2026-03-20T10:00:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("allows partial workspace updates", () => {
    const result = updateWorkspaceInputSchema.safeParse({
      id: "workspace-1",
      name: "更新后的工作台",
    });

    expect(result.success).toBe(true);
  });
});

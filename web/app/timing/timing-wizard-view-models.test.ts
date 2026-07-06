import { describe, expect, it } from "vitest";
import {
  buildRiskSummary,
  createEmptyPortfolioPositionDraft,
  createPresetConfigForStyle,
  inferStrategyStyleKey,
  parsePortfolioForm,
} from "~/app/timing/timing-wizard-view-models";

describe("timing wizard view models", () => {
  it("parses structured portfolio rows into the existing snapshot payload", () => {
    const result = parsePortfolioForm({
      name: "核心组合",
      baseCurrency: "CNY",
      cash: "30000",
      totalCapital: "100000",
      maxSingleNamePct: "12",
      maxThemeExposurePct: "28",
      defaultProbePct: "3",
      maxPortfolioRiskBudgetPct: "20",
      positions: [
        {
          ...createEmptyPortfolioPositionDraft({
            stockCode: "600519",
            stockName: "贵州茅台",
            market: "SH",
          }),
          quantity: "100",
          costBasis: "1688.5",
          currentWeightPct: "9.5",
          themes: "消费, 白酒",
          invalidationPrice: "1500",
          plannedHoldingDays: "90",
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.payload.positions[0]).toMatchObject({
      stockCode: "600519",
      stockName: "贵州茅台",
      quantity: 100,
      costBasis: 1688.5,
      currentWeightPct: 9.5,
      themes: ["消费", "白酒"],
      invalidationPrice: 1500,
      plannedHoldingDays: 90,
    });
  });

  it("returns field-level row errors when a partially filled position is invalid", () => {
    const draft = createEmptyPortfolioPositionDraft();
    const result = parsePortfolioForm({
      name: "核心组合",
      baseCurrency: "CNY",
      cash: "30000",
      totalCapital: "100000",
      maxSingleNamePct: "12",
      maxThemeExposurePct: "28",
      defaultProbePct: "3",
      maxPortfolioRiskBudgetPct: "20",
      positions: [
        {
          ...draft,
          quantity: "10",
          costBasis: "bad",
          currentWeightPct: "150",
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.errors.rows[draft.clientId]).toMatchObject({
      stockCode: "请选择一只股票。",
      costBasis: "请输入有效的成本价。",
      currentWeightPct: "当前仓位需在 0 到 100 之间。",
    });
  });

  it("maps strategy styles from saved preset wording and thresholds", () => {
    expect(
      inferStrategyStyleKey({
        name: "稳健日频预设",
      }),
    ).toBe("steady");
    expect(
      inferStrategyStyleKey({
        config: createPresetConfigForStyle("aggressive"),
      }),
    ).toBe("aggressive");
  });

  it("builds a readable risk summary from current portfolio state and latest reasoning", () => {
    const summary = buildRiskSummary({
      cash: "28000",
      totalCapital: "100000",
      maxSingleNamePct: "12",
      maxThemeExposurePct: "25",
      defaultProbePct: "3",
      maxPortfolioRiskBudgetPct: "20",
      positions: [
        {
          currentWeightPct: "14",
          themes: "AI, 算力",
        },
        {
          currentWeightPct: "16",
          themes: "AI",
        },
      ],
      reasoning: {
        signalContext: {} as never,
        marketContext: {} as never,
        positionContext: {} as never,
        feedbackContext: {} as never,
        actionRationale: "",
        riskPlan: {
          portfolioRiskBudgetPct: 12,
          maxSingleNamePct: 10,
          defaultProbePct: 2,
          blockedActions: ["ADD"],
          correlationWarnings: [],
          notes: ["Available cash is 28% of total capital."],
        },
      },
    });

    expect(summary.availableCashPct).toBe(28);
    expect(summary.maxSingleNamePct).toBe(10);
    expect(summary.defaultProbePct).toBe(2);
    expect(summary.blockedActions).toEqual(["ADD"]);
    expect(summary.crowdedExposures[0]).toContain("AI");
  });
});

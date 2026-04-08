import { describe, expect, it } from "vitest";
import { normalizeFormulaExpression } from "~/server/api/routers/screening-formula-normalizer";

describe("normalizeFormulaExpression", () => {
  const catalogItems = [
    {
      id: "roe_report",
      name: "ROE(报告期)",
      categoryId: "profitability",
      valueType: "PERCENT",
      periodScope: "series",
      retrievalMode: "statement_series",
    },
    {
      id: "eps_report",
      name: "EPS(报告期)",
      categoryId: "profitability",
      valueType: "NUMBER",
      periodScope: "series",
      retrievalMode: "statement_series",
    },
  ] as const;

  it("converts selected metric placeholders to safe var indexes", () => {
    expect(
      normalizeFormulaExpression({
        expression: "[ROE(报告期)] + [EPS(报告期)]",
        targetIndicatorIds: ["roe_report", "eps_report"],
        catalogItems,
      }),
    ).toBe("var[0] + var[1]");
  });

  it("rejects placeholders that are not part of selected target indicators", () => {
    expect(() =>
      normalizeFormulaExpression({
        expression: "[ROE(报告期)] + [PB]",
        targetIndicatorIds: ["roe_report", "eps_report"],
        catalogItems,
      }),
    ).toThrow(/PB/);
  });
});

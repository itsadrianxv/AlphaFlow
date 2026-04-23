import { describe, expect, it } from "vitest";
import {
  indicatorCatalogItemSchema,
  indicatorCategorySchema,
} from "~/modules/screening/contracts/screening";

describe("screening contracts", () => {
  it("accepts expanded indicator catalog metadata", () => {
    expect(
      indicatorCatalogItemSchema.parse({
        id: "ps_ttm",
        name: "PS(TTM)",
        categoryId: "valuation_capital",
        valueType: "NUMBER",
        periodScope: "latest_only",
        retrievalMode: "latest_only",
        description: "估值与市值",
        sortOrder: 20,
        keywords: ["ps", "市销率", "市销率ttm"],
        sourceDataset: "daily_basic",
      }),
    ).toMatchObject({
      id: "ps_ttm",
      sortOrder: 20,
      sourceDataset: "daily_basic",
    });
  });

  it("accepts expanded indicator category metadata", () => {
    expect(
      indicatorCategorySchema.parse({
        id: "cashflow_quality",
        name: "现金流质量",
        indicatorCount: 4,
        sortOrder: 5,
      }),
    ).toMatchObject({
      id: "cashflow_quality",
      sortOrder: 5,
    });
  });
});

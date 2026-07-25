import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import {
  buildSellSideForecastDetail,
  buildSellSideRevisions,
  type SellSideForecastRow,
} from "~/server/application/overview/sell-side-overview-service";

function forecast(
  overrides: Partial<SellSideForecastRow> = {},
): SellSideForecastRow {
  return {
    tsCode: "000001.SZ",
    name: "平安银行",
    reportDate: "20990101",
    reportTitle: "更新预测",
    orgName: "甲证券",
    quarter: "2099Q4",
    eps: 1,
    netProfit: 100,
    rating: "买入",
    minPrice: 10,
    maxPrice: 12,
    ...overrides,
  };
}

describe("卖方预期聚合", () => {
  it("按机构最近两次 EPS 的中位数筛选并排序上修公司", () => {
    const revisions = buildSellSideRevisions([
      forecast({ reportDate: "20990101", eps: 1, orgName: "甲证券" }),
      forecast({ reportDate: "20990201", eps: 1.2, orgName: "甲证券" }),
      forecast({ reportDate: "20990101", eps: 1, orgName: "乙证券" }),
      forecast({ reportDate: "20990201", eps: 1.4, orgName: "乙证券", rating: null, minPrice: null, maxPrice: null }),
      forecast({ tsCode: "000002", name: "万科A", reportDate: "20990101", eps: 1 }),
      forecast({ tsCode: "000002", name: "万科A", reportDate: "20990201", eps: 0.9 }),
    ]);

    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      stockCode: "000001",
      coverageCount: 2,
      targetPriceMin: 10,
      targetPriceMax: 12,
    });
    expect(revisions[0]?.revisionPct).toBeCloseTo(30);
  });

  it("将 TuShare 代码转换为页面使用的 6 位股票代码", () => {
    const revisions = buildSellSideRevisions([
      forecast({ tsCode: "600519.SH", reportDate: "20990101", eps: 1 }),
      forecast({ tsCode: "600519.SH", reportDate: "20990201", eps: 1.2 }),
    ]);

    expect(revisions[0]?.stockCode).toBe("600519");
  });

  it("按预测期分组机构详情，并保留无前次可比记录", () => {
    const detail = buildSellSideForecastDetail("000001", [
      forecast({ reportDate: "20990101", eps: 1, netProfit: 100 }),
      forecast({ reportDate: "20990201", eps: 1.2, netProfit: 120 }),
      forecast({ orgName: "乙证券", reportDate: "20990301", eps: 2, netProfit: null, rating: null, minPrice: null, maxPrice: null }),
    ]);

    expect(detail.periods).toHaveLength(1);
    expect(detail.periods[0]?.forecasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          orgName: "甲证券",
          eps: 1.2,
          previousEps: 1,
          epsChangePct: expect.closeTo(20),
          netProfitChangePct: expect.closeTo(20),
        }),
        expect.objectContaining({
          orgName: "乙证券",
          previousEps: null,
          epsChangePct: null,
          netProfitChangePct: null,
          rating: null,
        }),
      ]),
    );
  });
});

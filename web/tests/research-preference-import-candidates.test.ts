import { describe, expect, it } from "vitest";
import { buildResearchPreferenceImportCandidates } from "~/server/infrastructure/research-preference/research-preference-import-candidates";

describe("研究关注导入候选", () => {
  it("同一公司只生成一个目标并保留收藏公司与各自选股来源", () => {
    const candidates = buildResearchPreferenceImportCandidates({
      companies: [{ stockCode: "000001", companyName: "平安银行" }],
      industries: [],
      watchLists: [
        {
          name: "核心观察",
          stocks: [{ stockCode: "000001", stockName: "平安银行" }],
        },
        {
          name: "财报跟踪",
          stocks: [{ stockCode: "000001", stockName: "平安银行" }],
        },
      ],
    });

    expect(candidates).toEqual([
      {
        targetType: "COMPANY",
        targetKey: "000001",
        source: "SAVED_COMPANY",
        sources: [
          { source: "SAVED_COMPANY" },
          { source: "WATCHLIST", name: "核心观察" },
          { source: "WATCHLIST", name: "财报跟踪" },
        ],
        label: "平安银行",
      },
    ]);
  });
});

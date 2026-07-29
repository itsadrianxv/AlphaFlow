import { describe, expect, it } from "vitest";
import { portfolioCompositionSchema, timingResearchRunInputSchema } from "~/contracts/timing-research";

const positions = [
  { stockCode: "000001", stockName: "平安银行", weightPct: 60, sector: "银行", themes: ["红利"] },
  { stockCode: "600519", stockName: "贵州茅台", weightPct: 40, sector: "食品饮料", themes: ["消费"] },
];

describe("择时研究输入契约", () => {
  it("接受合计为 100% 的相对权重组合", () => {
    expect(portfolioCompositionSchema.safeParse({ name: "研究组合", positions }).success).toBe(true);
  });

  it("拒绝权重不满足约束和重复股票", () => {
    expect(portfolioCompositionSchema.safeParse({ name: "研究组合", positions: positions.map((item) => ({ ...item, weightPct: 30 })) }).success).toBe(false);
    expect(portfolioCompositionSchema.safeParse({ name: "研究组合", positions: [positions[0], positions[0]] }).success).toBe(false);
  });

  it("严格拒绝资产、现金、数量、成本和风险偏好字段", () => {
    const base = { mode: "PORTFOLIO", targets: [], portfolioComposition: { name: "研究组合", positions }, strategySelection: { kind: "SYSTEM", horizon: "SWING" }, analysisDate: { mode: "LATEST_COMPLETE" } };
    for (const forbidden of [{ totalCapital: 100_000 }, { cash: 10_000 }, { quantity: 100 }, { cost: 12.3 }, { riskProfile: "BALANCED" }]) {
      expect(timingResearchRunInputSchema.safeParse({ ...base, ...forbidden }).success).toBe(false);
    }
  });
});

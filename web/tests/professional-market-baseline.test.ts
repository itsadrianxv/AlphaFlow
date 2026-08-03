import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  getBaselineItemsForDomain,
  getBaselineItemsForPhase,
  MARKET_BASELINE_DOMAIN_IDS,
  MARKET_BASELINE_PHASES,
  PROFESSIONAL_MARKET_BASELINE,
} from "~/contracts/professional-market-baseline";

describe("专业市场基线时段走廊 contract", () => {
  it("四个阶段均覆盖六类信息域，且每个阶段内部排序稳定", () => {
    for (const phase of MARKET_BASELINE_PHASES) {
      const phaseItems = getBaselineItemsForPhase(phase);
      expect(phaseItems.map((item) => item.domain)).toEqual(
        MARKET_BASELINE_DOMAIN_IDS,
      );
      expect(phaseItems).toHaveLength(6);
    }
  });

  it("信息域切换不改变专业市场基线的全局内容集合与内部排序", () => {
    for (const phase of MARKET_BASELINE_PHASES) {
      const baselineIds = getBaselineItemsForDomain(phase, "all").map(
        (item) => item.id,
      );

      for (const domain of MARKET_BASELINE_DOMAIN_IDS) {
        expect(getBaselineItemsForDomain(phase, domain).map((item) => item.id))
          .toEqual(baselineIds);
      }
    }
  });

  it("概览图表提供广度、资金和关键节点，并使用同一数据覆盖与截止点", () => {
    for (const phase of MARKET_BASELINE_PHASES) {
      const chart = PROFESSIONAL_MARKET_BASELINE.charts[phase];
      const phaseItems = getBaselineItemsForPhase(phase);

      expect(chart.coverageId).toContain("baseline-coverage-20260803");
      expect(chart.actualDataCutoff).toBeTruthy();
      expect(chart.breadth.values.length).toBeGreaterThan(2);
      expect(chart.flows.length).toBeGreaterThanOrEqual(3);
      expect(chart.events.length).toBeGreaterThanOrEqual(3);
      expect(
        phaseItems.every((item) => item.asOf || chart.actualDataCutoff),
      ).toBe(true);
    }
  });

  it("明确表达旧快照回退、可选缺口和必需数据未达标", () => {
    expect(PROFESSIONAL_MARKET_BASELINE.state).toBe(
      "CURRENT_READY_WITH_LIMITATION",
    );
    expect(PROFESSIONAL_MARKET_BASELINE.limitations.join(" ")).toContain(
      "上一份可用专业市场基线快照",
    );

    const optionalGap = PROFESSIONAL_MARKET_BASELINE.items.find(
      (item) => item.id === "post-flow-optional-gap",
    );
    expect(optionalGap).toMatchObject({
      availability: "partial",
      requiredDataReady: true,
    });
    expect(optionalGap?.degradation).toContain("READY_WITH_LIMITATION");

    const intradayRequiredGap = PROFESSIONAL_MARKET_BASELINE.items.find(
      (item) => item.id === "intraday-market-permission",
    );
    expect(intradayRequiredGap).toMatchObject({
      availability: "waiting",
      requiredDataReady: false,
    });
    expect(intradayRequiredGap?.degradation).toContain("不标记为实时");
  });

  it("未校准盘中能力不得伪装成实时数据", () => {
    const intradayChart = PROFESSIONAL_MARKET_BASELINE.charts["盘中"];
    const intradayItems = getBaselineItemsForPhase("盘中");

    expect(intradayChart.status).toBe("waiting");
    expect(intradayChart.breadth.headline).toContain("未校准");
    expect(intradayChart.breadth.note).toContain("不代表实时");
    expect(
      intradayItems.some((item) => item.degradation.includes("不触发异常紧急提醒")),
    ).toBe(true);
  });
});

describe("专业市场基线页面结构", () => {
  const source = readFileSync(
    "app/market-context/prototype/market-baseline-prototype.tsx",
    "utf8",
  );

  it("页面消费统一 contract，并展示数据截止点、限制和降级状态", () => {
    expect(source).toContain("MARKET_BASELINE_ITEMS");
    expect(source).toContain("MARKET_BASELINE_CHARTS");
    expect(source).toContain("PROFESSIONAL_MARKET_BASELINE");
    expect(source).toContain("数据截至");
    expect(source).toContain("限制");
    expect(source).toContain("降级");
  });

  it("页面没有使用 eyebrow 文案或类名", () => {
    expect(source.toLowerCase()).not.toContain("eyebrow");
  });
});

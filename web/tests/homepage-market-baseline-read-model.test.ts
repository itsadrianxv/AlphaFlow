import { describe, expect, it } from "vitest";
import { homepageBaselineNumericValue } from "~/server/application/homepage/homepage-market-baseline-read-model";

describe("首页专业市场基线数值提取", () => {
  it("非数字字符串不会递归溢出", () => {
    expect(homepageBaselineNumericValue("银行")).toBeNull();
    expect(homepageBaselineNumericValue({ close: "10.5" })).toBe(10.5);

    const cyclic: Record<string, unknown> = {};
    cyclic.value = cyclic;
    expect(homepageBaselineNumericValue(cyclic)).toBeNull();
  });
});

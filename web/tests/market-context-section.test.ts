import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "app/_components/market-context-section.tsx",
  "utf8",
);

describe("宏观分析热点主题展示", () => {
  it("按板块代码去重，并限制展示数量", () => {
    expect(source).toContain("uniqueHotThemes(snapshot.hotThemes).slice(0, 5)");
    expect(source).toContain("theme.marketEvidence.boardCode");
  });

  it("不展示宏观摘要、榜单标识和热度数值", () => {
    expect(source).not.toContain("description={sectionHint.summary}");
    expect(source).not.toContain("THS 热榜第");
    expect(source).not.toContain("label={`热度");
    expect(source).toContain("removeHeatText(theme.whyHot)");
  });
});

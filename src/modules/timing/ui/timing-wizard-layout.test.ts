import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("Timing wizard layout", () => {
  it("uses a four-step investor wizard instead of the old dashboard-like timing tabs", () => {
    const tabsSource = readSource("./timing-stage-tabs.ts");
    const clientSource = readSource("./timing-client.tsx");

    expect(tabsSource).toContain('id: "source"');
    expect(tabsSource).toContain('id: "portfolio"');
    expect(tabsSource).toContain('id: "strategy"');
    expect(tabsSource).toContain('id: "results"');
    expect(tabsSource).not.toContain('id: "signals"');
    expect(tabsSource).not.toContain('id: "preset"');
    expect(tabsSource).not.toContain('id: "recommendations"');
    expect(tabsSource).not.toContain('id: "reviews"');

    expect(clientSource).toContain("StockSearchPicker");
    expect(clientSource).toContain("策略风格");
    expect(clientSource).toContain("盘点组合");
    expect(clientSource).toContain("本轮执行摘要");
  });

  it("removes raw JSON inputs from the timing setup flow", () => {
    const clientSource = readSource("./timing-client.tsx");

    expect(clientSource).not.toContain("持仓 JSON");
    expect(clientSource).not.toContain("配置 JSON");
    expect(clientSource).not.toContain("JSON.parse(positionsJson)");
    expect(clientSource).not.toContain("JSON.parse(presetConfigJson)");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync("app/page.tsx", "utf8");
const workspaceSource = readFileSync(
  "app/_components/market-baseline-workspace.tsx",
  "utf8",
);

describe("概览页面布局", () => {
  it("不再渲染宏观分析，并让新闻工作区跨越右侧洞察栏", () => {
    expect(pageSource).not.toContain("MarketContextSection");
    expect(workspaceSource).toContain("HomepageMarketBaselineWorkspace");
    expect(workspaceSource).toContain("baseline.phases");
  });

  it("只在概览页保留新对话入口，不显示会话内容", () => {
    expect(pageSource).toContain("<PiAgentComposer showConversation={false} />");
  });

  it("不在概览页展示对话历史区域", () => {
    expect(pageSource).not.toContain("historyItems=");
  });
});

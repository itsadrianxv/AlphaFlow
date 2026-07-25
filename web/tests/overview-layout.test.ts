import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("app/page.tsx", "utf8");

describe("概览页面布局", () => {
  it("不再渲染宏观分析，并让新闻工作区跨越右侧洞察栏", () => {
    expect(source).not.toContain("MarketContextSection");
    expect(source).toContain('className="min-w-0 xl:col-span-2"');
    expect(source).toContain("<ImpactMappingWorkspace signedIn={signedIn} />");
  });

  it("只在概览页保留新对话入口，不显示会话内容", () => {
    expect(source).toContain("<PiAgentComposer showConversation={false} />");
  });

  it("不在概览页展示对话历史区域", () => {
    expect(source).not.toContain("historyItems=");
  });
});

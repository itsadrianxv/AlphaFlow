import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync("app/page.tsx", "utf8");
const workspaceSource = readFileSync(
  "app/_components/overview-workspace.tsx",
  "utf8",
);

describe("概览页面布局", () => {
  it("只装配双视图工作区和底部对话框", () => {
    expect(pageSource).toContain("<OverviewWorkspace signedIn={signedIn} />");
    expect(pageSource).toContain(
      "<HomePageSnapshotProvider showRefreshStatus={false}>",
    );
    expect(pageSource).not.toContain("HomepageMarketBaselineWorkspace");
    expect(pageSource).not.toContain("HighlightToNote");
    expect(pageSource).not.toContain("MarketContextSection");
    expect(pageSource).not.toContain("OverviewInsightsPanel");
    expect(pageSource).not.toContain("MoneyFlowPanel");
  });

  it("默认显示热力图，并只挂载当前标签对应视图", () => {
    expect(workspaceSource).toContain('useState<OverviewView>("heatmap")');
    expect(workspaceSource).toContain('role="tablist"');
    expect(workspaceSource).toContain('role="tab"');
    expect(workspaceSource).toContain('label: "热力图"');
    expect(workspaceSource).toContain('label: "新闻雷达"');
    expect(workspaceSource).toContain('activeView === "heatmap" ? (');
    expect(workspaceSource).toContain("<MarketHeatmapClient />");
    expect(workspaceSource).toContain(
      "<ImpactMappingWorkspace signedIn={signedIn} />",
    );
  });

  it("只保留不展示会话历史的对话入口", () => {
    expect(pageSource).toContain("<PiAgentComposer showConversation={false} />");
    expect(pageSource).not.toContain("historyItems=");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("workflow page composition", () => {
  it("renders workflow stage cards from a single source on every core workflow page", () => {
    const screeningSource = readSource(
      "./screening/screening-studio-client.tsx",
    );
    const workflowsSource = readSource("./workflows/workflows-client.tsx");
    const companyResearchSource = readSource(
      "./company-research/company-research-client.tsx",
    );
    const timingSource = readSource("./timing/timing-client.tsx");

    expect(screeningSource).toContain("screeningStageTabs");
    expect(screeningSource).toContain("WorkflowStageSwitcher");
    expect(screeningSource).not.toContain("workflowTabs={screeningStageTabs}");

    expect(workflowsSource).toContain("workflowsStageTabs");
    expect(workflowsSource).toContain("WorkflowStageSwitcher");
    expect(workflowsSource).not.toContain("workflowTabs={workflowsStageTabs}");

    expect(companyResearchSource).toContain("companyResearchStageTabs");
    expect(companyResearchSource).toContain("WorkflowStageSwitcher");
    expect(companyResearchSource).not.toContain(
      "workflowTabs={companyResearchStageTabs}",
    );

    expect(timingSource).toContain("timingStageTabs");
    expect(timingSource).toContain("WorkflowStageSwitcher");
    expect(timingSource).not.toContain("workflowTabs={timingStageTabs}");
  });

  it("removes the old bento dashboard structure from the home page", () => {
    const homePageSource = readSource("./page.tsx");

    expect(homePageSource).not.toContain("BentoCard");
    expect(homePageSource).not.toContain("BentoGrid");
  });

  it("routes history pages through the sidebar history view state", () => {
    const screeningHistorySource = readSource(
      "./screening/history/screening-history-client.tsx",
    );
    const workflowHistorySource = readSource(
      "./_components/workflow-history-client.tsx",
    );

    expect(screeningHistorySource).toContain('sectionView="history"');
    expect(workflowHistorySource).toContain('sectionView="history"');
  });
});

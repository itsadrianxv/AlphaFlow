import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("workflow page composition", () => {
  it("renders shared workflow surfaces on every core workflow page", () => {
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

    expect(workflowsSource).toContain("WorkflowVisualizationPanel");
    expect(workflowsSource.match(/<WorkspaceShell/g)?.length).toBe(1);

    expect(companyResearchSource).toContain("WorkflowVisualizationPanel");
    expect(companyResearchSource.match(/<WorkspaceShell/g)?.length).toBe(1);

    expect(timingSource).toContain("timingStageTabs");
    expect(timingSource).toContain("WorkflowStageSwitcher");
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

  it("feeds direct history items through the workflow pages", () => {
    const screeningSource = readSource(
      "./screening/screening-studio-client.tsx",
    );
    const workflowsSource = readSource("./workflows/workflows-client.tsx");
    const companyResearchSource = readSource(
      "./company-research/company-research-client.tsx",
    );
    const timingSource = readSource("./timing/timing-client.tsx");
    const workflowsHistorySource = readSource("./workflows/history/page.tsx");
    const companyResearchHistorySource = readSource(
      "./company-research/history/page.tsx",
    );
    const runInvestorSource = readSource(
      "./workflows/[runId]/run-investor-client.tsx",
    );
    const runDetailSource = readSource(
      "./workflows/[runId]/run-detail-client.tsx",
    );
    const timingReportSource = readSource(
      "./timing/reports/[cardId]/timing-report-client.tsx",
    );

    expect(screeningSource).toContain("historyItems={");
    expect(screeningSource).toContain("stockFilterQuery");
    expect(screeningSource).toContain("missingValueMode");
    expect(screeningSource).toContain("toggleSortForMetric");

    expect(workflowsSource).toContain("historyItems={");
    expect(workflowsSource).toContain("WorkflowVisualizationPanel");

    expect(companyResearchSource).toContain("historyItems={");
    expect(companyResearchSource).toContain("WorkflowVisualizationPanel");

    expect(timingSource).toContain("historyItems={");
    expect(runInvestorSource).toContain("historyItems={");
    expect(runDetailSource).toContain("historyItems={");
    expect(timingReportSource).toContain("workflow.getRun.useQuery");
    expect(timingReportSource).toContain("TimingReportView");

    expect(screeningSource).not.toContain('href="/screening/history"');
    expect(screeningSource).not.toContain('activeTabId === "filters"');
    expect(workflowsSource).not.toContain('href="/workflows/history"');
    expect(workflowsSource).not.toContain("queue: queuePanel");
    expect(runInvestorSource).not.toContain(
      '<FlowGraph graph={run.runView.user} mode="user" />',
    );
    expect(companyResearchSource).not.toContain(
      'href="/company-research/history"',
    );
    expect(timingSource).toContain("buildTimingReportHistoryItems");
    expect(timingSource).not.toContain("buildWorkflowRunHistoryItems");
    expect(timingSource).not.toContain('href="/timing/history"');
    expect(workflowsHistorySource).not.toContain("headerActions");
    expect(companyResearchHistorySource).not.toContain("headerActions");
  });

  it("injects the shared opportunity intelligence summary into every core workflow page", () => {
    const screeningSource = readSource(
      "./screening/screening-studio-client.tsx",
    );
    const workflowsSource = readSource("./workflows/workflows-client.tsx");
    const companyResearchSource = readSource(
      "./company-research/company-research-client.tsx",
    );
    const timingSource = readSource("./timing/timing-client.tsx");

    expect(screeningSource).toContain("OpportunityIntelligenceSummary");
    expect(workflowsSource).toContain("OpportunityIntelligenceSummary");
    expect(companyResearchSource).toContain("OpportunityIntelligenceSummary");
    expect(timingSource).toContain("OpportunityIntelligenceSummary");
  });

  it("uses a dedicated document-style quick research detail component", () => {
    const investorDetailSource = readSource(
      "./workflows/[runId]/run-investor-client.tsx",
    );
    const industryDetailSource = readSource(
      "./workflows/[runId]/industry-conclusion-detail.tsx",
    );

    expect(investorDetailSource).toContain("IndustryConclusionDetail");
    expect(investorDetailSource).toContain("buildIndustryConclusionViewModel");
    expect(industryDetailSource).toContain("WorkflowStageSwitcher");
    expect(industryDetailSource).not.toContain("WorkflowVisualizationPanel");
  });
});

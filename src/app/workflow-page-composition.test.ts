import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function readModuleSource(relativePath: string) {
  return readFileSync(
    new URL(`../modules/${relativePath}`, import.meta.url),
    "utf8",
  );
}

describe("workflow page composition", () => {
  it("renders shared workflow surfaces on every core workflow page", () => {
    const screeningSource = readModuleSource(
      "screening/ui/screening-studio-client.tsx",
    );
    const workflowsSource = readModuleSource(
      "research/ui/industry/workflows-client.tsx",
    );
    const companyResearchSource = readModuleSource(
      "research/ui/company/company-research-client.tsx",
    );
    const timingSource = readModuleSource("timing/ui/timing-client.tsx");

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
    const screeningHistorySource = readModuleSource(
      "screening/ui/history/screening-history-client.tsx",
    );
    const workflowHistorySource = readModuleSource(
      "research/ui/workflow-history-client.tsx",
    );

    expect(screeningHistorySource).toContain('sectionView="history"');
    expect(workflowHistorySource).toContain('sectionView="history"');
  });

  it("feeds direct history items through the workflow pages", () => {
    const screeningSource = readModuleSource(
      "screening/ui/screening-studio-client.tsx",
    );
    const workflowsSource = readModuleSource(
      "research/ui/industry/workflows-client.tsx",
    );
    const companyResearchSource = readModuleSource(
      "research/ui/company/company-research-client.tsx",
    );
    const timingSource = readModuleSource("timing/ui/timing-client.tsx");
    const workflowsHistorySource = readModuleSource(
      "research/ui/industry/history/page.tsx",
    );
    const companyResearchHistorySource = readModuleSource(
      "research/ui/company/history/page.tsx",
    );
    const runInvestorSource = readModuleSource(
      "research/ui/runs/[runId]/run-investor-client.tsx",
    );
    const runDetailSource = readModuleSource(
      "research/ui/runs/[runId]/run-detail-client.tsx",
    );
    const timingReportSource = readModuleSource(
      "timing/ui/reports/[cardId]/timing-report-client.tsx",
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
    expect(timingReportSource).toContain("research.runs.getRun.useQuery");
    expect(timingReportSource).toContain("TimingReportView");

    expect(screeningSource).not.toContain('href="/screening/history"');
    expect(screeningSource).not.toContain('activeTabId === "filters"');
    expect(workflowsSource).not.toContain('href="/research/history"');
    expect(workflowsSource).not.toContain("queue: queuePanel");
    expect(runInvestorSource).not.toContain(
      '<FlowGraph graph={run.runView.user} mode="user" />',
    );
    expect(companyResearchSource).not.toContain(
      'href="/research/company/history"',
    );
    expect(timingSource).toContain("buildTimingReportHistoryItems");
    expect(timingSource).not.toContain("buildWorkflowRunHistoryItems");
    expect(timingSource).not.toContain('href="/timing/history"');
    expect(workflowsHistorySource).not.toContain("headerActions");
    expect(companyResearchHistorySource).not.toContain("headerActions");
  });

  it("keeps opportunity intelligence out of research, company research, and timing pages", () => {
    const workflowsSource = readModuleSource(
      "research/ui/industry/workflows-client.tsx",
    );
    const companyResearchSource = readModuleSource(
      "research/ui/company/company-research-client.tsx",
    );
    const timingSource = readModuleSource("timing/ui/timing-client.tsx");
    const opportunityIntelligencePageSource = readModuleSource(
      "research/ui/industry/page.tsx",
    );

    expect(workflowsSource).not.toContain("OpportunityIntelligenceSummary");
    expect(companyResearchSource).not.toContain(
      "OpportunityIntelligenceSummary",
    );
    expect(timingSource).not.toContain("OpportunityIntelligenceSummary");
    expect(opportunityIntelligencePageSource).toContain("WorkflowsClient");
  });

  it("uses a dedicated document-style quick research detail component", () => {
    const investorDetailSource = readModuleSource(
      "research/ui/runs/[runId]/run-investor-client.tsx",
    );
    const industryDetailSource = readModuleSource(
      "research/ui/runs/[runId]/industry-conclusion-detail.tsx",
    );

    expect(investorDetailSource).toContain("IndustryConclusionDetail");
    expect(investorDetailSource).toContain("buildIndustryConclusionViewModel");
    expect(industryDetailSource).toContain("WorkflowStageSwitcher");
    expect(industryDetailSource).not.toContain("WorkflowVisualizationPanel");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function readAppSource(relativePath: string) {
  return readFileSync(
    new URL(`../../../app/${relativePath}`, import.meta.url),
    "utf8",
  );
}

describe("timing report-first navigation", () => {
  it("switches the timing workspace to report history data instead of workflow run history", () => {
    const timingSource = readSource("./timing-client.tsx");

    expect(timingSource).toContain("buildTimingReportHistoryItems");
    expect(timingSource).not.toContain(
      "buildWorkflowRunHistoryItems(runsQuery.data?.items ?? [])",
    );
    expect(timingSource).not.toContain(
      String.raw`router.push(\`/workflows/\${result.runId}\`)`,
    );
  });

  it("turns the timing history page into a report-history experience", () => {
    const timingHistorySource = readSource("./history/page.tsx");

    expect(timingHistorySource).toContain("TimingHistoryClient");
    expect(timingHistorySource).not.toContain("WorkflowHistoryClient");
  });

  it("uses report history in the timing report page sidebar and highlights the active report card", () => {
    const timingReportSource = readSource(
      "./reports/[cardId]/timing-report-client.tsx",
    );

    expect(timingReportSource).toContain("buildTimingReportHistoryItems");
    expect(timingReportSource).toContain("research.runs.getRun.useQuery");
    expect(timingReportSource).toContain("card.workflowRunId");
    expect(timingReportSource).toContain("activeHistoryId={cardId}");
    expect(timingReportSource).toContain('titleSize="compact"');
    expect(timingReportSource).not.toContain("WorkflowVisualizationPanel");
    expect(timingReportSource).not.toContain(
      String.raw`href={\`/workflows/\${report.card.workflowRunId}\`}`,
    );
    expect(timingReportSource).not.toContain(
      String.raw`href={\`/research/runs/\${report.card.workflowRunId}\`}`,
    );
    expect(timingReportSource).not.toContain('href="/timing/history"');
  });

  it("removes old timing workflow-detail links from the home page", () => {
    const homeSource = readAppSource("page.tsx");

    expect(homeSource).not.toContain(
      String.raw`/workflows/\${priorityRecommendation.workflowRunId}`,
    );
    expect(homeSource).not.toContain(
      String.raw`/workflows/\${item.workflowRunId}`,
    );
    expect(homeSource).not.toContain(
      String.raw`/research/runs/\${priorityRecommendation.workflowRunId}`,
    );
    expect(homeSource).not.toContain(
      String.raw`/research/runs/\${item.workflowRunId}`,
    );
  });

  it("keeps timing history navigation only in the sidebar on the workspace page", () => {
    const timingSource = readSource("./timing-client.tsx");

    expect(timingSource).toContain('historyHref="/timing/history"');
    expect(timingSource).not.toContain('href="/timing/history"');
  });
});

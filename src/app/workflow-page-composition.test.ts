import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("workflow page composition", () => {
  it("connects every core workflow page to an explicit stage-tab config", () => {
    const screeningSource = readSource("./screening/screening-studio-client.tsx");
    const workflowsSource = readSource("./workflows/workflows-client.tsx");
    const companyResearchSource = readSource(
      "./company-research/company-research-client.tsx",
    );
    const timingSource = readSource("./timing/timing-client.tsx");

    expect(screeningSource).toContain("screeningStageTabs");
    expect(screeningSource).toContain("workflowTabs={screeningStageTabs}");
    expect(screeningSource).toContain("WorkflowStageSwitcher");

    expect(workflowsSource).toContain("workflowsStageTabs");
    expect(workflowsSource).toContain("workflowTabs={workflowsStageTabs}");
    expect(workflowsSource).toContain("WorkflowStageSwitcher");

    expect(companyResearchSource).toContain("companyResearchStageTabs");
    expect(companyResearchSource).toContain(
      "workflowTabs={companyResearchStageTabs}",
    );
    expect(companyResearchSource).toContain("WorkflowStageSwitcher");

    expect(timingSource).toContain("timingStageTabs");
    expect(timingSource).toContain("workflowTabs={timingStageTabs}");
    expect(timingSource).toContain("WorkflowStageSwitcher");
  });

  it("removes the old bento dashboard structure from the home page", () => {
    const homePageSource = readSource("./page.tsx");

    expect(homePageSource).not.toContain("BentoCard");
    expect(homePageSource).not.toContain("BentoGrid");
  });
});

import { describe, expect, it } from "vitest";
import { companyResearchStageTabs } from "~/modules/research/ui/company/company-research-stage-tabs";
import { workflowsStageTabs } from "~/modules/research/ui/industry/workflows-stage-tabs";
import { screeningStageTabs } from "~/modules/screening/ui/screening-stage-tabs";
import { timingStageTabs } from "~/modules/timing/ui/timing-stage-tabs";
import { primaryWorkflowStages } from "~/shared/ui/navigation/workflow-stage-config";

describe("workflow stage config", () => {
  it("defines the primary workflow order", () => {
    expect(
      primaryWorkflowStages.map((stage) => ({
        id: stage.id,
        href: stage.href,
      })),
    ).toEqual([
      { id: "screening", href: "/screening" },
      { id: "workflows", href: "/research" },
      { id: "companyResearch", href: "/research/company" },
      { id: "timing", href: "/timing" },
    ]);
  });

  it("defines compact stage tabs for each core workflow page", () => {
    expect(screeningStageTabs.map((tab) => tab.id)).toEqual([
      "stocks",
      "indicators",
      "period",
      "results",
    ]);
    expect(workflowsStageTabs.map((tab) => tab.id)).toEqual([
      "question",
      "constraints",
      "launch",
    ]);
    expect(companyResearchStageTabs.map((tab) => tab.id)).toEqual([
      "target",
      "sources",
      "launch",
    ]);
    expect(timingStageTabs.map((tab) => tab.id)).toEqual([
      "source",
      "portfolio",
      "strategy",
      "results",
    ]);
  });
});

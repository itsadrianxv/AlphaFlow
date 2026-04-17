import { describe, expect, it } from "vitest";

import { primaryWorkflowStages } from "~/app/_components/workflow-stage-config";
import { companyResearchStageTabs } from "~/app/company-research/company-research-stage-tabs";
import { screeningStageTabs } from "~/app/screening/screening-stage-tabs";
import { timingStageTabs } from "~/app/timing/timing-stage-tabs";
import { workflowsStageTabs } from "~/app/workflows/workflows-stage-tabs";

describe("workflow stage config", () => {
  it("defines the primary workflow order", () => {
    expect(
      primaryWorkflowStages.map((stage) => ({
        id: stage.id,
        href: stage.href,
      })),
    ).toEqual([
      { id: "screening", href: "/screening" },
      { id: "workflows", href: "/workflows" },
      { id: "companyResearch", href: "/company-research" },
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

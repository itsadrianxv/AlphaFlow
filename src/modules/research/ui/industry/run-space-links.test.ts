import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("run-to-space entry points", () => {
  it("adds a manual add-to-space entry on the investor run detail page and workflow history view", () => {
    const investorDetailSource = readSource(
      "src/modules/research/ui/runs/[runId]/run-investor-client.tsx",
    );
    const workflowHistorySource = readSource(
      "src/modules/research/ui/workflow-history-client.tsx",
    );

    expect(investorDetailSource).toContain("/research/spaces?addRunId=");
    expect(workflowHistorySource).toContain("/research/spaces?addRunId=");
  });

  it("surfaces timing report entry points on the investor run detail page", () => {
    const investorDetailSource = readSource(
      "src/modules/research/ui/runs/[runId]/run-investor-client.tsx",
    );

    expect(investorDetailSource).toContain("/timing/reports/");
    expect(investorDetailSource).toContain("查看单股报告");
  });
});

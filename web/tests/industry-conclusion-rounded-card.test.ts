import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("IndustryConclusionDetail report layout", () => {
  const source = readFileSync(
    "app/workflows/[runId]/industry-conclusion-detail.tsx",
    "utf8",
  );

  it("uses the shared four-step report switcher", () => {
    expect(source).toContain('data-industry-conclusion-detail="true"');
    expect(source).toContain("<WorkflowStageSwitcher");
    expect(source).toContain("tabs={model.sections}");
    expect(source).toContain("overview: <OverviewSection model={model} />");
  });

  it("keeps report summary and metrics inside the overview section", () => {
    expect(source).toContain('title="摘要总览"');
    expect(source).toContain("<MetricStrip model={props.model} />");
    expect(source).toContain("<NoticeList model={props.model} />");
    expect(source).toContain("props.model.headline");
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("IndustryConclusionDetail report layout", () => {
  const source = readFileSync(
    "app/workflows/[runId]/industry-conclusion-detail.tsx",
    "utf8",
  );
  const viewModelSource = readFileSync(
    "app/workflows/[runId]/industry-conclusion-view-model.ts",
    "utf8",
  );
  const runClientSource = readFileSync(
    "app/workflows/[runId]/run-investor-client.tsx",
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

  it("removes explanatory descriptions from the industry conclusion shell", () => {
    const combined = [source, viewModelSource, runClientSource].join("\n");

    expect(combined).not.toContain(
      "把行业研究结论按总览、核心逻辑、证据与可信度、风险与下一步分段阅读。",
    );
    expect(combined).not.toContain(
      "先看支持/不足/冲突和覆盖率，再按需下看断言与研究单元。",
    );
    expect(combined).not.toContain("结论、摘要、动作");
    expect(combined).not.toContain("行业驱动与重点标的");
    expect(combined).not.toContain("缺口、反例和动作");
    expect(viewModelSource).toContain('summary: ""');
  });

  it("uses compact single-layer report cards", () => {
    expect(source).toContain('density="compact"');
    expect(source).toContain('className="grid gap-4"');
    expect(source).toContain(
      'className="grid border-y border-[var(--app-border-soft)] sm:grid-cols-2 xl:grid-cols-5"',
    );
    expect(source).toContain(
      'className="grid border-y border-[var(--app-border-soft)] sm:grid-cols-2 xl:grid-cols-4"',
    );
    expect(source).not.toContain(
      "rounded-[12px] border border-[var(--app-border-soft)] bg-[var(--app-panel-soft)]",
    );
  });
});

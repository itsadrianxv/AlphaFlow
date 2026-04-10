import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorkflowStageTab } from "~/app/_components/workflow-stage-config";
import { WorkflowStageSwitcher } from "~/app/_components/workflow-stage-switcher";

const tabs: WorkflowStageTab[] = [
  {
    id: "question",
    label: "研究问题",
    summary: "先明确问题",
  },
  {
    id: "launch",
    label: "发起执行",
    summary: "确认后启动",
  },
];

describe("WorkflowStageSwitcher", () => {
  it("renders one active workflow panel at a time", () => {
    const markup = renderToStaticMarkup(
      React.createElement(WorkflowStageSwitcher, {
        tabs,
        activeTabId: "launch",
        panels: {
          question: React.createElement("div", null, "question-panel"),
          launch: React.createElement("div", null, "launch-panel"),
        },
      }),
    );

    expect(markup).toContain('data-stage-switcher="true"');
    expect(markup).toContain('data-active-tab="launch"');
    expect(markup).toContain("发起执行");
    expect(markup).toContain("launch-panel");
    expect(markup).not.toContain("question-panel");
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkspaceShell } from "~/app/_components/ui";

describe("WorkspaceShell", () => {
  it("renders the top-level workflow navigation instead of a sidebar shell", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        WorkspaceShell,
        {
          section: "workflows",
          title: "行业研究",
          description: "围绕单一流程组织研究动作。",
          workflowTabs: [
            {
              id: "question",
              label: "研究问题",
              summary: "定义本轮研究目标",
            },
            {
              id: "constraints",
              label: "研究约束",
              summary: "限定证据和时效",
            },
          ],
          children: React.createElement("div", null, "body"),
        },
      ),
    );

    expect(markup).toContain('data-workflow-shell="mistral"');
    expect(markup).toContain('href="/screening"');
    expect(markup).toContain('href="/workflows"');
    expect(markup).toContain('href="/company-research"');
    expect(markup).toContain('href="/timing"');
    expect(markup).toContain("研究问题");
    expect(markup).not.toContain("<aside");
  });
});

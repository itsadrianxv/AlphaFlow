import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkspaceShell } from "~/app/_components/ui";

describe("WorkspaceShell", () => {
  it("renders the sidebar with main navigation and one contextual history entry", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        WorkspaceShell,
        {
          section: "workflows",
          title: "行业研究",
          description: "body copy",
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
        } as React.ComponentProps<typeof WorkspaceShell>,
        React.createElement("div", null, "body"),
      ),
    );

    expect(markup).toContain('data-workflow-shell="mistral"');
    expect(markup).toContain("<aside");
    expect(markup).toContain("概览");
    expect(markup).toContain('href="/screening"');
    expect(markup).toContain('href="/workflows"');
    expect(markup).toContain('href="/company-research"');
    expect(markup).toContain('href="/timing"');
    expect(markup).toContain('href="/workflows/history"');
    expect(markup).not.toContain('href="/screening/history"');
    expect(markup).not.toContain('href="/timing/history"');
    expect(markup).toContain("研究问题");
    expect(markup).not.toContain('aria-label="Primary navigation"');
    expect(markup).not.toContain('aria-label="History navigation"');
  });

  it("shows no history entry on the home section and highlights both entries on history pages", () => {
    const homeMarkup = renderToStaticMarkup(
      React.createElement(
        WorkspaceShell,
        {
          section: "home",
          title: "概览",
          description: "body copy",
        } as React.ComponentProps<typeof WorkspaceShell>,
        React.createElement("div", null, "body"),
      ),
    );

    expect(homeMarkup).not.toContain("历史入口");
    expect(homeMarkup).not.toContain("/history");

    const historyMarkup = renderToStaticMarkup(
      React.createElement(
        WorkspaceShell,
        {
          section: "screening",
          sectionView: "history",
          title: "筛选历史",
          description: "body copy",
        } as React.ComponentProps<typeof WorkspaceShell>,
        React.createElement("div", null, "body"),
      ),
    );

    expect(historyMarkup).toContain("历史入口");
    expect(historyMarkup).toContain('href="/screening/history"');
    expect(historyMarkup.match(/aria-current="page"/g)?.length).toBe(2);
  });

  it("does not render the old compact website navbar shell", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        WorkspaceShell,
        {
          section: "screening",
          title: "鐏忓繑澹掗柌蹇曠摣闁浼愭担婊冨酱",
          description: "body copy",
        } as React.ComponentProps<typeof WorkspaceShell>,
        React.createElement("div", null, "body"),
      ),
    );

    expect(markup).toContain("SSB");
    expect(markup).not.toContain('aria-label="Primary workflow"');
    expect(markup).not.toContain("data-stage-active=");
  });
});

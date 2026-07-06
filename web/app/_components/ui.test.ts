import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkspaceShell } from "~/app/_components/ui";

describe("WorkspaceShell", () => {
  it("renders a left-anchored sidebar with svg navigation and direct history items", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        WorkspaceShell,
        {
          section: "workflows",
          title: "Research",
          description: "body copy",
          historyHref: "/workflows/history",
          historyItems: [
            {
              id: "run-1",
              title: "Recent workflow run",
              href: "/workflows/run-1",
            },
          ],
          workflowTabs: [
            {
              id: "question",
              label: "Question",
              summary: "Define the goal for this run",
            },
            {
              id: "constraints",
              label: "Constraints",
              summary: "Limit the evidence and timing assumptions",
            },
          ],
        } as React.ComponentProps<typeof WorkspaceShell>,
        React.createElement("div", null, "body"),
      ),
    );

    expect(markup).toContain('data-workflow-shell="mistral"');
    expect(markup).toContain('data-sidebar-anchor="left"');
    expect(markup).toContain('data-sidebar-nav="desktop"');
    expect(markup).toContain('aria-label="Toggle sidebar"');
    expect(markup).toContain('href="/screening"');
    expect(markup).toContain('href="/workflows"');
    expect(markup).toContain('href="/company-research"');
    expect(markup).toContain('href="/timing"');
    expect(markup).toContain('href="/spaces"');
    expect(markup).toContain('href="/watchlists"');
    expect(markup).toContain('href="/workflows/history"');
    expect(markup).toContain("Recent workflow run");
    expect(markup).toContain('href="/workflows/run-1"');
    expect(markup).toContain("grid min-w-0 gap-1");
    expect(markup).toContain("block w-full min-w-0 overflow-hidden");
    expect(markup).toContain("block w-full truncate");
    expect(markup.match(/data-sidebar-icon=/g)?.length).toBe(7);
    expect(markup).toContain('data-sidebar-icon="watchlists"');
    expect(markup).not.toContain('data-sidebar-icon="history"');
    expect(markup).toContain("Question");
    expect(markup).toContain('aria-label="Open navigation menu"');
    expect(markup).not.toContain('aria-label="Primary navigation"');
    expect(markup).not.toContain('aria-label="History navigation"');
  });

  it("shows no history entry on the home section and marks the history shortcut active on history pages", () => {
    const homeMarkup = renderToStaticMarkup(
      React.createElement(
        WorkspaceShell,
        {
          section: "home",
          title: "Overview",
          description: "body copy",
        } as React.ComponentProps<typeof WorkspaceShell>,
        React.createElement("div", null, "body"),
      ),
    );

    expect(homeMarkup).not.toContain("/history");
    expect(homeMarkup.match(/data-sidebar-icon=/g)?.length).toBe(7);

    const watchlistsMarkup = renderToStaticMarkup(
      React.createElement(
        WorkspaceShell,
        {
          section: "watchlists",
          title: "Watchlists",
          description: "body copy",
        } as unknown as React.ComponentProps<typeof WorkspaceShell>,
        React.createElement("div", null, "body"),
      ),
    );

    expect(watchlistsMarkup).toContain('data-sidebar-icon="watchlists"');
    expect(watchlistsMarkup).toMatch(
      /href="\/watchlists"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/watchlists"/,
    );
    expect(watchlistsMarkup).not.toMatch(
      /href="\/spaces"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/spaces"/,
    );

    const historyMarkup = renderToStaticMarkup(
      React.createElement(
        WorkspaceShell,
        {
          section: "screening",
          sectionView: "history",
          title: "Screening history",
          description: "body copy",
          historyHref: "/screening/history",
          historyItems: [
            {
              id: "workspace-1",
              title: "Saved workspace",
              href: "/screening?workspaceId=workspace-1",
            },
          ],
          activeHistoryId: "workspace-1",
        } as React.ComponentProps<typeof WorkspaceShell>,
        React.createElement("div", null, "body"),
      ),
    );

    expect(historyMarkup).toContain('href="/screening/history"');
    expect(historyMarkup).toContain('data-sidebar-nav="desktop"');
    expect(historyMarkup).toContain('data-history-shortcut="active"');
    expect(historyMarkup).toContain("Saved workspace");
    expect(historyMarkup.match(/aria-current="page"/g)?.length).toBe(3);
  });

  it("hides the desktop history list when the sidebar starts collapsed", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        WorkspaceShell,
        {
          section: "timing",
          title: "Timing",
          description: "body copy",
          historyHref: "/timing/history",
          historyItems: [
            {
              id: "run-1",
              title: "Latest timing run",
              href: "/workflows/run-1",
            },
          ],
          initialDesktopCollapsed: true,
        } as React.ComponentProps<typeof WorkspaceShell> & {
          initialDesktopCollapsed?: boolean;
        },
        React.createElement("div", null, "body"),
      ),
    );

    expect(markup).toContain('data-sidebar-collapsed="true"');
    expect(markup).not.toContain("Latest timing run");
    expect(markup).not.toContain('href="/timing/history"');
  });

  it("uses the dedicated sidebar shell tone across the sidebar chrome", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        WorkspaceShell,
        {
          section: "home",
          title: "Overview",
          description: "body copy",
        } as React.ComponentProps<typeof WorkspaceShell>,
        React.createElement("div", null, "body"),
      ),
    );

    expect(markup.match(/bg-\[var\(--app-sidebar-bg\)\]/g)?.length ?? 0).toBe(
      3,
    );
  });

  it("does not render the old compact website navbar shell or verbose sidebar detail rows", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        WorkspaceShell,
        {
          section: "screening",
          title: "Screening",
          description: "body copy",
        } as React.ComponentProps<typeof WorkspaceShell>,
        React.createElement("div", null, "body"),
      ),
    );

    expect(markup).toContain("SSB");
    expect(markup).not.toContain('aria-label="Primary workflow"');
    expect(markup).not.toContain("data-stage-active=");
    expect(markup).not.toContain("策略、会话与观察池");
    expect(markup).not.toContain("行业逻辑与研究运行");
  });

  it("supports a compact page title size without affecting the default header", () => {
    const compactMarkup = renderToStaticMarkup(
      React.createElement(
        WorkspaceShell,
        {
          section: "timing",
          title: "600159 大龙地产 · 择时研究报告",
          description: "body copy",
          titleSize: "compact",
        } as React.ComponentProps<typeof WorkspaceShell> & {
          titleSize?: "default" | "compact";
        },
        React.createElement("div", null, "body"),
      ),
    );
    const defaultMarkup = renderToStaticMarkup(
      React.createElement(
        WorkspaceShell,
        {
          section: "timing",
          title: "Timing",
          description: "body copy",
        } as React.ComponentProps<typeof WorkspaceShell>,
        React.createElement("div", null, "body"),
      ),
    );

    expect(compactMarkup).toContain("text-[38px]");
    expect(compactMarkup).toContain("sm:text-[46px]");
    expect(compactMarkup).not.toContain("xl:text-[72px]");
    expect(defaultMarkup).toContain("text-[46px]");
    expect(defaultMarkup).toContain("xl:text-[72px]");
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const listRunsUseQueryMock = vi.fn();
const startQuickResearchUseMutationMock = vi.fn();

vi.mock("next/link", () => ({
  default: (props: {
    href: string;
    className?: string;
    children: React.ReactNode;
  }) =>
    React.createElement(
      "a",
      {
        href: props.href,
        className: props.className,
      },
      props.children,
    ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  useSearchParams: () => ({
    get: () => null,
  }),
}));

vi.mock("~/modules/research/ui/research-voice-input", () => ({
  ResearchVoiceInput: () => React.createElement("div", null, "voice-input"),
}));

vi.mock("~/shared/ui/primitives/ui", () => ({
  InlineNotice: (props: { description?: string }) =>
    React.createElement("div", null, props.description ?? ""),
  SectionCard: (props: {
    title?: string;
    description?: string;
    actions?: React.ReactNode;
    children?: React.ReactNode;
  }) =>
    React.createElement(
      "section",
      null,
      props.title ? React.createElement("h2", null, props.title) : null,
      props.description
        ? React.createElement("p", null, props.description)
        : null,
      props.actions ?? null,
      props.children,
    ),
  WorkspaceShell: (props: { children?: React.ReactNode }) =>
    React.createElement("div", null, props.children),
}));

vi.mock("~/shared/ui/navigation/workspace-history", () => ({
  buildWorkflowRunHistoryItems: () => [],
}));

vi.mock("~/modules/research/ui/industry/workflow-visualization-panel", () => ({
  WorkflowVisualizationPanel: (props: {
    runId?: string;
    templateCode?: string;
  }) =>
    React.createElement(
      "div",
      {
        "data-testid": "workflow-visualization-panel",
        "data-run-id": props.runId ?? "",
        "data-template-code": props.templateCode ?? "",
      },
      "workflow visualization",
    ),
}));

vi.mock("~/modules/research/ui/industry/quick-research-form", () => ({
  buildQuickResearchStartInput: (value: unknown) => value,
}));

vi.mock("~/modules/research/ui/industry/workflows-voice-adapter", () => ({
  applyWorkflowsVoicePatch: (state: unknown) => state,
  buildWorkflowsVoiceContext: () => ({}),
}));

vi.mock("~/platform/trpc/react", () => ({
  api: {
    useUtils: () => ({
      research: {
        runs: {
          listRuns: {
            invalidate: vi.fn(async () => undefined),
          },
        },
      },
    }),
    research: {
      runs: {
        listRuns: {
          useQuery: listRunsUseQueryMock,
        },
        startQuickResearch: {
          useMutation: startQuickResearchUseMutationMock,
        },
      },
    },
  },
}));

describe("WorkflowsClient", () => {
  beforeEach(() => {
    listRunsUseQueryMock.mockReset();
    startQuickResearchUseMutationMock.mockReset();

    listRunsUseQueryMock.mockReturnValue({
      data: {
        items: [],
      },
      isLoading: false,
    });

    startQuickResearchUseMutationMock.mockReturnValue({
      isPending: false,
      error: null,
      mutateAsync: vi.fn(async () => undefined),
    });
  });

  it("renders the static workflow diagram preview for quick research", async () => {
    listRunsUseQueryMock.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            query: "AI infra",
            createdAt: new Date("2026-04-20T12:00:00.000Z"),
          },
        ],
      },
      isLoading: false,
    });

    const { WorkflowsClient } = await import(
      "~/modules/research/ui/industry/workflows-client"
    );
    const markup = renderToStaticMarkup(React.createElement(WorkflowsClient));

    expect(markup).toContain("workflow-visualization-panel");
    expect(markup).toContain('data-run-id=""');
    expect(markup).toContain('data-template-code="quick_industry_research"');
  });

  it("still renders the static workflow diagram preview when there is no latest run", async () => {
    const { WorkflowsClient } = await import(
      "~/modules/research/ui/industry/workflows-client"
    );
    const markup = renderToStaticMarkup(React.createElement(WorkflowsClient));

    expect(markup).toContain("workflow-visualization-panel");
    expect(markup).toContain('data-run-id=""');
    expect(markup).toContain('data-template-code="quick_industry_research"');
  });

  it("does not render the opportunity intelligence summary on the industry research page", async () => {
    const { WorkflowsClient } = await import(
      "~/modules/research/ui/industry/workflows-client"
    );
    const markup = renderToStaticMarkup(React.createElement(WorkflowsClient));

    expect(markup).not.toContain("opportunity-intelligence-summary");
  });
});

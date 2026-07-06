import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const WORKFLOW_ERROR_MESSAGE = "组合建议生成失败：工作流模板不可用";
const WORKFLOW_STARTED_MESSAGE =
  "组合建议流程已启动，结果区会自动刷新约 3 分钟。";

type TimingWorkflowMutationState = {
  data: {
    runId: string;
    status: string;
    createdAt: Date;
  } | null;
  error: Error | null;
  isPending: boolean;
  mutateAsync: ReturnType<typeof vi.fn>;
};

function createIdleMutation(): TimingWorkflowMutationState {
  return {
    data: null,
    error: null,
    isPending: false,
    mutateAsync: vi.fn(async () => undefined),
  };
}

let startWatchlistTimingMutationState = createIdleMutation();

vi.mock("next/link", () => ({
  default: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    React.createElement("a", props, props.children),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: () => null,
  }),
}));

vi.mock("~/app/_components/stock-search-picker", () => ({
  StockSearchPicker: () => React.createElement("div", null, "stock-search"),
}));

vi.mock("~/app/_components/ui", () => ({
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(" "),
  EmptyState: (props: { title: string; description?: string }) =>
    React.createElement(
      "div",
      null,
      props.title,
      props.description ? ` ${props.description}` : "",
    ),
  InlineNotice: (props: { description?: string | null; tone?: string }) =>
    React.createElement(
      "div",
      {
        "data-tone": props.tone ?? "info",
      },
      props.description ?? "",
    ),
  Panel: (props: {
    title?: string;
    description?: string;
    actions?: React.ReactNode;
    children?: React.ReactNode;
    className?: string;
  }) =>
    React.createElement(
      "section",
      {
        className: props.className,
      },
      props.title ? React.createElement("h2", null, props.title) : null,
      props.description
        ? React.createElement("p", null, props.description)
        : null,
      props.actions ?? null,
      props.children,
    ),
  StatusPill: (props: { label: string }) =>
    React.createElement("span", null, props.label),
  WorkspaceShell: (props: { children?: React.ReactNode }) =>
    React.createElement("div", null, props.children),
}));

vi.mock("~/app/_components/workflow-stage-switcher", () => ({
  WorkflowStageSwitcher: (props: { panels: Record<string, React.ReactNode> }) =>
    React.createElement("div", null, props.panels.results),
}));

vi.mock("~/app/_components/workspace-history", () => ({
  buildTimingReportHistoryItems: () => [],
}));

vi.mock("~/app/_components/market-context-section", () => ({
  MarketContextSection: () =>
    React.createElement("div", null, "market-context"),
}));

vi.mock("~/app/timing/timing-signal-card-list", () => ({
  TimingSignalCardList: () => React.createElement("div", null, "signal-cards"),
}));

vi.mock("~/app/timing/timing-stage-tabs", () => ({
  timingStageTabs: [
    {
      id: "results",
      label: "查看建议",
      summary: "显示结果页",
    },
  ],
}));

vi.mock("~/trpc/react", () => {
  return {
    api: {
      useUtils: () => ({
        timing: {
          listTimingCards: { invalidate: vi.fn(async () => undefined) },
          listRecommendations: { invalidate: vi.fn(async () => undefined) },
          listReviewRecords: { invalidate: vi.fn(async () => undefined) },
          listPortfolioSnapshots: { invalidate: vi.fn(async () => undefined) },
          listTimingPresets: { invalidate: vi.fn(async () => undefined) },
        },
      }),
      watchlist: {
        list: {
          useQuery: () => ({
            data: [],
            isLoading: false,
          }),
        },
        getDetail: {
          useQuery: () => ({
            data: null,
            isLoading: false,
          }),
        },
      },
      timing: {
        listPortfolioSnapshots: {
          useQuery: () => ({
            data: [],
            isLoading: false,
          }),
        },
        listTimingCards: {
          useQuery: () => ({
            data: [],
            isLoading: false,
          }),
        },
        listRecommendations: {
          useQuery: () => ({
            data: [],
            isLoading: false,
          }),
        },
        listReviewRecords: {
          useQuery: () => ({
            data: [],
            isLoading: false,
          }),
        },
        listTimingPresets: {
          useQuery: () => ({
            data: [],
            isLoading: false,
          }),
        },
        createPortfolioSnapshot: {
          useMutation: createIdleMutation,
        },
        updatePortfolioSnapshot: {
          useMutation: createIdleMutation,
        },
        saveTimingPreset: {
          useMutation: createIdleMutation,
        },
      },
      workflow: {
        startTimingSignalPipeline: {
          useMutation: createIdleMutation,
        },
        startWatchlistTimingCardsPipeline: {
          useMutation: createIdleMutation,
        },
        startWatchlistTimingPipeline: {
          useMutation: () => startWatchlistTimingMutationState,
        },
        startTimingReviewLoop: {
          useMutation: createIdleMutation,
        },
      },
    },
  };
});

describe("TimingClient", () => {
  beforeEach(() => {
    vi.resetModules();
    startWatchlistTimingMutationState = createIdleMutation();
  });

  it("renders the watchlist timing workflow error when the combination suggestion run fails", async () => {
    startWatchlistTimingMutationState = {
      ...createIdleMutation(),
      error: new Error(WORKFLOW_ERROR_MESSAGE),
    };
    globalThis.React = React;
    const { TimingClient } = await import("~/app/timing/timing-client");
    const markup = renderToStaticMarkup(React.createElement(TimingClient));

    expect(markup).toContain(WORKFLOW_ERROR_MESSAGE);
  });

  it("renders a success notice when the combination suggestion workflow has started", async () => {
    startWatchlistTimingMutationState = {
      ...createIdleMutation(),
      data: {
        runId: "run-1",
        status: "PENDING",
        createdAt: new Date("2026-04-17T12:00:00.000Z"),
      },
    };
    globalThis.React = React;
    const { TimingClient } = await import("~/app/timing/timing-client");
    const markup = renderToStaticMarkup(React.createElement(TimingClient));

    expect(markup).toContain(WORKFLOW_STARTED_MESSAGE);
  });
});

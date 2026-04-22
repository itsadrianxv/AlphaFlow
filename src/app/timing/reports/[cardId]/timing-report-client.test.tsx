import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getTimingReportUseQueryMock = vi.fn();
const listTimingCardsUseQueryMock = vi.fn();
const getRunUseQueryMock = vi.fn();

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

vi.mock("~/app/_components/ui", () => ({
  WorkspaceShell: (props: { children?: React.ReactNode }) =>
    React.createElement("div", null, props.children),
  EmptyState: (props: { title: string; description?: string }) =>
    React.createElement(
      "div",
      { "data-testid": "empty-state" },
      props.title,
      props.description ? ` ${props.description}` : "",
    ),
  InlineNotice: (props: { title?: string; description?: string }) =>
    React.createElement(
      "div",
      { "data-testid": "inline-notice" },
      props.title ? `${props.title} ` : "",
      props.description ?? "",
    ),
  LoadingSkeleton: () =>
    React.createElement(
      "div",
      { "data-testid": "loading-skeleton" },
      "loading",
    ),
}));

vi.mock("~/app/_components/workspace-history", () => ({
  buildTimingReportHistoryItems: () => [],
}));

vi.mock("~/app/timing/reports/[cardId]/timing-report-view", () => ({
  TimingReportView: (props: { run?: { id: string } | null }) =>
    React.createElement(
      "div",
      {
        "data-testid": "timing-report-view",
        "data-run-id": props.run?.id ?? "",
      },
      "report",
    ),
}));

vi.mock("~/trpc/react", () => ({
  api: {
    timing: {
      getTimingReport: {
        useQuery: getTimingReportUseQueryMock,
      },
      listTimingCards: {
        useQuery: listTimingCardsUseQueryMock,
      },
    },
    workflow: {
      getRun: {
        useQuery: getRunUseQueryMock,
      },
    },
  },
}));

function createReport(workflowRunId?: string | null) {
  return {
    card: {
      id: "card_1",
      workflowRunId: workflowRunId ?? null,
      stockCode: "600519",
      stockName: "璐靛窞鑼呭彴",
      asOfDate: "2026-03-06",
      signalSnapshot: {
        asOfDate: "2026-03-06",
      },
    },
  };
}

describe("TimingReportClient", () => {
  beforeEach(() => {
    getTimingReportUseQueryMock.mockReset();
    listTimingCardsUseQueryMock.mockReset();
    getRunUseQueryMock.mockReset();

    getTimingReportUseQueryMock.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
    });

    listTimingCardsUseQueryMock.mockReturnValue({
      data: [],
      isLoading: false,
    });

    getRunUseQueryMock.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
    });
  });

  it("loads the linked workflow run and passes it to the report view", async () => {
    getTimingReportUseQueryMock.mockReturnValue({
      data: createReport("run_1"),
      error: null,
      isLoading: false,
    });
    getRunUseQueryMock.mockReturnValue({
      data: { id: "run_1" },
      error: null,
      isLoading: false,
    });

    const { TimingReportClient } = await import(
      "~/app/timing/reports/[cardId]/timing-report-client"
    );
    const markup = renderToStaticMarkup(
      React.createElement(TimingReportClient, {
        cardId: "card_1",
      }),
    );

    expect(getRunUseQueryMock).toHaveBeenCalled();
    expect(markup).toContain('data-testid="timing-report-view"');
    expect(markup).toContain('data-run-id="run_1"');
  });

  it("still renders the report view when the report has no workflowRunId", async () => {
    getTimingReportUseQueryMock.mockReturnValue({
      data: createReport(null),
      error: null,
      isLoading: false,
    });

    const { TimingReportClient } = await import(
      "~/app/timing/reports/[cardId]/timing-report-client"
    );
    const markup = renderToStaticMarkup(
      React.createElement(TimingReportClient, {
        cardId: "card_1",
      }),
    );

    expect(markup).toContain('data-testid="timing-report-view"');
    expect(markup).toContain('data-run-id=""');
  });
});

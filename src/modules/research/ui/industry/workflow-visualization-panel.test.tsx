/* biome-ignore lint/correctness/noUnusedImports: React is required for server-side JSX rendering in this test. */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowDiagramRunDetail } from "~/modules/research/ui/industry/workflow-diagram-runtime";

const getRunUseQueryMock = vi.fn();

vi.mock("~/platform/trpc/react", () => ({
  api: {
    useUtils: () => ({
      research: {
        runs: {
          getRun: {
            invalidate: vi.fn(async () => undefined),
          },
        },
      },
    }),
    research: {
      runs: {
        getRun: {
          useQuery: getRunUseQueryMock,
        },
      },
    },
  },
}));

function buildRunFixture(
  overrides: Partial<WorkflowDiagramRunDetail> = {},
): WorkflowDiagramRunDetail {
  return {
    id: "run_1",
    query: "AI infrastructure",
    status: "RUNNING",
    progressPercent: 43,
    currentNodeKey: "agent1_extract_research_spec",
    input: {},
    errorCode: null,
    errorMessage: null,
    result: {},
    template: {
      code: "quick_industry_research",
      version: 3,
    },
    createdAt: new Date("2026-04-22T08:00:00.000Z"),
    startedAt: new Date("2026-04-22T08:00:05.000Z"),
    completedAt: null,
    nodes: [
      {
        id: "node_1",
        nodeKey: "agent0_clarify_scope",
        agentName: "agent0_clarify_scope",
        attempt: 1,
        status: "SUCCEEDED",
        errorCode: null,
        errorMessage: null,
        durationMs: 800,
        startedAt: new Date("2026-04-22T08:00:05.000Z"),
        completedAt: new Date("2026-04-22T08:00:05.800Z"),
        output: {
          summary: "scope",
        },
      },
    ],
    events: [
      {
        id: "event_1",
        sequence: 1,
        eventType: "NODE_SUCCEEDED",
        payload: {
          nodeKey: "agent0_clarify_scope",
        },
        occurredAt: new Date("2026-04-22T08:00:05.800Z"),
      },
    ],
    ...overrides,
  };
}

describe("WorkflowVisualizationPanel", () => {
  beforeEach(() => {
    getRunUseQueryMock.mockReset();
    getRunUseQueryMock.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: false,
    });
  });

  it("renders a static topology preview from template code and version", async () => {
    const { WorkflowVisualizationPanel } = await import(
      "~/modules/research/ui/industry/workflow-visualization-panel"
    );

    const markup = renderToStaticMarkup(
      <WorkflowVisualizationPanel
        title="Launch Flow"
        description="Static preview"
        templateCode="quick_industry_research"
        templateVersion={3}
      />,
    );

    expect(markup).toContain("Launch Flow");
    expect(markup).toContain("data-workflow-state-diagram");
    expect(markup).toContain("agent6_reflection");
    expect(markup).toContain("节点详情");
  });

  it("loads the run by runId and renders the active runtime diagram", async () => {
    getRunUseQueryMock.mockReturnValue({
      data: buildRunFixture(),
      error: null,
      isLoading: false,
    });

    const { WorkflowVisualizationPanel } = await import(
      "~/modules/research/ui/industry/workflow-visualization-panel"
    );
    const markup = renderToStaticMarkup(
      <WorkflowVisualizationPanel
        runId="run_1"
        detailHref="/research/runs/run_1"
        title="Recent Run"
      />,
    );

    expect(markup).toContain("data-workflow-state-diagram");
    expect(markup).toContain("agent1_extract_research_spec");
    expect(markup).toContain('data-node-status="active"');
    expect(markup).toContain("/research/runs/run_1");
    expect(markup).toContain("进行中");
  });

  it("renders an empty state when no run and no template preview are provided", async () => {
    const { WorkflowVisualizationPanel } = await import(
      "~/modules/research/ui/industry/workflow-visualization-panel"
    );
    const markup = renderToStaticMarkup(
      <WorkflowVisualizationPanel title="Recent Run" />,
    );

    expect(markup).toContain("Recent Run");
    expect(markup).toContain("暂无状态图数据");
    expect(markup).not.toContain("data-workflow-state-diagram");
  });

  it("renders a degraded ordered-node diagram for unknown template versions", async () => {
    getRunUseQueryMock.mockReturnValue({
      data: buildRunFixture({
        template: {
          code: "unknown_template",
          version: 99,
        },
        currentNodeKey: "custom_step",
        nodes: [
          {
            id: "node_custom",
            nodeKey: "custom_step",
            agentName: "custom_step",
            attempt: 1,
            status: "RUNNING",
            errorCode: null,
            errorMessage: null,
            durationMs: null,
            startedAt: new Date("2026-04-22T08:00:05.000Z"),
            completedAt: null,
            output: {},
          },
        ],
      }),
      error: null,
      isLoading: false,
    });

    const { WorkflowVisualizationPanel } = await import(
      "~/modules/research/ui/industry/workflow-visualization-panel"
    );
    const markup = renderToStaticMarkup(
      <WorkflowVisualizationPanel runId="run_unknown" />,
    );

    expect(markup).toContain("未找到 unknown_template@99 对应的状态图配置。");
    expect(markup).toContain("custom_step");
  });

  it("renders an error notice when loading the workflow diagram fails", async () => {
    getRunUseQueryMock.mockReturnValue({
      data: undefined,
      error: {
        message: "workflow failed",
      },
      isLoading: false,
    });

    const { WorkflowVisualizationPanel } = await import(
      "~/modules/research/ui/industry/workflow-visualization-panel"
    );
    const markup = renderToStaticMarkup(
      <WorkflowVisualizationPanel runId="run_2" />,
    );

    expect(markup).toContain("workflow failed");
    expect(markup).toContain("状态图加载失败");
    expect(markup).not.toContain("data-workflow-state-diagram");
  });
});

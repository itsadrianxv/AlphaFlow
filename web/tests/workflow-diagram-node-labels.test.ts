import { describe, expect, it } from "vitest";

import { formatWorkflowDiagramNodeLabel } from "~/app/workflows/detail-labels";
import { buildWorkflowDiagramRuntimeState } from "~/app/workflows/workflow-diagram-runtime";

describe("workflow diagram node labels", () => {
  it("formats agent nodes with their numeric prefix and Chinese label", () => {
    expect(
      formatWorkflowDiagramNodeLabel(
        "agent0_clarify_scope",
        "澄清研究范围",
      ),
    ).toBe("0. 澄清研究范围");
    expect(
      formatWorkflowDiagramNodeLabel("agent1_extract_research_spec"),
    ).toBe("1. 提炼研究任务");
  });

  it("keeps non-agent workflow nodes as Chinese labels without exposing node keys", () => {
    expect(
      formatWorkflowDiagramNodeLabel(
        "collector_official_sources",
        "采集官网信源",
      ),
    ).toBe("采集官网信源");
  });

  it("uses formatted Chinese labels for fallback diagram nodes", () => {
    const runtime = buildWorkflowDiagramRuntimeState({
      spec: null,
      run: {
        id: "run-1",
        status: "RUNNING",
        progressPercent: 50,
        currentNodeKey: "agent0_clarify_scope",
        input: {},
        errorCode: null,
        errorMessage: null,
        result: {},
        template: {
          code: "unknown_template",
          version: 1,
        },
        createdAt: new Date(0),
        nodes: [
          {
            id: "node-run-1",
            nodeKey: "agent0_clarify_scope",
            agentName: "agent0_clarify_scope",
            attempt: 1,
            status: "RUNNING",
            errorCode: null,
            errorMessage: null,
            durationMs: null,
            startedAt: null,
            completedAt: null,
            output: null,
          },
        ],
        events: [],
      },
    });

    expect(runtime.fallback?.orderedNodes[0]?.label).toBe("0. 澄清研究范围");
  });

  it("uses the latest live event to highlight nodes and expose progress", () => {
    const runtime = buildWorkflowDiagramRuntimeState({
      spec: {
        templateCode: "industry_research",
        templateVersion: 3,
        title: "行业研究",
        layout: { width: 480, height: 180 },
        lanes: [{ id: "main", label: "主流程", y: 0, height: 180 }],
        nodes: [
          {
            id: "agent0_clarify_scope",
            label: "澄清研究范围",
            description: "明确研究边界。",
            kind: "agent",
            laneId: "main",
            x: 24,
            y: 48,
            width: 160,
            height: 64,
          },
          {
            id: "agent1_extract_research_spec",
            label: "提炼研究任务",
            description: "生成研究简报。",
            kind: "agent",
            laneId: "main",
            x: 240,
            y: 48,
            width: 160,
            height: 64,
          },
        ],
        edges: [
          {
            from: "agent0_clarify_scope",
            to: "agent1_extract_research_spec",
          },
        ],
      },
      run: {
        id: "run-live",
        status: "RUNNING",
        progressPercent: 0,
        currentNodeKey: "agent0_clarify_scope",
        input: {},
        errorCode: null,
        errorMessage: null,
        result: {},
        template: { code: "industry_research", version: 3 },
        createdAt: new Date(0),
        nodes: [],
        events: [],
      },
      liveEvents: [
        {
          sequence: 3,
          eventType: "NODE_SUCCEEDED",
          nodeKey: "agent0_clarify_scope",
          occurredAt: new Date(3),
        },
        {
          sequence: 4,
          eventType: "NODE_PROGRESS",
          nodeKey: "agent1_extract_research_spec",
          payload: { message: "正在生成研究问题与执行单元" },
          occurredAt: new Date(4),
        },
      ],
    });

    expect(runtime.nodeStates.agent0_clarify_scope?.status).toBe("done");
    expect(runtime.nodeStates.agent1_extract_research_spec?.status).toBe(
      "active",
    );
    expect(runtime.nodeStates.agent1_extract_research_spec?.latestProgress)
      .toMatchObject({ message: "正在生成研究问题与执行单元" });
    expect(runtime.currentNodeId).toBe("agent1_extract_research_spec");
    expect(runtime.visitedEdges).toContainEqual({
      from: "agent0_clarify_scope",
      to: "agent1_extract_research_spec",
    });
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkflowStateDiagram } from "~/app/workflows/workflow-state-diagram";
import type {
  WorkflowDiagramRuntimeState,
  WorkflowDiagramSpec,
} from "~/app/workflows/workflow-diagram";

describe("WorkflowStateDiagram", () => {
  it("把节点详情渲染为可聚焦的动态信息弹层", () => {
    const spec: WorkflowDiagramSpec = {
      templateCode: "industry_research",
      templateVersion: 1,
      title: "行业研究 Agent 状态图",
      layout: { width: 900, height: 260 },
      lanes: [{ id: "main", label: "主流程", y: 0, height: 260 }],
      nodes: [
        {
          id: "question",
          label: "问题结构化",
          description: "提取研究问题和关键约束。",
          kind: "agent",
          laneId: "main",
          x: 40,
          y: 80,
          width: 160,
          height: 72,
        },
      ],
      edges: [],
    };
    const runtime: WorkflowDiagramRuntimeState = {
      currentNodeId: "question",
      nodeStates: {
        question: {
          status: "active",
          attempt: 1,
          eventSummary: "正在分析问题",
          insight: {
            fields: [
              {
                label: "本次识别的重点",
                value: {
                  kind: "list",
                  items: ["AI 服务器需求", "先进制程供给"],
                },
              },
            ],
            downstreamNote: "将据此规划行业趋势与公司筛选。",
          },
        },
      },
      visitedNodeIds: ["question"],
      visitedEdges: [],
      fallback: null,
    };

    const html = renderToStaticMarkup(
      React.createElement(WorkflowStateDiagram, { spec, runtime }),
    );

    expect(html).toContain('aria-describedby="workflow-node-tooltip-question"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("pointer-events-auto");
    expect(html).toContain("节点详情");
    expect(html).toContain("本节点作用");
    expect(html).toContain("本次识别的重点");
    expect(html).toContain("对下一步的影响");
    expect(html).not.toContain("选择一个节点");
  });
});

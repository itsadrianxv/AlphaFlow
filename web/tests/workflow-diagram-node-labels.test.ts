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
});

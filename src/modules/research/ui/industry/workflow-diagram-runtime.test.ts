import { describe, expect, it } from "vitest";
import {
  buildWorkflowDiagramRuntimeState,
  type WorkflowDiagramRunDetail,
} from "~/modules/research/ui/industry/workflow-diagram-runtime";
import { getWorkflowDiagramSpec } from "~/modules/research/ui/industry/workflow-diagram-specs";

function createRunDetail(
  overrides: Partial<WorkflowDiagramRunDetail> = {},
): WorkflowDiagramRunDetail {
  return {
    id: "run_1",
    query: "AI infra",
    status: "RUNNING",
    progressPercent: 25,
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
    nodes: [],
    events: [],
    ...overrides,
  };
}

describe("workflow diagram runtime state", () => {
  it("marks the current node active and visited edges from completed node events", () => {
    const spec = getWorkflowDiagramSpec("quick_industry_research", 3);
    expect(spec).not.toBeNull();
    if (!spec) {
      throw new Error("expected quick research diagram spec");
    }

    const runtime = buildWorkflowDiagramRuntimeState({
      spec,
      run: createRunDetail({
        nodes: [
          {
            id: "node_1",
            nodeKey: "agent0_clarify_scope",
            agentName: "agent0_clarify_scope",
            attempt: 1,
            status: "SUCCEEDED",
            errorCode: null,
            errorMessage: null,
            durationMs: 1200,
            startedAt: new Date("2026-04-22T08:00:05.000Z"),
            completedAt: new Date("2026-04-22T08:00:06.200Z"),
            output: {
              summary: "Clarified scope",
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
            occurredAt: new Date("2026-04-22T08:00:06.200Z"),
          },
          {
            id: "event_2",
            sequence: 2,
            eventType: "NODE_STARTED",
            payload: {
              nodeKey: "agent1_extract_research_spec",
            },
            occurredAt: new Date("2026-04-22T08:00:07.000Z"),
          },
        ],
      }),
    });

    expect(runtime.currentNodeId).toBe("agent1_extract_research_spec");
    expect(runtime.nodeStates.agent0_clarify_scope?.status).toBe("done");
    expect(runtime.nodeStates.agent1_extract_research_spec?.status).toBe(
      "active",
    );
    expect(
      runtime.visitedEdges.some(
        (edge) =>
          edge.from === "agent0_clarify_scope" &&
          edge.to === "agent1_extract_research_spec",
      ),
    ).toBe(true);
  });

  it("treats skipped nodes as terminally visited when skip payload is emitted", () => {
    const spec = getWorkflowDiagramSpec("quick_industry_research", 3);
    expect(spec).not.toBeNull();
    if (!spec) {
      throw new Error("expected quick research diagram spec");
    }

    const runtime = buildWorkflowDiagramRuntimeState({
      spec,
      run: createRunDetail({
        status: "SUCCEEDED",
        currentNodeKey: "agent6_reflection",
        nodes: [
          {
            id: "node_skip",
            nodeKey: "agent4_credibility_and_competition",
            agentName: "agent4_credibility_and_competition",
            attempt: 1,
            status: "SKIPPED",
            errorCode: null,
            errorMessage: null,
            durationMs: 0,
            startedAt: new Date("2026-04-22T08:00:08.000Z"),
            completedAt: new Date("2026-04-22T08:00:08.000Z"),
            output: {
              skipped: true,
            },
          },
        ],
        events: [
          {
            id: "event_skip",
            sequence: 4,
            eventType: "NODE_SUCCEEDED",
            payload: {
              nodeKey: "agent4_credibility_and_competition",
              skipped: true,
              reason: "insufficient_sources",
            },
            occurredAt: new Date("2026-04-22T08:00:08.000Z"),
          },
        ],
      }),
    });

    expect(runtime.nodeStates.agent4_credibility_and_competition?.status).toBe(
      "skipped",
    );
  });

  it("highlights fan-out and join edges for company collector runs", () => {
    const spec = getWorkflowDiagramSpec("company_research_center", 4);
    expect(spec).not.toBeNull();
    if (!spec) {
      throw new Error("expected company research diagram spec");
    }

    const runtime = buildWorkflowDiagramRuntimeState({
      spec,
      run: createRunDetail({
        template: {
          code: "company_research_center",
          version: 4,
        },
        currentNodeKey: "agent4_synthesis",
        nodes: [
          {
            id: "collector_1",
            nodeKey: "collector_official_sources",
            agentName: "collector_official_sources",
            attempt: 1,
            status: "SUCCEEDED",
            errorCode: null,
            errorMessage: null,
            durationMs: 1000,
            startedAt: new Date("2026-04-22T08:00:10.000Z"),
            completedAt: new Date("2026-04-22T08:00:11.000Z"),
            output: {},
          },
          {
            id: "collector_2",
            nodeKey: "collector_financial_sources",
            agentName: "collector_financial_sources",
            attempt: 1,
            status: "SUCCEEDED",
            errorCode: null,
            errorMessage: null,
            durationMs: 1000,
            startedAt: new Date("2026-04-22T08:00:10.100Z"),
            completedAt: new Date("2026-04-22T08:00:11.100Z"),
            output: {},
          },
          {
            id: "collector_3",
            nodeKey: "collector_news_sources",
            agentName: "collector_news_sources",
            attempt: 1,
            status: "FAILED",
            errorCode: "NEWS_TIMEOUT",
            errorMessage: "timeout",
            durationMs: 2100,
            startedAt: new Date("2026-04-22T08:00:10.200Z"),
            completedAt: new Date("2026-04-22T08:00:12.300Z"),
            output: {},
          },
        ],
        events: [
          {
            id: "event_fanout_1",
            sequence: 1,
            eventType: "NODE_STARTED",
            payload: {
              nodeKey: "agent3_source_grounding",
            },
            occurredAt: new Date("2026-04-22T08:00:09.000Z"),
          },
          {
            id: "event_fanout_2",
            sequence: 2,
            eventType: "NODE_SUCCEEDED",
            payload: {
              nodeKey: "collector_official_sources",
            },
            occurredAt: new Date("2026-04-22T08:00:11.000Z"),
          },
          {
            id: "event_fanout_3",
            sequence: 3,
            eventType: "NODE_SUCCEEDED",
            payload: {
              nodeKey: "collector_financial_sources",
            },
            occurredAt: new Date("2026-04-22T08:00:11.100Z"),
          },
          {
            id: "event_fanout_4",
            sequence: 4,
            eventType: "NODE_FAILED",
            payload: {
              nodeKey: "collector_news_sources",
            },
            occurredAt: new Date("2026-04-22T08:00:12.300Z"),
          },
          {
            id: "event_fanout_5",
            sequence: 5,
            eventType: "NODE_STARTED",
            payload: {
              nodeKey: "agent4_synthesis",
            },
            occurredAt: new Date("2026-04-22T08:00:12.500Z"),
          },
        ],
      }),
    });

    expect(runtime.nodeStates.collector_official_sources?.status).toBe("done");
    expect(runtime.nodeStates.collector_news_sources?.status).toBe("failed");
    expect(
      runtime.visitedEdges.some(
        (edge) =>
          edge.from === "agent3_source_grounding" &&
          edge.to === "collector_official_sources",
      ),
    ).toBe(true);
    expect(
      runtime.visitedEdges.some(
        (edge) =>
          edge.from === "collector_financial_sources" &&
          edge.to === "agent4_synthesis",
      ),
    ).toBe(true);
  });

  it("returns a degraded ordered-node fallback when the spec is unknown", () => {
    const runtime = buildWorkflowDiagramRuntimeState({
      spec: null,
      run: createRunDetail({
        template: {
          code: "unknown_template",
          version: 1,
        },
        currentNodeKey: "custom_step_2",
        nodes: [
          {
            id: "node_custom_1",
            nodeKey: "custom_step_1",
            agentName: "custom_step_1",
            attempt: 1,
            status: "SUCCEEDED",
            errorCode: null,
            errorMessage: null,
            durationMs: 250,
            startedAt: new Date("2026-04-22T08:00:01.000Z"),
            completedAt: new Date("2026-04-22T08:00:01.250Z"),
            output: {},
          },
          {
            id: "node_custom_2",
            nodeKey: "custom_step_2",
            agentName: "custom_step_2",
            attempt: 1,
            status: "RUNNING",
            errorCode: null,
            errorMessage: null,
            durationMs: null,
            startedAt: new Date("2026-04-22T08:00:02.000Z"),
            completedAt: null,
            output: {},
          },
        ],
        events: [],
      }),
    });

    expect(runtime.fallback).not.toBeNull();
    expect(runtime.fallback?.orderedNodes.map((node) => node.id)).toEqual([
      "custom_step_1",
      "custom_step_2",
    ]);
    expect(runtime.fallback?.notice).toContain("unknown_template");
  });
});

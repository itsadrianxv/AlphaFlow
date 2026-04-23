import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildRunView } from "~/modules/research/server/application/workflow/run-view";
import {
  buildFlow,
  makeEdge,
  makeNode,
  makeStage,
  type NodeResult,
} from "~/modules/research/server/domain/workflow/flow-spec";

const demoFlow = buildFlow({
  templateCode: "demo_flow",
  templateVersion: 1,
  name: "Demo Flow",
  stages: [
    makeStage({ key: "scope", name: "Scope" }),
    makeStage({ key: "run", name: "Run" }),
  ],
  nodes: [
    makeNode({
      key: "clarify",
      kind: "agent",
      name: "Clarify",
      goal: "Clarify the request",
      tools: ["brief"],
      in: z.object({}),
      out: z.object({ ready: z.boolean() }),
      routes: ["ok"],
      view: { stage: "scope", show: true },
    }),
    makeNode({
      key: "collect",
      kind: "tool",
      name: "Collect",
      goal: "Collect evidence",
      tools: ["search"],
      in: z.object({}),
      out: z.object({ count: z.number() }),
      routes: ["ok"],
      view: { stage: "run", show: false },
    }),
    makeNode({
      key: "report",
      kind: "agent",
      name: "Report",
      goal: "Write the report",
      tools: ["write"],
      in: z.object({}),
      out: z.object({ title: z.string() }),
      routes: ["ok", "pause"],
      view: { stage: "run", show: true },
    }),
  ],
  edges: [
    makeEdge({ from: "clarify", to: "collect", when: "ok" }),
    makeEdge({ from: "collect", to: "report", when: "ok" }),
  ],
});

function makeResult(
  params: Partial<NodeResult> & { data?: Record<string, unknown> } = {},
): NodeResult {
  return {
    status: params.status ?? "ok",
    data: params.data ?? {},
    route: params.route ?? { key: "ok", reason: "done" },
    note: params.note ?? "done",
    stats: params.stats ?? {},
    items: params.items ?? [],
    view: params.view ?? {},
    error: params.error ?? null,
  };
}

describe("buildRunView", () => {
  it("builds a user view with only visible nodes and an active path", () => {
    const runView = buildRunView({
      flow: demoFlow,
      run: {
        id: "run_1",
        status: "RUNNING",
        progressPercent: 50,
        currentNodeKey: "report",
        result: { title: "Draft" },
      },
      nodeRuns: [
        {
          id: "node_1",
          nodeKey: "clarify",
          status: "SUCCEEDED",
          output: makeResult({
            note: "scope ready",
            stats: { ready: true },
            data: { ready: true },
          }),
        },
        {
          id: "node_2",
          nodeKey: "collect",
          status: "SUCCEEDED",
          output: makeResult({
            note: "3 sources",
            stats: { count: 3 },
            data: { count: 3 },
          }),
        },
      ],
      events: [],
    });

    expect(runView.user.nodes.map((node) => node.key)).toEqual([
      "clarify",
      "report",
    ]);
    expect(runView.user.activePath).toEqual(["clarify", "report"]);
    expect(
      runView.user.nodes.find((node) => node.key === "report")?.state,
    ).toBe("active");
    expect(
      runView.debug.nodes.find((node) => node.key === "collect")?.state,
    ).toBe("done");
  });

  it("marks the current gate node as paused for user view", () => {
    const runView = buildRunView({
      flow: demoFlow,
      run: {
        id: "run_2",
        status: "PAUSED",
        progressPercent: 80,
        currentNodeKey: "report",
        result: null,
      },
      nodeRuns: [
        {
          id: "node_1",
          nodeKey: "clarify",
          status: "SUCCEEDED",
          output: makeResult({ data: { ready: true } }),
        },
      ],
      events: [],
    });

    expect(runView.user.current?.key).toBe("report");
    expect(runView.user.current?.state).toBe("paused");
  });
});

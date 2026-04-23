import { describe, expect, it } from "vitest";
import { z } from "zod";
import { WorkflowDomainError } from "~/modules/research/server/domain/workflow/errors";
import {
  buildFlow,
  makeEdge,
  makeNode,
  makeNodeResult,
  makeStage,
} from "~/modules/research/server/domain/workflow/flow-spec";
import { WorkflowGraphRegistry } from "~/modules/research/server/workflows/langgraph/graph-registry";
import type { WorkflowGraphRunner } from "~/modules/research/server/workflows/langgraph/workflow-graph";

function createGraph(
  templateCode: string,
  templateVersion?: number,
): WorkflowGraphRunner {
  const spec = buildFlow({
    templateCode,
    templateVersion,
    name: templateCode,
    stages: [makeStage({ key: "run", name: "Run" })],
    nodes: [
      makeNode({
        key: "node_1",
        kind: "agent",
        name: "Node",
        goal: "Node",
        tools: [],
        in: z.record(z.string(), z.unknown()),
        out: z.record(z.string(), z.unknown()),
        routes: ["ok"],
        view: { stage: "run", show: true },
      }),
    ],
    edges: [makeEdge({ from: "node_1", to: "node_1", when: "ok" })],
  });

  return {
    templateCode,
    templateVersion,
    spec,
    getNodeOrder: () => [],
    buildInitialState: () =>
      ({
        runId: "run-1",
        userId: "user-1",
        query: "query",
        progressPercent: 0,
        errors: [],
      }) as never,
    buildNodeResult: () => makeNodeResult(),
    mergeNodeResult: (state: { runId: string }) => state as never,
    getRunResult: () => ({}),
    execute: async ({ initialState }) => initialState,
  };
}

describe("WorkflowGraphRegistry", () => {
  it("returns the requested template version when multiple versions share one code", () => {
    const legacy = createGraph("company_research_center", 1);
    const current = createGraph("company_research_center", 2);
    const registry = new WorkflowGraphRegistry([legacy, current]);

    expect(registry.get("company_research_center", 1)).toBe(legacy);
    expect(registry.get("company_research_center", 2)).toBe(current);
    expect(registry.get("company_research_center")).toBe(current);
  });

  it("does not silently fall back to an older graph when an explicit version is missing", () => {
    const legacy = createGraph("company_research_center", 1);
    const current = createGraph("company_research_center", 2);
    const registry = new WorkflowGraphRegistry([legacy, current]);

    expect(() => registry.get("company_research_center", 4)).toThrowError(
      WorkflowDomainError,
    );
  });
});

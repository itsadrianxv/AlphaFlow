import { describe, expect, it } from "vitest";
import { WorkflowDomainError } from "~/server/domain/workflow/errors";
import { WorkflowGraphRegistry } from "~/server/infrastructure/workflow/langgraph/graph-registry";
import type { WorkflowGraphRunner } from "~/server/infrastructure/workflow/langgraph/workflow-graph";

function createGraph(
  templateCode: string,
  templateVersion?: number,
): WorkflowGraphRunner {
  return {
    templateCode,
    templateVersion,
    getNodeOrder: () => [],
    buildInitialState: () =>
      ({
        runId: "run-1",
        userId: "user-1",
        query: "query",
        progressPercent: 0,
        errors: [],
      }) as never,
    getNodeOutput: () => ({}),
    getNodeEventPayload: () => ({}),
    mergeNodeOutput: (state) => state,
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

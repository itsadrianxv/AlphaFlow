import { describe, expect, it } from "vitest";
import {
  buildFlowMap,
  getFlowSpec,
  listFlowSpecs,
} from "~/modules/research/server/domain/workflow/flow-specs";
import {
  COMPANY_RESEARCH_TEMPLATE_CODE,
  QUICK_RESEARCH_TEMPLATE_CODE,
  SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
  SCREENING_TO_TIMING_TEMPLATE_CODE,
  TIMING_REVIEW_LOOP_TEMPLATE_CODE,
  TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
  WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
} from "~/modules/research/server/domain/workflow/types";

describe("flow specs", () => {
  it("registers every workflow template with stages, nodes, and routes", () => {
    const specs = listFlowSpecs();
    const codes = specs.map((spec) => spec.templateCode);

    expect(codes).toEqual(
      expect.arrayContaining([
        QUICK_RESEARCH_TEMPLATE_CODE,
        COMPANY_RESEARCH_TEMPLATE_CODE,
        SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE,
        TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE,
        WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE,
        WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE,
        SCREENING_TO_TIMING_TEMPLATE_CODE,
        TIMING_REVIEW_LOOP_TEMPLATE_CODE,
      ]),
    );

    for (const spec of specs) {
      expect(spec.stages.length).toBeGreaterThan(0);
      expect(spec.nodes.length).toBeGreaterThan(0);
      expect(spec.edges.length).toBeGreaterThan(0);

      const nodeMap = new Map(spec.nodes.map((node) => [node.key, node]));
      const stageKeys = new Set(spec.stages.map((stage) => stage.key));

      for (const node of spec.nodes) {
        expect(node.name.length).toBeGreaterThan(0);
        expect(node.goal.length).toBeGreaterThan(0);
        expect(stageKeys.has(node.view.stage)).toBe(true);
        expect(node.routes.length).toBeGreaterThan(0);
      }

      for (const edge of spec.edges) {
        const source = nodeMap.get(edge.from);
        expect(source).toBeDefined();
        expect(nodeMap.has(edge.to)).toBe(true);
        expect(source?.routes).toContain(edge.when);
      }
    }
  });

  it("builds a user flow map that hides internal nodes", () => {
    const spec = getFlowSpec(COMPANY_RESEARCH_TEMPLATE_CODE, 4);
    const flowMap = buildFlowMap(spec, "user");

    expect(
      flowMap.nodes.some((node) => node.key === "agent0_clarify_scope"),
    ).toBe(true);
    expect(
      flowMap.nodes.some((node) => node.key === "collector_official_sources"),
    ).toBe(false);
    expect(flowMap.stages.map((stage) => stage.name)).toEqual([
      "范围澄清",
      "资料收集",
      "评审校验",
      "结果输出",
    ]);
  });

  it("builds a debug flow map that keeps internal nodes", () => {
    const spec = getFlowSpec(COMPANY_RESEARCH_TEMPLATE_CODE, 4);
    const flowMap = buildFlowMap(spec, "debug");

    expect(
      flowMap.nodes.some((node) => node.key === "collector_official_sources"),
    ).toBe(true);
    expect(
      flowMap.edges.some(
        (edge) =>
          edge.from === "agent3_source_grounding" &&
          edge.to === "collector_official_sources",
      ),
    ).toBe(true);
  });
});

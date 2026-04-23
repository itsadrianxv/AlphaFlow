import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WorkflowAgentStep } from "~/modules/research/ui/industry/workflow-agent-step";
import type { WorkflowDiagramRunDetail } from "~/modules/research/ui/industry/workflow-diagram-runtime";

function createRun(
  overrides: Partial<WorkflowDiagramRunDetail> = {},
): WorkflowDiagramRunDetail {
  return {
    id: "run_1",
    query: "AI infra",
    status: "RUNNING",
    progressPercent: 42,
    currentNodeKey: "agent1_extract_research_spec",
    input: {},
    errorCode: null,
    errorMessage: null,
    result: {
      researchPlan: [
        {
          id: "unit_1",
          title: "official_sources",
          capability: "official_sources",
          role: "research_analyst",
          priority: "high",
          expectedArtifact: "research_note",
          dependsOn: [],
          fallbackCapabilities: ["web_search"],
          acceptanceCriteria: ["first_party_sources_present"],
        },
      ],
      reflection: {
        status: "warn",
        summary: "Need more first-party evidence.",
        contractScore: 88,
        citationCoverage: 0.75,
        firstPartyRatio: 0.25,
        qualityFlags: ["first_party_low"],
        missingRequirements: ["citation_coverage_below_target"],
        unansweredQuestions: [],
        suggestedFixes: ["Add official filings"],
      },
    },
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
      {
        id: "node_2",
        nodeKey: "agent1_extract_research_spec",
        agentName: "agent1_extract_research_spec",
        attempt: 1,
        status: "RUNNING",
        errorCode: null,
        errorMessage: null,
        durationMs: null,
        startedAt: new Date("2026-04-22T08:00:06.000Z"),
        completedAt: null,
        output: {},
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
      {
        id: "event_2",
        sequence: 2,
        eventType: "NODE_STARTED",
        payload: {
          nodeKey: "agent1_extract_research_spec",
        },
        occurredAt: new Date("2026-04-22T08:00:06.000Z"),
      },
    ],
    ...overrides,
  };
}

describe("WorkflowAgentStep", () => {
  it("renders state diagram, runtime summary, and research ops panels when run metadata exists", () => {
    const markup = renderToStaticMarkup(
      React.createElement(WorkflowAgentStep, {
        run: createRun(),
      }),
    );

    expect(markup).toContain("Agent 状态图");
    expect(markup).toContain("data-workflow-state-diagram");
    expect(markup).toContain("运行摘要");
    expect(markup).toContain("42%");
    expect(markup).toContain("当前节点");
    expect(markup).toContain("研究计划图谱");
    expect(markup).toContain("Need more first-party evidence.");
  });

  it("keeps the agent step visible with an empty state when run is missing", () => {
    const markup = renderToStaticMarkup(
      React.createElement(WorkflowAgentStep, {
        run: null,
      }),
    );

    expect(markup).toContain("Agent 状态图");
    expect(markup).toContain("暂无 Agent 运行数据");
  });

  it("renders fallback diagram state when the workflow spec is unknown", () => {
    const markup = renderToStaticMarkup(
      React.createElement(WorkflowAgentStep, {
        run: createRun({
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
              startedAt: new Date("2026-04-22T08:00:06.000Z"),
              completedAt: null,
              output: {},
            },
          ],
        }),
      }),
    );

    expect(markup).toContain('data-workflow-state-diagram="fallback"');
    expect(markup).toContain("unknown_template");
    expect(markup).toContain("custom_step");
  });
});

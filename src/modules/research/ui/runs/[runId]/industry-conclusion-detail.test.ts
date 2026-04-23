import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { WorkflowDiagramRunDetail } from "~/modules/research/ui/industry/workflow-diagram-runtime";
import {
  IndustryConclusionDetail,
  type IndustryConclusionViewModel,
} from "~/modules/research/ui/runs/[runId]/industry-conclusion-detail";

const model: IndustryConclusionViewModel = {
  query: "AI infra",
  generatedAtLabel: "2026/04/14 09:10",
  headline: "AI infra is entering a validation window.",
  summary:
    "Read the **conclusion** first, then work through evidence and risk.",
  verdictLabel: "High Conviction",
  verdictTone: "success",
  activeSectionId: "overview",
  statusLabel: "Complete",
  modePills: ["Deep Mode"],
  metricStrip: [
    { label: "Confidence", value: "86" },
    { label: "Heat", value: "82%" },
    { label: "Candidates", value: "6" },
    { label: "Top Picks", value: "2" },
  ],
  overviewPoints: [
    "Industry demand and event flow are resonating.",
    "Concentrating into leaders is better than broad exposure.",
  ],
  overviewActions: [
    {
      label: "Continue 中际旭创",
      href: "/company-research?companyName=%E4%B8%AD%E9%99%85%E6%97%AD%E5%88%9B",
      variant: "primary",
    },
    { label: "Add to Space", href: "/spaces?addRunId=run_quick_1" },
  ],
  notices: [
    {
      title: "Timing Report",
      description: "Open the linked timing report for structure and follow-up.",
      tone: "info",
      actions: [{ label: "View Report", href: "/timing/reports/card_1" }],
    },
  ],
  sections: [
    { id: "overview", label: "Overview", summary: "Conclusion and actions" },
    { id: "logic", label: "Logic", summary: "Industry drivers and picks" },
    { id: "evidence", label: "Evidence", summary: "Support and gaps" },
    { id: "risks", label: "Risks", summary: "Open risks and next steps" },
  ],
  logic: {
    industryDrivers: ["Orders and expansion cadence are aligned."],
    competitionSummary: "Competition still favors leaders.",
    topPicks: [
      {
        stockCode: "300308",
        stockName: "中际旭创",
        reason: "800G volume continues.",
        href: "/company-research?companyName=%E4%B8%AD%E9%99%85%E6%97%AD%E5%88%9B",
      },
    ],
  },
  evidence: {
    scoreLabel: "86",
    levelLabel: "High",
    coverageLabel: "88%",
    tripletLabel: "1/1/0",
    notes: ["First-party evidence is still thin."],
    qualityFlags: ["first_party_low"],
    missingRequirements: ["citation_coverage_below_target"],
    claims: [
      {
        claimId: "claim_1",
        claimText: "Leader orders are monetizing faster.",
        label: "supported",
        explanation: "Announcements and news validate **order cadence**.",
      },
    ],
    researchPlan: [
      {
        id: "unit_theme",
        title: "Theme tracking",
        capability: "theme_overview",
        status: "completed",
      },
    ],
  },
  risks: {
    summary: "Still need cross-checks against filings and disclosures.",
    missingAreas: ["Filings lag"],
    riskSignals: ["Valuation still needs profit confirmation"],
    unansweredQuestions: ["Can profits support the current multiple?"],
    nextActions: ["Add filings check", "Transition to company research"],
  },
};

function createRun(
  overrides: Partial<WorkflowDiagramRunDetail> = {},
): WorkflowDiagramRunDetail {
  return {
    id: "run_quick_1",
    query: "AI infra",
    status: "SUCCEEDED",
    progressPercent: 100,
    currentNodeKey: "agent6_reflection",
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
    completedAt: new Date("2026-04-22T08:05:00.000Z"),
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
        output: {},
      },
    ],
    events: [],
    ...overrides,
  };
}

describe("IndustryConclusionDetail", () => {
  it("renders five steps with agent first and defaults to the agent step", () => {
    const markup = renderToStaticMarkup(
      React.createElement(IndustryConclusionDetail, {
        model,
        run: createRun(),
      }),
    );

    expect(markup).toContain('data-industry-conclusion-detail="true"');
    expect(markup).toContain('data-stage-switcher="true"');
    expect(markup).toContain('data-active-tab="agent"');
    expect(markup).toContain("Agent 状态图");
    expect(markup).toContain("总览");
    expect(markup).toContain("核心逻辑");
    expect(markup).toContain("证据与可信度");
    expect(markup).toContain("风险与下一步");
    expect(markup).toContain("先看 Agent 状态图、运行摘要和研究执行状态。");
  });

  it("respects initialSectionId for non-agent steps", () => {
    const markup = renderToStaticMarkup(
      React.createElement(IndustryConclusionDetail, {
        model,
        run: createRun(),
        initialSectionId: "evidence",
      }),
    );

    expect(markup).toContain('data-active-tab="evidence"');
    expect(markup).toContain("order cadence");
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  IndustryConclusionDetail,
  type IndustryConclusionViewModel,
} from "~/app/workflows/[runId]/industry-conclusion-detail";

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

describe("IndustryConclusionDetail", () => {
  it("renders the full stacked conclusion document", () => {
    const markup = renderToStaticMarkup(
      React.createElement(IndustryConclusionDetail, { model }),
    );

    expect(markup).toContain('data-industry-conclusion-detail="true"');
    expect(markup).toContain("AI infra is entering a validation window.");
    expect(markup).toContain("View Report");
    expect(markup).toContain("Industry demand and event flow are resonating.");
    expect(markup).toContain("Orders and expansion cadence are aligned.");
    expect(markup).toContain("Leader orders are monetizing faster.");
    expect(markup).toContain("Can profits support the current multiple?");
  });

  it("ignores initialSectionId and keeps all sections visible in the stacked layout", () => {
    const markup = renderToStaticMarkup(
      React.createElement(IndustryConclusionDetail, {
        model,
        initialSectionId: "evidence",
      }),
    );

    expect(markup).toContain("本轮结论");
    expect(markup).toContain("行业驱动");
    expect(markup).toContain("证据校验");
    expect(markup).toContain("风险判断");
    expect(markup).toContain("order cadence");
  });
});

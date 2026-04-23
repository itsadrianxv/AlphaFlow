import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CompanyResearchResultDto } from "~/modules/research/server/domain/workflow/types";
import {
  buildCompanyResearchDetailModel,
  CompanyResearchDetailContent,
  CompanyResearchDetailPanels,
  CompanyResearchPausedFallbackPanel,
} from "~/modules/research/ui/industry/company-research-detail";
import type { WorkflowDiagramRunDetail } from "~/modules/research/ui/industry/workflow-diagram-runtime";

function createCompanyResearchResult(): CompanyResearchResultDto {
  return {
    brief: {
      companyName: "Example Co",
      stockCode: "600000",
      officialWebsite: "https://example.com",
      researchGoal: "Validate margin expansion",
      focusConcepts: ["Compute", "Datacenter"],
      keyQuestions: ["Is growth monetizing?"],
    },
    conceptInsights: [
      {
        concept: "Compute",
        whyItMatters: "Demand growth drives **capex**.",
        companyFit: "The company already has `rack` capability.",
        monetizationPath: "- Raise ASP\n- Extend service cycle",
        maturity: "成长加速",
      },
    ],
    deepQuestions: [
      {
        question: "Is growth monetizing?",
        whyImportant: "Determines whether valuation expansion is durable.",
        targetMetric: "**Orders** and margin rate",
        dataHint: "Track order growth versus margin trend",
      },
    ],
    findings: [
      {
        question: "Is growth monetizing?",
        answer: "Order growth is starting to transmit into margin.",
        confidence: "high",
        evidenceUrls: ["https://example.com/report"],
        referenceIds: ["ref-1"],
        gaps: ["Need one more quarter of confirmation"],
      },
    ],
    evidence: [
      {
        referenceId: "ref-1",
        title: "2026Q1 IR note",
        sourceName: "Example IR",
        url: "https://example.com/report",
        sourceType: "official",
        sourceTier: "first_party",
        collectorKey: "official_sources",
        isFirstParty: true,
        snippet: "Management says order quality is improving.",
        extractedFact: "Order quality improved with higher margin.",
        relevance: "Directly addresses monetization.",
        publishedAt: "2026-03-12",
      },
    ],
    references: [
      {
        id: "ref-1",
        title: "2026Q1 IR note",
        sourceName: "Example IR",
        snippet: "Management says order quality is improving.",
        extractedFact: "Order quality improved with higher margin.",
        url: "https://example.com/report",
        publishedAt: "2026-03-12",
        credibilityScore: 95,
        sourceType: "official",
        sourceTier: "first_party",
        collectorKey: "official_sources",
        isFirstParty: true,
      },
    ],
    verdict: {
      stance: "优先研究",
      summary: "Growth and margin show **positive validation**.",
      bullPoints: ["Margin improvement confirmed by management"],
      bearPoints: ["Validation window is still short"],
      nextChecks: ["Track next quarter margin trend"],
    },
    collectionSummary: {
      collectors: [
        {
          collectorKey: "official_sources",
          label: "Official Sources",
          rawCount: 3,
          curatedCount: 2,
          referenceCount: 1,
          firstPartyCount: 1,
          configured: true,
          notes: [],
        },
      ],
      totalRawCount: 6,
      totalCuratedCount: 3,
      totalReferenceCount: 1,
      totalFirstPartyCount: 1,
      notes: [],
    },
    crawler: {
      provider: "tavily",
      configured: true,
      queries: [],
      notes: [],
    },
    confidenceAnalysis: {
      status: "COMPLETE",
      finalScore: 88,
      level: "high",
      claimCount: 1,
      supportedCount: 1,
      insufficientCount: 0,
      contradictedCount: 0,
      abstainCount: 0,
      supportRate: 1,
      insufficientRate: 0,
      contradictionRate: 0,
      abstainRate: 0,
      evidenceCoverageScore: 91,
      freshnessScore: 86,
      sourceDiversityScore: 74,
      notes: ["High first-party coverage"],
      claims: [],
    },
    researchPlan: [
      {
        id: "unit_1",
        title: "official_sources",
        objective: "Collect first-party evidence",
        keyQuestions: ["Is growth monetizing?"],
        capability: "official_search",
        role: "research_analyst",
        priority: "high",
        expectedArtifact: "research_note",
        dependsOn: [],
        fallbackCapabilities: ["news_search"],
        acceptanceCriteria: ["first_party_sources_present"],
      },
    ],
    researchUnitRuns: [
      {
        unitId: "unit_1",
        title: "official_sources",
        capability: "official_search",
        status: "completed",
        attempt: 1,
        repairCount: 0,
        qualityFlags: [],
        fallbackUsed: undefined,
        validationErrors: [],
        startedAt: "2026-03-12T08:00:05.000Z",
        completedAt: "2026-03-12T08:00:06.000Z",
        notes: [],
        sourceUrls: ["https://example.com/report"],
        evidenceCount: 1,
      },
    ],
    reflection: {
      status: "warn",
      summary: "Need more first-party evidence.",
      contractScore: 88,
      citationCoverage: 0.75,
      firstPartyRatio: 0.25,
      answeredQuestionCoverage: 1,
      missingRequirements: ["citation_coverage_below_target"],
      unansweredQuestions: [],
      qualityFlags: ["first_party_low"],
      suggestedFixes: ["Add official filings"],
    },
    generatedAt: "2026-03-12T08:00:00.000Z",
  };
}

function createWorkflowRun(
  overrides: Partial<WorkflowDiagramRunDetail> = {},
): WorkflowDiagramRunDetail {
  return {
    id: "run_company_1",
    query: "Example Co",
    status: "SUCCEEDED",
    progressPercent: 100,
    currentNodeKey: "agent8_finalize_report",
    input: {},
    errorCode: null,
    errorMessage: null,
    result: createCompanyResearchResult(),
    template: {
      code: "company_research_center",
      version: 4,
    },
    createdAt: new Date("2026-03-12T08:00:00.000Z"),
    startedAt: new Date("2026-03-12T08:00:05.000Z"),
    completedAt: new Date("2026-03-12T08:05:00.000Z"),
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
        startedAt: new Date("2026-03-12T08:00:05.000Z"),
        completedAt: new Date("2026-03-12T08:00:05.800Z"),
        output: {},
      },
      {
        id: "node_2",
        nodeKey: "agent8_finalize_report",
        agentName: "agent8_finalize_report",
        attempt: 1,
        status: "SUCCEEDED",
        errorCode: null,
        errorMessage: null,
        durationMs: 1200,
        startedAt: new Date("2026-03-12T08:03:00.000Z"),
        completedAt: new Date("2026-03-12T08:03:01.200Z"),
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
        occurredAt: new Date("2026-03-12T08:00:05.800Z"),
      },
      {
        id: "event_2",
        sequence: 2,
        eventType: "NODE_SUCCEEDED",
        payload: {
          nodeKey: "agent8_finalize_report",
        },
        occurredAt: new Date("2026-03-12T08:03:01.200Z"),
      },
    ],
    ...overrides,
  };
}

describe("company-research-detail", () => {
  it("builds a structured company research detail model", () => {
    const model = buildCompanyResearchDetailModel({
      status: "SUCCEEDED",
      result: createCompanyResearchResult(),
    });

    expect(model?.kind).toBe("detail");
    if (!model || model.kind !== "detail") {
      throw new Error("expected detail model");
    }

    expect(model.backgroundItems.map((item) => item.label)).toHaveLength(6);
    expect(model.questionCards).toHaveLength(1);
    expect(model.questionCards[0]?.referencePreview).toHaveLength(1);
    expect(
      model.referenceFilters.some(
        (item) => item.id === "official" && item.count === 1,
      ),
    ).toBe(true);
  });

  it("normalizes legacy conceptInsights payloads without crashing", () => {
    const result = {
      ...createCompanyResearchResult(),
      conceptInsights: {
        concept_insights: [
          {
            concept: "core_business",
            insight: "legacy payload stores concept data here",
            research_priority: "高",
          },
        ],
      },
    };

    const model = buildCompanyResearchDetailModel({
      status: "SUCCEEDED",
      result,
    });

    expect(model?.kind).toBe("detail");
    if (!model || model.kind !== "detail") {
      throw new Error("expected detail model");
    }

    expect(model.conceptCards[0]?.concept).toBe("core_business");
    expect(model.conceptCards[0]?.whyItMatters).toContain("legacy payload");
  });

  it("renders stage panels with agent as the first step", () => {
    const model = buildCompanyResearchDetailModel({
      status: "SUCCEEDED",
      result: createCompanyResearchResult(),
    });

    if (!model || model.kind !== "detail") {
      throw new Error("expected detail model");
    }

    const markup = renderToStaticMarkup(
      React.createElement(CompanyResearchDetailPanels, {
        model,
        run: createWorkflowRun(),
        activeTabId: "agent",
      }),
    );

    expect(markup).toContain('data-stage-switcher="true"');
    expect(markup).toContain("Agent 状态图");
    expect(markup).toContain("投资结论");
    expect(markup).toContain("业务与概念");
    expect(markup).toContain("关键问题");
    expect(markup).toContain("引用与来源");
  });

  it("defaults detail content to the agent step", () => {
    const model = buildCompanyResearchDetailModel({
      status: "SUCCEEDED",
      result: createCompanyResearchResult(),
    });

    if (!model || model.kind !== "detail") {
      throw new Error("expected detail model");
    }

    const markup = renderToStaticMarkup(
      React.createElement(CompanyResearchDetailContent, {
        model,
        run: createWorkflowRun(),
      }),
    );

    expect(markup).toContain('data-stage-switcher="true"');
    expect(markup).toContain('data-active-tab="agent"');
    expect(markup).toContain("Agent 状态图");
  });

  it("builds and renders a paused fallback model with agent and paused steps", () => {
    const model = buildCompanyResearchDetailModel({
      status: "PAUSED",
      input: {
        companyName: "Example Co",
        stockCode: "600000",
        focusConcepts: ["Compute"],
        researchPreferences: {
          researchGoal: "Validate monetization",
        },
      },
      result: {
        qualityFlags: ["source_coverage_low"],
        missingRequirements: ["official website evidence"],
      },
      currentNodeKey: "collect_company_evidence",
    });

    expect(model?.kind).toBe("paused_fallback");
    if (!model || model.kind !== "paused_fallback") {
      throw new Error("expected paused fallback model");
    }

    const markup = renderToStaticMarkup(
      React.createElement(CompanyResearchPausedFallbackPanel, {
        model,
        run: createWorkflowRun({
          status: "PAUSED",
          currentNodeKey: "agent3_source_grounding",
          result: {
            qualityFlags: ["source_coverage_low"],
            missingRequirements: ["official website evidence"],
          },
        }),
      }),
    );

    expect(markup).toContain('data-stage-switcher="true"');
    expect(markup).toContain('data-active-tab="agent"');
    expect(markup).toContain("Agent 状态图");
    expect(markup).toContain("锚定信源范围");
  });
});

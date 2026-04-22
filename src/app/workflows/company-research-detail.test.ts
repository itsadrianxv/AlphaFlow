import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  buildCompanyResearchDetailModel,
  CompanyResearchDetailContent,
  CompanyResearchDetailPanels,
  CompanyResearchPausedFallbackPanel,
} from "~/app/workflows/company-research-detail";
import type { CompanyResearchResultDto } from "~/server/domain/workflow/types";

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
    generatedAt: "2026-03-12T08:00:00.000Z",
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
            research_priority: "楂?",
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

  it("renders stacked detail panels", () => {
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
        expandedQuestionId: "question-1",
      }),
    );

    expect(markup).toContain("Example Co");
    expect(markup).toContain("Official Sources");
    expect(markup).toContain("Is growth monetizing?");
    expect(markup).toContain("2026Q1 IR note");
    expect(markup).toContain("Track order growth versus margin trend");
  });

  it("renders detail content without the old stage switcher shell", () => {
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
      }),
    );

    expect(markup).not.toContain('data-stage-switcher="true"');
    expect(markup).not.toContain("步骤 1");
  });

  it("builds and renders a paused fallback model when no structured result exists", () => {
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
      }),
    );

    expect(markup).toContain("信源覆盖不足");
    expect(markup).toContain("采集公司证据");
  });
});

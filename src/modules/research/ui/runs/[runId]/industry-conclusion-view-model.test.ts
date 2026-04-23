import { describe, expect, it } from "vitest";

import { buildIndustryConclusionViewModel } from "~/modules/research/ui/runs/[runId]/industry-conclusion-view-model";

describe("industry-conclusion-view-model", () => {
  it("maps a quick research result into the document-style sections", () => {
    const model = buildIndustryConclusionViewModel({
      runId: "run_quick_1",
      query: "AI infra",
      result: {
        overview: "AI 基建景气度仍在兑现，但适合继续聚焦到少数关键受益标的。",
        heatScore: 82,
        heatConclusion: "AI 基建进入兑现窗口，优先跟进龙头链条。",
        candidates: [
          {
            stockCode: "300308",
            stockName: "中际旭创",
            reason: "800G 光模块放量延续",
          },
        ],
        credibility: [
          {
            stockCode: "300308",
            credibilityScore: 78,
            highlights: ["订单和扩产节奏同步强化"],
            risks: ["估值和利润兑现仍需继续对表"],
          },
        ],
        topPicks: [
          {
            stockCode: "300308",
            stockName: "中际旭创",
            reason: "北美链条订单兑现速度更快。",
          },
          {
            stockCode: "002463",
            stockName: "沪电股份",
            reason: "高阶交换板需求持续改善。",
          },
        ],
        competitionSummary: "竞争格局向头部集中，但二线跟进节奏仍需验证。",
        contractScore: 91,
        confidenceAnalysis: {
          status: "COMPLETE",
          finalScore: 86,
          level: "high",
          claimCount: 2,
          supportedCount: 1,
          insufficientCount: 1,
          contradictedCount: 0,
          abstainCount: 0,
          supportRate: 0.5,
          insufficientRate: 0.5,
          contradictionRate: 0,
          abstainRate: 0,
          evidenceCoverageScore: 88,
          freshnessScore: 82,
          sourceDiversityScore: 71,
          notes: ["一手信源覆盖偏少，仍需补公告核验。"],
          claims: [
            {
              claimId: "claim_1",
              claimText: "龙头订单兑现更快。",
              attributedSentenceIds: ["s1"],
              matchedReferenceIds: ["ref_1"],
              label: "supported",
              explanation: "公告和新闻交叉验证了龙头订单节奏。",
            },
          ],
        },
        researchPlan: [
          {
            id: "unit_theme",
            title: "产业链景气跟踪",
            objective: "验证订单和扩产是否同步。",
            keyQuestions: ["订单兑现是否加速"],
            priority: "high",
            capability: "theme_overview",
            dependsOn: [],
            role: "research_analyst",
            expectedArtifact: "theme note",
            fallbackCapabilities: ["news_search"],
            acceptanceCriteria: ["给出关键景气指标"],
          },
        ],
        researchUnitRuns: [
          {
            unitId: "unit_theme",
            title: "产业链景气跟踪",
            capability: "theme_overview",
            status: "completed",
            attempt: 1,
            repairCount: 0,
            validationErrors: [],
            qualityFlags: ["first_party_low"],
            startedAt: "2026-04-14T09:00:00.000Z",
            completedAt: "2026-04-14T09:03:00.000Z",
            notes: [],
            sourceUrls: ["https://example.com/theme"],
            evidenceCount: 3,
          },
        ],
        gapAnalysis: {
          requiresFollowup: true,
          summary: "仍需补财报和公告交叉验证。",
          missingAreas: ["财报披露滞后", "公告核验不足"],
          followupUnits: [],
          iteration: 2,
        },
        reflection: {
          status: "warn",
          summary: "结构化结论已形成，但证据仍偏二手。",
          contractScore: 91,
          citationCoverage: 0.72,
          firstPartyRatio: 0.22,
          answeredQuestionCoverage: 0.85,
          missingRequirements: ["citation_coverage_below_target"],
          unansweredQuestions: ["利润兑现节奏是否足以支撑当前估值"],
          qualityFlags: ["first_party_low"],
          suggestedFixes: ["补充公告与财报验证"],
        },
        qualityFlags: ["first_party_low"],
        missingRequirements: ["citation_coverage_below_target"],
        generatedAt: "2026-04-14T09:10:00.000Z",
      },
      timingReportCardIds: ["card_1"],
    });

    expect(model).not.toBeNull();
    expect(model?.headline).toBe("AI 基建进入兑现窗口，优先跟进龙头链条。");
    expect(model?.activeSectionId).toBe("overview");
    expect(model?.metricStrip.map((item) => item.label)).toEqual([
      "可信度",
      "赛道热度",
      "候选标的",
      "重点标的",
      "合同得分",
    ]);
    expect(model?.overviewActions.map((item) => item.label)).toContain(
      "继续看 中际旭创",
    );
    expect(model?.overviewActions.map((item) => item.label)).toContain(
      "查看单股报告",
    );
    expect(model?.logic.industryDrivers).toContain("订单和扩产节奏同步强化");
    expect(model?.logic.topPicks[0]?.href).toContain(
      "/research/company?companyName=%E4%B8%AD%E9%99%85%E6%97%AD%E5%88%9B",
    );
    expect(model?.evidence.claims[0]?.label).toBe("supported");
    expect(model?.evidence.researchPlan[0]?.status).toBe("completed");
    expect(model?.risks.missingAreas).toContain("财报披露滞后");
    expect(model?.risks.nextActions).toContain("补充公告与财报验证");
  });

  it("falls back gracefully when optional quick research fields are missing", () => {
    const model = buildIndustryConclusionViewModel({
      runId: "run_quick_2",
      query: "机器人产业链",
      result: {
        overview: "主题仍需继续跟踪。",
        heatScore: 46,
        heatConclusion: "机器人主题保持观察。",
        candidates: [],
        credibility: [],
        topPicks: [],
        competitionSummary: "",
        generatedAt: "2026-04-14T09:10:00.000Z",
      },
      timingReportCardIds: [],
    });

    expect(model).not.toBeNull();
    expect(model?.metricStrip[0]).toEqual(
      expect.objectContaining({ label: "可信度", value: "未分析" }),
    );
    expect(model?.logic.topPicks).toEqual([]);
    expect(model?.evidence.notes).toContain("暂无可信度分析。");
    expect(model?.risks.nextActions).toContain("继续跟踪后续行业变化");
  });
});

import { describe, expect, it } from "vitest";
import { ScreeningInsight } from "~/modules/research/server/domain/intelligence/aggregates/screening-insight";
import { createUnavailableConfidenceAnalysis } from "~/modules/research/server/domain/intelligence/confidence";
import { EvidenceReference } from "~/modules/research/server/domain/intelligence/entities/evidence-reference";
import { Catalyst } from "~/modules/research/server/domain/intelligence/value-objects/catalyst";
import { InvestmentThesis } from "~/modules/research/server/domain/intelligence/value-objects/investment-thesis";
import { ReviewPlan } from "~/modules/research/server/domain/intelligence/value-objects/review-plan";
import { RiskPoint } from "~/modules/research/server/domain/intelligence/value-objects/risk-point";

function buildInsight() {
  return ScreeningInsight.create({
    id: "insight-1",
    userId: "user-1",
    screeningSessionId: "session-1",
    watchListId: "watchlist-1",
    stockCode: "600519",
    stockName: "贵州茅台",
    score: 0.88,
    thesis: InvestmentThesis.create({
      summary: "高端白酒龙头维持强势品牌护城河。",
      whyNow: "消费复苏与渠道库存改善同步出现。",
      drivers: ["品牌提价能力", "现金流稳健"],
      monetizationPath: "通过提价与产品结构升级释放利润。",
      confidence: "high",
    }),
    risks: [
      RiskPoint.create({
        title: "需求恢复弱于预期",
        severity: "medium",
        description: "宴席与商务需求恢复慢于预期。",
        monitorMetric: "批价与动销增速",
        invalidatesThesisWhen: "批价连续两个季度下滑。",
      }),
    ],
    catalysts: [
      Catalyst.create({
        title: "旺季动销反馈",
        windowType: "event",
        importance: 4,
        description: "渠道调研确认中秋国庆动销恢复情况。",
        expectedDate: "2026-09-20",
        sourceRefId: "evidence-1",
      }),
    ],
    reviewPlan: ReviewPlan.create({
      nextReviewAt: new Date("2026-04-01T00:00:00.000Z"),
      reviewReason: "跟踪旺季备货与批价表现。",
      urgency: "medium",
      suggestedChecks: ["复核渠道库存", "更新批价走势"],
    }),
    evidenceRefs: [
      EvidenceReference.create({
        id: "evidence-1",
        title: "渠道调研纪要",
        sourceName: "内部调研",
        snippet: "批价保持平稳，终端库存健康。",
        extractedFact: "经销商反馈库存处于正常区间。",
        credibilityScore: 0.8,
      }),
    ],
    qualityFlags: ["LOW_CONFIDENCE"],
    confidenceAnalysis: createUnavailableConfidenceAnalysis([
      "等待更多一手渠道数据。",
    ]),
    status: "ACTIVE",
  });
}

describe("ScreeningInsight", () => {
  it("creates version snapshots with confidence metadata", () => {
    const insight = buildInsight();

    const version = insight.createVersionSnapshot(
      2,
      "version-2",
      new Date("2026-03-23T12:00:00.000Z"),
    );

    expect(insight.summary).toContain("品牌护城河");
    expect(insight.confidenceStatus).toBe("UNAVAILABLE");
    expect(insight.supportedClaimCount).toBe(0);
    expect(version.id).toBe("version-2");
    expect(version.version).toBe(2);
    expect(version.summary).toBe(insight.summary);
    expect(version.confidenceAnalysis).toEqual(insight.confidenceAnalysis);
  });
});

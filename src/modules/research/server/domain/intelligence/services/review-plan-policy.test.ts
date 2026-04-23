import { describe, expect, it } from "vitest";
import { ReviewPlanPolicy } from "~/modules/research/server/domain/intelligence/services/review-plan-policy";
import { Catalyst } from "~/modules/research/server/domain/intelligence/value-objects/catalyst";
import { RiskPoint } from "~/modules/research/server/domain/intelligence/value-objects/risk-point";

describe("ReviewPlanPolicy", () => {
  it("存在明确催化窗口时会提前三天复评", () => {
    const policy = new ReviewPlanPolicy();

    const plan = policy.build({
      asOf: new Date("2026-03-10T09:00:00.000Z"),
      confidence: "medium",
      qualityFlags: [],
      risks: [
        RiskPoint.create({
          title: "需求波动",
          severity: "medium",
          description: "行业需求存在扰动。",
          monitorMetric: "订单增速",
          invalidatesThesisWhen: "订单连续下滑时",
        }),
      ],
      catalysts: [
        Catalyst.create({
          title: "年报披露",
          windowType: "earnings",
          importance: 4,
          description: "即将披露全年业绩。",
          expectedDate: "2026-03-20T00:00:00.000Z",
        }),
      ],
      extraChecks: [],
    });

    expect(plan.nextReviewAt.toISOString()).toBe("2026-03-17T00:00:00.000Z");
    expect(plan.urgency).toBe("high");
  });

  it("低置信度和证据不足时会在七天内复评", () => {
    const policy = new ReviewPlanPolicy();

    const plan = policy.build({
      asOf: new Date("2026-03-10T09:00:00.000Z"),
      confidence: "low",
      qualityFlags: ["INSUFFICIENT_EVIDENCE", "LOW_CONFIDENCE"],
      risks: [],
      catalysts: [],
      extraChecks: ["补充财报与公告证据"],
    });

    expect(plan.nextReviewAt.toISOString()).toBe("2026-03-17T09:00:00.000Z");
    expect(plan.urgency).toBe("high");
    expect(plan.suggestedChecks).toContain("补充财报与公告证据");
  });
});

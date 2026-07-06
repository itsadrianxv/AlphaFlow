import type {
  InsightConfidence,
  InsightQualityFlag,
} from "~/server/domain/intelligence/types";
import type { Catalyst } from "~/server/domain/intelligence/value-objects/catalyst";
import { ReviewPlan } from "~/server/domain/intelligence/value-objects/review-plan";
import type { RiskPoint } from "~/server/domain/intelligence/value-objects/risk-point";

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}

function subtractDays(date: Date, days: number) {
  return new Date(date.getTime() - days * 86_400_000);
}

function getEarliestCatalystDate(catalysts: Catalyst[]): Date | null {
  const dates = catalysts
    .map((item) => item.expectedDate)
    .filter((item): item is string => Boolean(item))
    .map((item) => new Date(item))
    .filter((item) => !Number.isNaN(item.getTime()))
    .sort((left, right) => left.getTime() - right.getTime());

  return dates[0] ?? null;
}

function buildSuggestedChecks(params: {
  risks: RiskPoint[];
  catalysts: Catalyst[];
  extraChecks: string[];
}): string[] {
  const checks = new Set<string>();

  for (const risk of params.risks) {
    checks.add(`跟踪 ${risk.monitorMetric}`);
  }

  for (const catalyst of params.catalysts) {
    checks.add(`验证催化兑现：${catalyst.title}`);
  }

  for (const extraCheck of params.extraChecks) {
    const normalized = extraCheck.trim();
    if (normalized) {
      checks.add(normalized);
    }
  }

  return [...checks];
}

export class ReviewPlanPolicy {
  build(params: {
    asOf: Date;
    confidence: InsightConfidence;
    qualityFlags: InsightQualityFlag[];
    risks: RiskPoint[];
    catalysts: Catalyst[];
    extraChecks: string[];
  }): ReviewPlan {
    const earliestCatalystDate = getEarliestCatalystDate(params.catalysts);
    const hasHighRisk = params.risks.some((item) => item.severity === "high");
    const hasLowConfidence =
      params.confidence === "low" ||
      params.qualityFlags.includes("LOW_CONFIDENCE");
    const needsReviewSoon =
      hasLowConfidence ||
      hasHighRisk ||
      params.qualityFlags.includes("INSUFFICIENT_EVIDENCE") ||
      params.qualityFlags.includes("MISSING_KEY_FIELDS");

    const suggestedChecks = buildSuggestedChecks({
      risks: params.risks,
      catalysts: params.catalysts,
      extraChecks: params.extraChecks,
    });

    if (earliestCatalystDate && earliestCatalystDate > params.asOf) {
      const target = subtractDays(earliestCatalystDate, 3);

      return ReviewPlan.create({
        nextReviewAt: target > params.asOf ? target : addDays(params.asOf, 1),
        reviewReason: "存在明确催化窗口，需在事件前复评兑现路径。",
        urgency: "high",
        suggestedChecks,
      });
    }

    if (needsReviewSoon) {
      return ReviewPlan.create({
        nextReviewAt: addDays(params.asOf, 7),
        reviewReason: "当前证据或风险结构不足，需在一周内补充复评。",
        urgency: "high",
        suggestedChecks,
      });
    }

    if (params.catalysts.length > 0 || params.confidence === "medium") {
      return ReviewPlan.create({
        nextReviewAt: addDays(params.asOf, 10),
        reviewReason: "存在阶段性催化，建议在两周内跟踪验证。",
        urgency: "medium",
        suggestedChecks,
      });
    }

    return ReviewPlan.create({
      nextReviewAt: addDays(params.asOf, 21),
      reviewReason: "当前更适合中期跟踪，按节奏做常规复评。",
      urgency: "low",
      suggestedChecks,
    });
  }
}

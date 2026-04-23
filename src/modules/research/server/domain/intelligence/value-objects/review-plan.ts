import { InvalidInsightError } from "~/modules/research/server/domain/intelligence/errors";
import type { ReviewUrgency } from "~/modules/research/server/domain/intelligence/types";

const REVIEW_URGENCIES: ReviewUrgency[] = ["high", "medium", "low"];

export type ReviewPlanParams = {
  nextReviewAt: Date;
  reviewReason: string;
  urgency: ReviewUrgency;
  suggestedChecks: string[];
};

export class ReviewPlan {
  private readonly _nextReviewAt: Date;
  private readonly _reviewReason: string;
  private readonly _urgency: ReviewUrgency;
  private readonly _suggestedChecks: readonly string[];

  private constructor(params: ReviewPlanParams) {
    this._nextReviewAt = params.nextReviewAt;
    this._reviewReason = params.reviewReason;
    this._urgency = params.urgency;
    this._suggestedChecks = [...params.suggestedChecks];
  }

  get nextReviewAt(): Date {
    return this._nextReviewAt;
  }

  get reviewReason(): string {
    return this._reviewReason;
  }

  get urgency(): ReviewUrgency {
    return this._urgency;
  }

  get suggestedChecks(): readonly string[] {
    return this._suggestedChecks;
  }

  static create(params: ReviewPlanParams): ReviewPlan {
    if (Number.isNaN(params.nextReviewAt.getTime())) {
      throw new InvalidInsightError("复评时间无效");
    }

    if (!params.reviewReason.trim()) {
      throw new InvalidInsightError("复评原因不能为空");
    }

    if (!REVIEW_URGENCIES.includes(params.urgency)) {
      throw new InvalidInsightError("无效的复评紧急度");
    }

    const suggestedChecks = params.suggestedChecks
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return new ReviewPlan({
      nextReviewAt: params.nextReviewAt,
      reviewReason: params.reviewReason.trim(),
      urgency: params.urgency,
      suggestedChecks,
    });
  }

  toDict(): Record<string, unknown> {
    return {
      nextReviewAt: this._nextReviewAt.toISOString(),
      reviewReason: this._reviewReason,
      urgency: this._urgency,
      suggestedChecks: [...this._suggestedChecks],
    };
  }

  static fromDict(data: Record<string, unknown>): ReviewPlan {
    return ReviewPlan.create({
      nextReviewAt: new Date(data.nextReviewAt as string),
      reviewReason: data.reviewReason as string,
      urgency: data.urgency as ReviewUrgency,
      suggestedChecks: data.suggestedChecks as string[],
    });
  }
}

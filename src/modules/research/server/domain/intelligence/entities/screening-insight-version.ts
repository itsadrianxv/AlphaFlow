import { v4 as uuidv4 } from "uuid";
import type { ConfidenceAnalysis } from "~/modules/research/server/domain/intelligence/confidence";
import { EvidenceReference } from "~/modules/research/server/domain/intelligence/entities/evidence-reference";
import { InvalidInsightError } from "~/modules/research/server/domain/intelligence/errors";
import type { InsightQualityFlag } from "~/modules/research/server/domain/intelligence/types";
import { Catalyst } from "~/modules/research/server/domain/intelligence/value-objects/catalyst";
import { InvestmentThesis } from "~/modules/research/server/domain/intelligence/value-objects/investment-thesis";
import { ReviewPlan } from "~/modules/research/server/domain/intelligence/value-objects/review-plan";
import { RiskPoint } from "~/modules/research/server/domain/intelligence/value-objects/risk-point";

export type ScreeningInsightVersionParams = {
  id?: string;
  insightId: string;
  version: number;
  thesis: InvestmentThesis;
  risks: RiskPoint[];
  catalysts: Catalyst[];
  reviewPlan: ReviewPlan;
  evidenceRefs: EvidenceReference[];
  qualityFlags: InsightQualityFlag[];
  confidenceAnalysis?: ConfidenceAnalysis;
  createdAt?: Date;
};

export class ScreeningInsightVersion {
  private readonly _id: string;
  private readonly _insightId: string;
  private readonly _version: number;
  private readonly _thesis: InvestmentThesis;
  private readonly _risks: readonly RiskPoint[];
  private readonly _catalysts: readonly Catalyst[];
  private readonly _reviewPlan: ReviewPlan;
  private readonly _evidenceRefs: readonly EvidenceReference[];
  private readonly _qualityFlags: readonly InsightQualityFlag[];
  private readonly _confidenceAnalysis?: ConfidenceAnalysis;
  private readonly _createdAt: Date;

  private constructor(params: ScreeningInsightVersionParams) {
    this._id = params.id ?? uuidv4();
    this._insightId = params.insightId;
    this._version = params.version;
    this._thesis = params.thesis;
    this._risks = [...params.risks];
    this._catalysts = [...params.catalysts];
    this._reviewPlan = params.reviewPlan;
    this._evidenceRefs = [...params.evidenceRefs];
    this._qualityFlags = [...params.qualityFlags];
    this._confidenceAnalysis = params.confidenceAnalysis;
    this._createdAt = params.createdAt ?? new Date();
  }

  get id(): string {
    return this._id;
  }

  get insightId(): string {
    return this._insightId;
  }

  get version(): number {
    return this._version;
  }

  get summary(): string {
    return this._thesis.summary;
  }

  get thesis(): InvestmentThesis {
    return this._thesis;
  }

  get risks(): readonly RiskPoint[] {
    return this._risks;
  }

  get catalysts(): readonly Catalyst[] {
    return this._catalysts;
  }

  get reviewPlan(): ReviewPlan {
    return this._reviewPlan;
  }

  get evidenceRefs(): readonly EvidenceReference[] {
    return this._evidenceRefs;
  }

  get qualityFlags(): readonly InsightQualityFlag[] {
    return this._qualityFlags;
  }

  get confidenceAnalysis(): ConfidenceAnalysis | undefined {
    return this._confidenceAnalysis;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  static create(
    params: ScreeningInsightVersionParams,
  ): ScreeningInsightVersion {
    if (!params.insightId.trim()) {
      throw new InvalidInsightError("InsightVersion requires insightId");
    }

    if (!Number.isInteger(params.version) || params.version <= 0) {
      throw new InvalidInsightError("InsightVersion version must be positive");
    }

    return new ScreeningInsightVersion(params);
  }

  toDict(): Record<string, unknown> {
    return {
      id: this._id,
      insightId: this._insightId,
      version: this._version,
      summary: this.summary,
      thesis: this._thesis.toDict(),
      risks: this._risks.map((item) => item.toDict()),
      catalysts: this._catalysts.map((item) => item.toDict()),
      reviewPlan: this._reviewPlan.toDict(),
      evidenceRefs: this._evidenceRefs.map((item) => item.toDict()),
      qualityFlags: [...this._qualityFlags],
      confidenceAnalysis: this._confidenceAnalysis,
      createdAt: this._createdAt.toISOString(),
    };
  }

  static fromDict(data: Record<string, unknown>): ScreeningInsightVersion {
    return ScreeningInsightVersion.create({
      id: data.id as string | undefined,
      insightId: data.insightId as string,
      version: data.version as number,
      thesis: InvestmentThesis.fromDict(data.thesis as Record<string, unknown>),
      risks: (data.risks as Record<string, unknown>[]).map((item) =>
        RiskPoint.fromDict(item),
      ),
      catalysts: (data.catalysts as Record<string, unknown>[]).map((item) =>
        Catalyst.fromDict(item),
      ),
      reviewPlan: ReviewPlan.fromDict(
        data.reviewPlan as Record<string, unknown>,
      ),
      evidenceRefs: (data.evidenceRefs as Record<string, unknown>[]).map(
        (item) => EvidenceReference.fromDict(item),
      ),
      qualityFlags: data.qualityFlags as InsightQualityFlag[],
      confidenceAnalysis: data.confidenceAnalysis as
        | ConfidenceAnalysis
        | undefined,
      createdAt: data.createdAt
        ? new Date(data.createdAt as string)
        : undefined,
    });
  }
}

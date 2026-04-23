import { v4 as uuidv4 } from "uuid";
import type {
  ConfidenceAnalysis,
  ConfidenceAnalysisStatus,
  ConfidenceLevel,
} from "~/modules/research/server/domain/intelligence/confidence";
import { summarizeConfidenceAnalysis } from "~/modules/research/server/domain/intelligence/confidence";
import { EvidenceReference } from "~/modules/research/server/domain/intelligence/entities/evidence-reference";
import { ScreeningInsightVersion } from "~/modules/research/server/domain/intelligence/entities/screening-insight-version";
import { InvalidInsightError } from "~/modules/research/server/domain/intelligence/errors";
import type {
  InsightQualityFlag,
  ScreeningInsightStatus,
} from "~/modules/research/server/domain/intelligence/types";
import { Catalyst } from "~/modules/research/server/domain/intelligence/value-objects/catalyst";
import { InvestmentThesis } from "~/modules/research/server/domain/intelligence/value-objects/investment-thesis";
import { ReviewPlan } from "~/modules/research/server/domain/intelligence/value-objects/review-plan";
import { RiskPoint } from "~/modules/research/server/domain/intelligence/value-objects/risk-point";

export type ScreeningInsightParams = {
  id?: string;
  userId: string;
  screeningSessionId: string;
  watchListId?: string;
  stockCode: string;
  stockName: string;
  score: number;
  thesis: InvestmentThesis;
  risks: RiskPoint[];
  catalysts: Catalyst[];
  reviewPlan: ReviewPlan;
  evidenceRefs: EvidenceReference[];
  qualityFlags: InsightQualityFlag[];
  confidenceAnalysis?: ConfidenceAnalysis;
  confidenceScore?: number | null;
  confidenceLevel?: ConfidenceLevel;
  confidenceStatus?: ConfidenceAnalysisStatus;
  supportedClaimCount?: number;
  insufficientClaimCount?: number;
  contradictedClaimCount?: number;
  status: ScreeningInsightStatus;
  version?: number;
  latestVersionId?: string;
  createdAt?: Date;
  updatedAt?: Date;
};

const INSIGHT_STATUSES: ScreeningInsightStatus[] = [
  "ACTIVE",
  "NEEDS_REVIEW",
  "ARCHIVED",
];

export class ScreeningInsight {
  private readonly _id: string;
  private readonly _userId: string;
  private readonly _screeningSessionId: string;
  private readonly _watchListId?: string;
  private readonly _stockCode: string;
  private readonly _stockName: string;
  private readonly _score: number;
  private readonly _thesis: InvestmentThesis;
  private readonly _risks: readonly RiskPoint[];
  private readonly _catalysts: readonly Catalyst[];
  private readonly _reviewPlan: ReviewPlan;
  private readonly _evidenceRefs: readonly EvidenceReference[];
  private readonly _qualityFlags: readonly InsightQualityFlag[];
  private readonly _confidenceAnalysis?: ConfidenceAnalysis;
  private readonly _confidenceScore: number | null;
  private readonly _confidenceLevel: ConfidenceLevel;
  private readonly _confidenceStatus: ConfidenceAnalysisStatus;
  private readonly _supportedClaimCount: number;
  private readonly _insufficientClaimCount: number;
  private readonly _contradictedClaimCount: number;
  private readonly _status: ScreeningInsightStatus;
  private readonly _version: number;
  private readonly _latestVersionId?: string;
  private readonly _createdAt: Date;
  private readonly _updatedAt: Date;

  private constructor(params: ScreeningInsightParams) {
    this._id = params.id ?? uuidv4();
    this._userId = params.userId;
    this._screeningSessionId = params.screeningSessionId;
    this._watchListId = params.watchListId;
    this._stockCode = params.stockCode;
    this._stockName = params.stockName;
    this._score = params.score;
    this._thesis = params.thesis;
    this._risks = [...params.risks];
    this._catalysts = [...params.catalysts];
    this._reviewPlan = params.reviewPlan;
    this._evidenceRefs = [...params.evidenceRefs];
    this._qualityFlags = [...params.qualityFlags];

    const summary = summarizeConfidenceAnalysis(params.confidenceAnalysis);
    this._confidenceAnalysis = params.confidenceAnalysis;
    this._confidenceScore =
      params.confidenceScore !== undefined
        ? params.confidenceScore
        : summary.confidenceScore;
    this._confidenceLevel = params.confidenceLevel ?? summary.confidenceLevel;
    this._confidenceStatus =
      params.confidenceStatus ?? summary.confidenceStatus;
    this._supportedClaimCount =
      params.supportedClaimCount ?? summary.supportedClaimCount;
    this._insufficientClaimCount =
      params.insufficientClaimCount ?? summary.insufficientClaimCount;
    this._contradictedClaimCount =
      params.contradictedClaimCount ?? summary.contradictedClaimCount;
    this._status = params.status;
    this._version = params.version ?? 1;
    this._latestVersionId = params.latestVersionId;
    this._createdAt = params.createdAt ?? new Date();
    this._updatedAt = params.updatedAt ?? this._createdAt;
  }

  get id(): string {
    return this._id;
  }

  get userId(): string {
    return this._userId;
  }

  get screeningSessionId(): string {
    return this._screeningSessionId;
  }

  get watchListId(): string | undefined {
    return this._watchListId;
  }

  get stockCode(): string {
    return this._stockCode;
  }

  get stockName(): string {
    return this._stockName;
  }

  get score(): number {
    return this._score;
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

  get confidenceScore(): number | null {
    return this._confidenceScore;
  }

  get confidenceLevel(): ConfidenceLevel {
    return this._confidenceLevel;
  }

  get confidenceStatus(): ConfidenceAnalysisStatus {
    return this._confidenceStatus;
  }

  get supportedClaimCount(): number {
    return this._supportedClaimCount;
  }

  get insufficientClaimCount(): number {
    return this._insufficientClaimCount;
  }

  get contradictedClaimCount(): number {
    return this._contradictedClaimCount;
  }

  get status(): ScreeningInsightStatus {
    return this._status;
  }

  get version(): number {
    return this._version;
  }

  get latestVersionId(): string | undefined {
    return this._latestVersionId;
  }

  get createdAt(): Date {
    return this._createdAt;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  get summary(): string {
    return this._thesis.summary;
  }

  static create(params: ScreeningInsightParams): ScreeningInsight {
    if (!params.userId.trim()) {
      throw new InvalidInsightError("Insight requires userId");
    }

    if (!params.screeningSessionId.trim()) {
      throw new InvalidInsightError("Insight requires screeningSessionId");
    }

    if (!params.stockCode.trim()) {
      throw new InvalidInsightError("Insight requires stockCode");
    }

    if (!params.stockName.trim()) {
      throw new InvalidInsightError("Insight requires stockName");
    }

    if (params.score < 0 || params.score > 1) {
      throw new InvalidInsightError("Insight score must be between 0 and 1");
    }

    if (!INSIGHT_STATUSES.includes(params.status)) {
      throw new InvalidInsightError("Invalid insight status");
    }

    if (!Number.isInteger(params.version ?? 1) || (params.version ?? 1) <= 0) {
      throw new InvalidInsightError("Insight version must be positive");
    }

    return new ScreeningInsight(params);
  }

  createVersionSnapshot(
    version = this._version,
    versionId?: string,
    createdAt?: Date,
  ): ScreeningInsightVersion {
    return ScreeningInsightVersion.create({
      id: versionId,
      insightId: this._id,
      version,
      thesis: this._thesis,
      risks: [...this._risks],
      catalysts: [...this._catalysts],
      reviewPlan: this._reviewPlan,
      evidenceRefs: [...this._evidenceRefs],
      qualityFlags: [...this._qualityFlags],
      confidenceAnalysis: this._confidenceAnalysis,
      createdAt,
    });
  }

  withPersistedVersion(params: {
    version: number;
    latestVersionId: string;
    updatedAt?: Date;
  }): ScreeningInsight {
    return ScreeningInsight.create({
      id: this._id,
      userId: this._userId,
      screeningSessionId: this._screeningSessionId,
      watchListId: this._watchListId,
      stockCode: this._stockCode,
      stockName: this._stockName,
      score: this._score,
      thesis: this._thesis,
      risks: [...this._risks],
      catalysts: [...this._catalysts],
      reviewPlan: this._reviewPlan,
      evidenceRefs: [...this._evidenceRefs],
      qualityFlags: [...this._qualityFlags],
      confidenceAnalysis: this._confidenceAnalysis,
      confidenceScore: this._confidenceScore,
      confidenceLevel: this._confidenceLevel,
      confidenceStatus: this._confidenceStatus,
      supportedClaimCount: this._supportedClaimCount,
      insufficientClaimCount: this._insufficientClaimCount,
      contradictedClaimCount: this._contradictedClaimCount,
      status: this._status,
      version: params.version,
      latestVersionId: params.latestVersionId,
      createdAt: this._createdAt,
      updatedAt: params.updatedAt ?? new Date(),
    });
  }

  toDict(): Record<string, unknown> {
    return {
      id: this._id,
      userId: this._userId,
      screeningSessionId: this._screeningSessionId,
      watchListId: this._watchListId,
      stockCode: this._stockCode,
      stockName: this._stockName,
      score: this._score,
      thesis: this._thesis.toDict(),
      risks: this._risks.map((item) => item.toDict()),
      catalysts: this._catalysts.map((item) => item.toDict()),
      reviewPlan: this._reviewPlan.toDict(),
      evidenceRefs: this._evidenceRefs.map((item) => item.toDict()),
      qualityFlags: [...this._qualityFlags],
      confidenceScore: this._confidenceScore,
      confidenceLevel: this._confidenceLevel,
      confidenceStatus: this._confidenceStatus,
      supportedClaimCount: this._supportedClaimCount,
      insufficientClaimCount: this._insufficientClaimCount,
      contradictedClaimCount: this._contradictedClaimCount,
      confidenceAnalysis: this._confidenceAnalysis,
      status: this._status,
      version: this._version,
      latestVersionId: this._latestVersionId,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
    };
  }

  static fromDict(data: Record<string, unknown>): ScreeningInsight {
    return ScreeningInsight.create({
      id: data.id as string | undefined,
      userId: data.userId as string,
      screeningSessionId: data.screeningSessionId as string,
      watchListId: data.watchListId as string | undefined,
      stockCode: data.stockCode as string,
      stockName: data.stockName as string,
      score: data.score as number,
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
      confidenceScore:
        (data.confidenceScore as number | null | undefined) ?? null,
      confidenceLevel:
        (data.confidenceLevel as ConfidenceLevel | undefined) ?? "unknown",
      confidenceStatus:
        (data.confidenceStatus as ConfidenceAnalysisStatus | undefined) ??
        "UNAVAILABLE",
      supportedClaimCount:
        (data.supportedClaimCount as number | undefined) ?? 0,
      insufficientClaimCount:
        (data.insufficientClaimCount as number | undefined) ?? 0,
      contradictedClaimCount:
        (data.contradictedClaimCount as number | undefined) ?? 0,
      status: data.status as ScreeningInsightStatus,
      version: data.version as number,
      latestVersionId: data.latestVersionId as string | undefined,
      createdAt: data.createdAt
        ? new Date(data.createdAt as string)
        : undefined,
      updatedAt: data.updatedAt
        ? new Date(data.updatedAt as string)
        : undefined,
    });
  }
}

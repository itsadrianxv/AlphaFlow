import type { Prisma, PrismaClient } from "@prisma/client";
import { ScreeningInsight } from "~/server/domain/intelligence/aggregates/screening-insight";
import type { ConfidenceAnalysis } from "~/server/domain/intelligence/confidence";
import { EvidenceReference } from "~/server/domain/intelligence/entities/evidence-reference";
import { ScreeningInsightVersion } from "~/server/domain/intelligence/entities/screening-insight-version";
import type { IScreeningInsightRepository } from "~/server/domain/intelligence/repositories/screening-insight-repository";
import type { InsightQualityFlag } from "~/server/domain/intelligence/types";
import { Catalyst } from "~/server/domain/intelligence/value-objects/catalyst";
import { InvestmentThesis } from "~/server/domain/intelligence/value-objects/investment-thesis";
import { ReviewPlan } from "~/server/domain/intelligence/value-objects/review-plan";
import { RiskPoint } from "~/server/domain/intelligence/value-objects/risk-point";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

type InsightRecord = {
  id: string;
  userId: string;
  screeningSessionId: string;
  watchListId: string | null;
  stockCode: string;
  stockName: string;
  score: number;
  status: string;
  summary: string;
  nextReviewAt: Date | null;
  qualityFlags: string[];
  confidenceScore: number | null;
  confidenceLevel: string;
  confidenceStatus: string;
  supportedClaimCount: number;
  insufficientClaimCount: number;
  contradictedClaimCount: number;
  latestVersionId: string | null;
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

type InsightVersionRecord = {
  id: string;
  insightId: string;
  version: number;
  summary: string;
  thesisJson: unknown;
  risksJson: unknown;
  catalystsJson: unknown;
  reviewPlanJson: unknown;
  evidenceRefsJson: unknown;
  qualityFlagsJson: unknown;
  confidenceAnalysisJson: unknown;
  createdAt: Date;
};

type ScreeningInsightClient = {
  screeningInsight: {
    findUnique(args: unknown): Promise<InsightRecord | null>;
    create(args: unknown): Promise<InsightRecord>;
    update(args: unknown): Promise<InsightRecord>;
    findMany(args: unknown): Promise<InsightRecord[]>;
  };
  screeningInsightVersion: {
    create(args: unknown): Promise<InsightVersionRecord>;
    findUnique(args: unknown): Promise<InsightVersionRecord | null>;
    findFirst(args: unknown): Promise<InsightVersionRecord | null>;
    findMany(args: unknown): Promise<InsightVersionRecord[]>;
  };
};

function asScreeningInsightClient(client: unknown): ScreeningInsightClient {
  return client as ScreeningInsightClient;
}

function serializeInsightVersion(
  insightId: string,
  version: number,
  insight: ScreeningInsight,
) {
  return {
    insightId,
    version,
    summary: insight.summary,
    thesisJson: toJson(insight.thesis.toDict()),
    risksJson: toJson(insight.risks.map((item) => item.toDict())),
    catalystsJson: toJson(insight.catalysts.map((item) => item.toDict())),
    reviewPlanJson: toJson(insight.reviewPlan.toDict()),
    evidenceRefsJson: toJson(insight.evidenceRefs.map((item) => item.toDict())),
    qualityFlagsJson: toJson([...insight.qualityFlags]),
    confidenceAnalysisJson: toJson(insight.confidenceAnalysis ?? null),
  };
}

function versionContentEquals(
  versionRecord: InsightVersionRecord,
  insight: ScreeningInsight,
) {
  const current = {
    summary: insight.summary,
    thesisJson: insight.thesis.toDict(),
    risksJson: insight.risks.map((item) => item.toDict()),
    catalystsJson: insight.catalysts.map((item) => item.toDict()),
    reviewPlanJson: insight.reviewPlan.toDict(),
    evidenceRefsJson: insight.evidenceRefs.map((item) => item.toDict()),
    qualityFlagsJson: [...insight.qualityFlags],
    confidenceAnalysisJson: insight.confidenceAnalysis ?? null,
  };

  const stored = {
    summary: versionRecord.summary,
    thesisJson: versionRecord.thesisJson,
    risksJson: versionRecord.risksJson,
    catalystsJson: versionRecord.catalystsJson,
    reviewPlanJson: versionRecord.reviewPlanJson,
    evidenceRefsJson: versionRecord.evidenceRefsJson,
    qualityFlagsJson: versionRecord.qualityFlagsJson,
    confidenceAnalysisJson: versionRecord.confidenceAnalysisJson,
  };

  return JSON.stringify(stored) === JSON.stringify(current);
}

function toDomain(
  record: InsightRecord,
  versionRecord: InsightVersionRecord,
): ScreeningInsight {
  return ScreeningInsight.create({
    id: record.id,
    userId: record.userId,
    screeningSessionId: record.screeningSessionId,
    watchListId: record.watchListId ?? undefined,
    stockCode: record.stockCode,
    stockName: record.stockName,
    score: record.score,
    thesis: InvestmentThesis.fromDict(
      versionRecord.thesisJson as Record<string, unknown>,
    ),
    risks: (versionRecord.risksJson as Record<string, unknown>[]).map((item) =>
      RiskPoint.fromDict(item),
    ),
    catalysts: (versionRecord.catalystsJson as Record<string, unknown>[]).map(
      (item) => Catalyst.fromDict(item),
    ),
    reviewPlan: ReviewPlan.fromDict(
      versionRecord.reviewPlanJson as Record<string, unknown>,
    ),
    evidenceRefs: (
      versionRecord.evidenceRefsJson as Record<string, unknown>[]
    ).map((item) => EvidenceReference.fromDict(item)),
    qualityFlags: versionRecord.qualityFlagsJson as InsightQualityFlag[],
    confidenceAnalysis: (versionRecord.confidenceAnalysisJson ?? undefined) as
      | ConfidenceAnalysis
      | undefined,
    confidenceScore: record.confidenceScore,
    confidenceLevel:
      record.confidenceLevel as ScreeningInsight["confidenceLevel"],
    confidenceStatus:
      record.confidenceStatus as ScreeningInsight["confidenceStatus"],
    supportedClaimCount: record.supportedClaimCount,
    insufficientClaimCount: record.insufficientClaimCount,
    contradictedClaimCount: record.contradictedClaimCount,
    status: record.status as ScreeningInsight["status"],
    version: record.currentVersion,
    latestVersionId: record.latestVersionId ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

function toVersionDomain(
  record: InsightVersionRecord,
): ScreeningInsightVersion {
  return ScreeningInsightVersion.create({
    id: record.id,
    insightId: record.insightId,
    version: record.version,
    thesis: InvestmentThesis.fromDict(
      record.thesisJson as Record<string, unknown>,
    ),
    risks: (record.risksJson as Record<string, unknown>[]).map((item) =>
      RiskPoint.fromDict(item),
    ),
    catalysts: (record.catalystsJson as Record<string, unknown>[]).map((item) =>
      Catalyst.fromDict(item),
    ),
    reviewPlan: ReviewPlan.fromDict(
      record.reviewPlanJson as Record<string, unknown>,
    ),
    evidenceRefs: (record.evidenceRefsJson as Record<string, unknown>[]).map(
      (item) => EvidenceReference.fromDict(item),
    ),
    qualityFlags: record.qualityFlagsJson as InsightQualityFlag[],
    confidenceAnalysis: (record.confidenceAnalysisJson ?? undefined) as
      | ConfidenceAnalysis
      | undefined,
    createdAt: record.createdAt,
  });
}

export class PrismaScreeningInsightRepository
  implements IScreeningInsightRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async save(insight: ScreeningInsight): Promise<ScreeningInsight> {
    return this.prisma.$transaction(async (tx) => {
      const txClient = asScreeningInsightClient(tx);
      const existing = await txClient.screeningInsight.findUnique({
        where: {
          screeningSessionId_stockCode: {
            screeningSessionId: insight.screeningSessionId,
            stockCode: insight.stockCode,
          },
        },
      });

      if (!existing) {
        const createdInsight = await txClient.screeningInsight.create({
          data: {
            id: insight.id,
            userId: insight.userId,
            screeningSessionId: insight.screeningSessionId,
            watchListId: insight.watchListId,
            stockCode: insight.stockCode,
            stockName: insight.stockName,
            score: insight.score,
            status: insight.status,
            summary: insight.summary,
            nextReviewAt: insight.reviewPlan.nextReviewAt,
            qualityFlags: [...insight.qualityFlags],
            confidenceScore: insight.confidenceScore,
            confidenceLevel: insight.confidenceLevel,
            confidenceStatus: insight.confidenceStatus,
            supportedClaimCount: insight.supportedClaimCount,
            insufficientClaimCount: insight.insufficientClaimCount,
            contradictedClaimCount: insight.contradictedClaimCount,
            currentVersion: 1,
            createdAt: insight.createdAt,
            updatedAt: insight.updatedAt,
          },
        });
        const createdVersion = await txClient.screeningInsightVersion.create({
          data: {
            id: insight.latestVersionId ?? insight.createVersionSnapshot(1).id,
            ...serializeInsightVersion(createdInsight.id, 1, insight),
            createdAt: insight.updatedAt,
          },
        });
        const persisted = await txClient.screeningInsight.update({
          where: { id: createdInsight.id },
          data: { latestVersionId: createdVersion.id },
        });

        return toDomain(
          persisted as InsightRecord,
          createdVersion as InsightVersionRecord,
        );
      }

      const latestVersion = existing.latestVersionId
        ? await txClient.screeningInsightVersion.findUnique({
            where: { id: existing.latestVersionId },
          })
        : await txClient.screeningInsightVersion.findFirst({
            where: { insightId: existing.id },
            orderBy: { version: "desc" },
          });

      if (
        latestVersion &&
        versionContentEquals(latestVersion as InsightVersionRecord, insight)
      ) {
        const updatedRecord = await txClient.screeningInsight.update({
          where: { id: existing.id },
          data: {
            watchListId: insight.watchListId,
            stockName: insight.stockName,
            score: insight.score,
            status: insight.status,
            summary: insight.summary,
            nextReviewAt: insight.reviewPlan.nextReviewAt,
            qualityFlags: [...insight.qualityFlags],
            confidenceScore: insight.confidenceScore,
            confidenceLevel: insight.confidenceLevel,
            confidenceStatus: insight.confidenceStatus,
            supportedClaimCount: insight.supportedClaimCount,
            insufficientClaimCount: insight.insufficientClaimCount,
            contradictedClaimCount: insight.contradictedClaimCount,
            updatedAt: new Date(),
          },
        });

        return toDomain(
          updatedRecord as InsightRecord,
          latestVersion as InsightVersionRecord,
        );
      }

      const nextVersion =
        (latestVersion?.version ?? existing.currentVersion) + 1;
      const versionSnapshot = insight.createVersionSnapshot(nextVersion);
      const createdVersion = await txClient.screeningInsightVersion.create({
        data: {
          id: versionSnapshot.id,
          ...serializeInsightVersion(existing.id, nextVersion, insight),
          createdAt: insight.updatedAt,
        },
      });
      const updatedInsight = await txClient.screeningInsight.update({
        where: { id: existing.id },
        data: {
          watchListId: insight.watchListId,
          stockName: insight.stockName,
          score: insight.score,
          status: insight.status,
          summary: insight.summary,
          nextReviewAt: insight.reviewPlan.nextReviewAt,
          qualityFlags: [...insight.qualityFlags],
          confidenceScore: insight.confidenceScore,
          confidenceLevel: insight.confidenceLevel,
          confidenceStatus: insight.confidenceStatus,
          supportedClaimCount: insight.supportedClaimCount,
          insufficientClaimCount: insight.insufficientClaimCount,
          contradictedClaimCount: insight.contradictedClaimCount,
          latestVersionId: createdVersion.id,
          currentVersion: nextVersion,
          updatedAt: new Date(),
        },
      });

      return toDomain(
        updatedInsight as InsightRecord,
        createdVersion as InsightVersionRecord,
      );
    });
  }

  async findById(id: string): Promise<ScreeningInsight | null> {
    const prismaClient = asScreeningInsightClient(this.prisma);
    const record = await prismaClient.screeningInsight.findUnique({
      where: { id },
    });

    if (!record) {
      return null;
    }

    const versionRecord = await this.getLatestVersionForInsight(
      record.id,
      record.latestVersionId,
    );

    if (!versionRecord) {
      return null;
    }

    return toDomain(record as InsightRecord, versionRecord);
  }

  async findByUserId(
    userId: string,
    limit = 20,
    offset = 0,
  ): Promise<ScreeningInsight[]> {
    const prismaClient = asScreeningInsightClient(this.prisma);
    const records = await prismaClient.screeningInsight.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
    });

    return this.mapInsightsWithLatestVersions(records as InsightRecord[]);
  }

  async findByScreeningSessionId(
    screeningSessionId: string,
  ): Promise<ScreeningInsight[]> {
    const prismaClient = asScreeningInsightClient(this.prisma);
    const records = await prismaClient.screeningInsight.findMany({
      where: { screeningSessionId },
      orderBy: [{ score: "desc" }, { updatedAt: "desc" }],
    });

    return this.mapInsightsWithLatestVersions(records as InsightRecord[]);
  }

  async findBySessionAndStockCode(
    screeningSessionId: string,
    stockCode: string,
  ): Promise<ScreeningInsight | null> {
    const prismaClient = asScreeningInsightClient(this.prisma);
    const record = await prismaClient.screeningInsight.findUnique({
      where: {
        screeningSessionId_stockCode: {
          screeningSessionId,
          stockCode,
        },
      },
    });

    if (!record) {
      return null;
    }

    const versionRecord = await this.getLatestVersionForInsight(
      record.id,
      record.latestVersionId,
    );

    if (!versionRecord) {
      return null;
    }

    return toDomain(record as InsightRecord, versionRecord);
  }

  async findVersions(insightId: string): Promise<ScreeningInsightVersion[]> {
    const prismaClient = asScreeningInsightClient(this.prisma);
    const records = await prismaClient.screeningInsightVersion.findMany({
      where: { insightId },
      orderBy: { version: "desc" },
    });

    return records.map((record) =>
      toVersionDomain(record as InsightVersionRecord),
    );
  }

  private async mapInsightsWithLatestVersions(records: InsightRecord[]) {
    if (records.length === 0) {
      return [];
    }

    const prismaClient = asScreeningInsightClient(this.prisma);
    const versionIds = records
      .map((record) => record.latestVersionId)
      .filter((id): id is string => Boolean(id));
    const versions = await prismaClient.screeningInsightVersion.findMany({
      where: {
        id: {
          in: versionIds,
        },
      },
    });
    const versionsById = new Map(
      versions.map((item) => [item.id, item as InsightVersionRecord]),
    );

    return records.flatMap((record) => {
      const versionRecord = record.latestVersionId
        ? versionsById.get(record.latestVersionId)
        : undefined;

      return versionRecord ? [toDomain(record, versionRecord)] : [];
    });
  }

  private async getLatestVersionForInsight(
    insightId: string,
    latestVersionId: string | null,
  ) {
    const prismaClient = asScreeningInsightClient(this.prisma);

    if (latestVersionId) {
      return (await prismaClient.screeningInsightVersion.findUnique({
        where: { id: latestVersionId },
      })) as InsightVersionRecord | null;
    }

    return (await prismaClient.screeningInsightVersion.findFirst({
      where: { insightId },
      orderBy: { version: "desc" },
    })) as InsightVersionRecord | null;
  }
}

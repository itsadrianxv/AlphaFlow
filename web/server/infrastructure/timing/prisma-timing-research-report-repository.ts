import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  TimingResearchReportDraft,
  TimingResearchReportRecord,
  TimingRiskFlag,
  TimingSourceType,
} from "~/server/domain/timing/types";

const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

function mapReport(record: any): TimingResearchReportRecord {
  return {
    ...record,
    asOfDate: record.signalSnapshot?.asOfDate?.toISOString().slice(0, 10),
    sourceType: record.sourceType as TimingSourceType,
    researchState: record.researchState as TimingResearchReportRecord["researchState"],
    trendState: record.trendState as TimingResearchReportRecord["trendState"],
    marketState: record.marketState as TimingResearchReportRecord["marketState"],
    marketTransition: record.marketTransition as TimingResearchReportRecord["marketTransition"],
    dimensions: record.dimensions as TimingResearchReportRecord["dimensions"],
    observationConditions: record.observationConditions as TimingResearchReportRecord["observationConditions"],
    dataCompleteness: record.dataCompleteness as TimingResearchReportRecord["dataCompleteness"],
    modelOutlook: (record.modelOutlook as TimingResearchReportRecord["modelOutlook"]) ?? null,
    riskFlags: record.riskFlags as TimingRiskFlag[],
    reasoning: record.reasoning as TimingResearchReportRecord["reasoning"],
    ruleAudit: record.ruleAudit as TimingResearchReportRecord["ruleAudit"],
    signalSnapshot: record.signalSnapshot
      ? {
          ...record.signalSnapshot,
          asOfDate: record.signalSnapshot.asOfDate.toISOString().slice(0, 10),
          sourceType: record.signalSnapshot.sourceType as TimingSourceType,
          timeframe: record.signalSnapshot.timeframe as "DAILY",
          bars: record.signalSnapshot.bars ?? undefined,
          barsByTimeframe: record.signalSnapshot.barsByTimeframe ?? undefined,
          featureEvidence: record.signalSnapshot.featureEvidence ?? undefined,
          dataManifest: record.signalSnapshot.dataManifest ?? undefined,
        }
      : undefined,
  };
}

export class PrismaTimingResearchReportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createMany(items: TimingResearchReportDraft[]) {
    const records = await this.prisma.$transaction(
      items.map((item) =>
        this.prisma.timingResearchReport.create({
          data: {
            userId: item.userId,
            workflowRunId: item.workflowRunId,
            watchListId: item.watchListId,
            presetId: item.presetId,
            presetRevisionId: item.presetRevisionId,
            stockCode: item.stockCode,
            stockName: item.stockName,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            signalSnapshotId: item.signalSnapshotId,
            researchState: item.researchState,
            trendState: item.trendState,
            confidence: item.confidence,
            marketState: item.marketState,
            marketTransition: item.marketTransition,
            summary: item.summary,
            dimensions: toJson(item.dimensions),
            observationConditions: toJson(item.observationConditions),
            dataCompleteness: toJson(item.dataCompleteness),
            modelOutlook: item.modelOutlook ? toJson(item.modelOutlook) : undefined,
            riskFlags: item.riskFlags,
            reasoning: toJson(item.reasoning),
            ruleAudit: toJson(item.ruleAudit),
          },
          include: { signalSnapshot: true },
        }),
      ),
    );
    return records.map(mapReport);
  }

  async getByIdForUser(userId: string, id: string) {
    const record = await this.prisma.timingResearchReport.findFirst({
      where: { id, userId },
      include: { signalSnapshot: true },
    });
    return record ? mapReport(record) : null;
  }

  async listForUser(params: {
    userId: string;
    limit: number;
    stockCode?: string;
    sourceType?: TimingSourceType;
    watchListId?: string;
    workflowRunId?: string;
  }) {
    const records = await this.prisma.timingResearchReport.findMany({
      where: {
        userId: params.userId,
        stockCode: params.stockCode,
        sourceType: params.sourceType,
        watchListId: params.watchListId,
        workflowRunId: params.workflowRunId,
      },
      include: { signalSnapshot: true },
      take: params.limit,
      orderBy: { createdAt: "desc" },
    });
    return records.map(mapReport);
  }
}

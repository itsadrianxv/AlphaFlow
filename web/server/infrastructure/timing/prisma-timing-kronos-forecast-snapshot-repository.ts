import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  TimingKronosForecast,
  TimingKronosForecastSummary,
  TimingSourceType,
} from "~/server/domain/timing/types";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export type TimingKronosForecastSnapshotRecord = {
  id: string;
  userId: string;
  workflowRunId?: string | null;
  stockCode: string;
  stockName: string;
  asOfDate: string;
  sourceType: TimingSourceType;
  sourceId: string;
  modelName: string;
  modelVersion: string;
  lookbackDays: number;
  predictionLength: number;
  inputBarsHash: string;
  forecast: TimingKronosForecast;
  summary: TimingKronosForecastSummary;
  warnings: string[];
  createdAt: Date;
};

function mapRecord(record: {
  id: string;
  userId: string;
  workflowRunId: string | null;
  stockCode: string;
  stockName: string;
  asOfDate: Date;
  sourceType: string;
  sourceId: string;
  modelName: string;
  modelVersion: string;
  lookbackDays: number;
  predictionLength: number;
  inputBarsHash: string;
  forecastJson: unknown;
  summaryJson: unknown;
  warnings: string[];
  createdAt: Date;
}): TimingKronosForecastSnapshotRecord {
  return {
    id: record.id,
    userId: record.userId,
    workflowRunId: record.workflowRunId,
    stockCode: record.stockCode,
    stockName: record.stockName,
    asOfDate: record.asOfDate.toISOString().slice(0, 10),
    sourceType: record.sourceType as TimingSourceType,
    sourceId: record.sourceId,
    modelName: record.modelName,
    modelVersion: record.modelVersion,
    lookbackDays: record.lookbackDays,
    predictionLength: record.predictionLength,
    inputBarsHash: record.inputBarsHash,
    forecast: record.forecastJson as TimingKronosForecast,
    summary: record.summaryJson as TimingKronosForecastSummary,
    warnings: record.warnings,
    createdAt: record.createdAt,
  };
}

type KronosForecastDelegate = {
  upsert: (args: Prisma.TimingKronosForecastSnapshotUpsertArgs) => Promise<{
    id: string;
    userId: string;
    workflowRunId: string | null;
    stockCode: string;
    stockName: string;
    asOfDate: Date;
    sourceType: string;
    sourceId: string;
    modelName: string;
    modelVersion: string;
    lookbackDays: number;
    predictionLength: number;
    inputBarsHash: string;
    forecastJson: unknown;
    summaryJson: unknown;
    warnings: string[];
    createdAt: Date;
  }>;
  findFirst: (
    args: Prisma.TimingKronosForecastSnapshotFindFirstArgs,
  ) => Promise<{
    id: string;
    userId: string;
    workflowRunId: string | null;
    stockCode: string;
    stockName: string;
    asOfDate: Date;
    sourceType: string;
    sourceId: string;
    modelName: string;
    modelVersion: string;
    lookbackDays: number;
    predictionLength: number;
    inputBarsHash: string;
    forecastJson: unknown;
    summaryJson: unknown;
    warnings: string[];
    createdAt: Date;
  } | null>;
  findMany: (args: Prisma.TimingKronosForecastSnapshotFindManyArgs) => Promise<
    Array<{
      id: string;
      userId: string;
      workflowRunId: string | null;
      stockCode: string;
      stockName: string;
      asOfDate: Date;
      sourceType: string;
      sourceId: string;
      modelName: string;
      modelVersion: string;
      lookbackDays: number;
      predictionLength: number;
      inputBarsHash: string;
      forecastJson: unknown;
      summaryJson: unknown;
      warnings: string[];
      createdAt: Date;
    }>
  >;
};

type PrismaWithKronos = PrismaClient & {
  timingKronosForecastSnapshot: KronosForecastDelegate;
};

export class PrismaTimingKronosForecastSnapshotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private get snapshots() {
    return (this.prisma as PrismaWithKronos).timingKronosForecastSnapshot;
  }

  async upsert(params: {
    userId: string;
    workflowRunId?: string;
    stockCode: string;
    stockName: string;
    sourceType: TimingSourceType;
    sourceId: string;
    inputBarsHash: string;
    forecast: TimingKronosForecast;
  }) {
    const asOfDate = toDateOnly(params.forecast.asOfDate);
    const record = await this.snapshots.upsert({
      where: {
        userId_stockCode_asOfDate_modelName_predictionLength_inputBarsHash: {
          userId: params.userId,
          stockCode: params.stockCode,
          asOfDate,
          modelName: params.forecast.modelName,
          predictionLength: params.forecast.predictionLength,
          inputBarsHash: params.inputBarsHash,
        },
      },
      create: {
        userId: params.userId,
        workflowRunId: params.workflowRunId,
        stockCode: params.stockCode,
        stockName: params.stockName,
        asOfDate,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        modelName: params.forecast.modelName,
        modelVersion: params.forecast.modelVersion,
        lookbackDays: params.forecast.lookbackDays,
        predictionLength: params.forecast.predictionLength,
        inputBarsHash: params.inputBarsHash,
        forecastJson: toJson(params.forecast),
        summaryJson: toJson(params.forecast.summary),
        warnings: params.forecast.warnings,
      },
      update: {
        workflowRunId: params.workflowRunId,
        sourceType: params.sourceType,
        sourceId: params.sourceId,
        stockName: params.stockName,
        modelVersion: params.forecast.modelVersion,
        lookbackDays: params.forecast.lookbackDays,
        forecastJson: toJson(params.forecast),
        summaryJson: toJson(params.forecast.summary),
        warnings: params.forecast.warnings,
      },
    });

    return mapRecord(record);
  }

  async getLatestForStock(params: {
    userId: string;
    stockCode: string;
    asOfDate: string;
  }) {
    const record = await this.snapshots.findFirst({
      where: {
        userId: params.userId,
        stockCode: params.stockCode,
        asOfDate: toDateOnly(params.asOfDate),
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return record ? mapRecord(record) : null;
  }

  async listForWorkflowRun(params: { userId: string; workflowRunId: string }) {
    const records = await this.snapshots.findMany({
      where: {
        userId: params.userId,
        workflowRunId: params.workflowRunId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return records.map((record) => mapRecord(record));
  }
}

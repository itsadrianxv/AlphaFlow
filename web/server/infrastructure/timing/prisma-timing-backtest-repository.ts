import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  TimingBacktestPerformanceMetrics,
  TimingBacktestQualityMetrics,
  TimingPresetConfigV2,
} from "~/server/domain/timing/types";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

export class PrismaTimingBacktestRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(params: {
    userId: string;
    presetRevisionId: string;
    watchListId: string;
    configHash: string;
    stockCodes: string[];
    config: TimingPresetConfigV2;
  }) {
    return this.prisma.timingBacktestRun.create({
      data: {
        userId: params.userId,
        presetRevisionId: params.presetRevisionId,
        watchListId: params.watchListId,
        status: "RUNNING",
        configHash: params.configHash,
        universeSnapshot: toJson({
          stockCodes: params.stockCodes,
          capturedAt: new Date().toISOString(),
          warning: "仅当前自选股样本，存在样本内验证和幸存偏差。",
        }),
        executionAssumptions: toJson(params.config.backtestPolicy),
        startedAt: new Date(),
      },
    });
  }

  async complete(params: {
    id: string;
    quality: TimingBacktestQualityMetrics;
    performance: TimingBacktestPerformanceMetrics;
    events: unknown[];
    warnings: string[];
  }) {
    return this.prisma.timingBacktestRun.update({
      where: { id: params.id },
      data: {
        status: params.quality.gatePassed ? "SUCCEEDED" : "QUALITY_FAILED",
        qualityMetrics: toJson(params.quality),
        performanceMetrics: toJson(params.performance),
        eventSnapshot: toJson(params.events),
        warnings: params.warnings,
        completedAt: new Date(),
      },
    });
  }

  async fail(id: string, errorMessage: string) {
    return this.prisma.timingBacktestRun.update({
      where: { id },
      data: { status: "FAILED", errorMessage, completedAt: new Date() },
    });
  }

  async listForRevision(userId: string, presetRevisionId: string) {
    return this.prisma.timingBacktestRun.findMany({
      where: { userId, presetRevisionId },
      orderBy: { createdAt: "desc" },
    });
  }

  async latestPassing(params: {
    userId: string;
    presetRevisionId: string;
    configHash: string;
  }) {
    return this.prisma.timingBacktestRun.findFirst({
      where: {
        userId: params.userId,
        presetRevisionId: params.presetRevisionId,
        configHash: params.configHash,
        status: "SUCCEEDED",
      },
      orderBy: { completedAt: "desc" },
    });
  }
}

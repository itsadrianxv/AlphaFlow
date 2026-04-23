/**
 * PrismaScreeningSessionRepository 实现
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { ScreeningSession } from "~/modules/screening/server/domain/aggregates/screening-session";
import { FilterGroup } from "~/modules/screening/server/domain/entities/filter-group";
import { ScreeningSessionStatus } from "~/modules/screening/server/domain/enums/screening-session-status";
import type { IScreeningSessionRepository } from "~/modules/screening/server/domain/repositories/screening-session-repository";
import { ScoredStock } from "~/modules/screening/server/domain/value-objects/scored-stock";
import { ScoringConfig } from "~/modules/screening/server/domain/value-objects/scoring-config";
import { StockCode } from "~/modules/screening/server/domain/value-objects/stock-code";

type ScreeningSessionRecord = {
  id: string;
  strategyId: string | null;
  strategyName: string;
  executedAt: Date;
  status: string;
  progressPercent: number;
  currentStep: string | null;
  errorMessage: string | null;
  cancellationRequestedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  totalScanned: number;
  executionTime: number;
  topStocks: unknown;
  otherStockCodes: string[];
  filtersSnapshot: unknown;
  scoringConfigSnapshot: unknown;
  userId: string;
};

type ScreeningSessionClient = {
  screeningSession: {
    upsert(args: unknown): Promise<ScreeningSessionRecord>;
    findUnique(args: unknown): Promise<ScreeningSessionRecord | null>;
    delete(args: unknown): Promise<ScreeningSessionRecord>;
    findMany(args: unknown): Promise<ScreeningSessionRecord[]>;
    findFirst(args: unknown): Promise<ScreeningSessionRecord | null>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
};

function asScreeningSessionClient(client: unknown): ScreeningSessionClient {
  return client as ScreeningSessionClient;
}

export class PrismaScreeningSessionRepository
  implements IScreeningSessionRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async searchHistoryForUser(params: {
    userId: string;
    limit: number;
    offset: number;
    search?: string;
  }) {
    const searchTerm = params.search ? `%${params.search}%` : undefined;
    const whereClauses = [Prisma.sql`"userId" = ${params.userId}`];

    if (searchTerm) {
      whereClauses.push(Prisma.sql`
        (
          "strategyName" ILIKE ${searchTerm}
          OR COALESCE("currentStep", '') ILIKE ${searchTerm}
          OR COALESCE("errorMessage", '') ILIKE ${searchTerm}
          OR COALESCE("topStocks"::text, '') ILIKE ${searchTerm}
          OR COALESCE(array_to_string("otherStockCodes", ' '), '') ILIKE ${searchTerm}
          OR COALESCE("filtersSnapshot"::text, '') ILIKE ${searchTerm}
          OR COALESCE("scoringConfigSnapshot"::text, '') ILIKE ${searchTerm}
        )
      `);
    }

    const whereSql = Prisma.join(whereClauses, " AND ");

    const [items, countResult] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          id: string;
          strategyId: string | null;
          strategyName: string;
          executedAt: Date;
          status: string;
          progressPercent: number;
          currentStep: string | null;
          errorMessage: string | null;
          totalScanned: number;
          matchedCount: number;
          executionTime: number;
        }>
      >(Prisma.sql`
        SELECT
          id,
          "strategyId",
          "strategyName",
          "executedAt",
          status::text AS status,
          "progressPercent",
          "currentStep",
          "errorMessage",
          "totalScanned",
          jsonb_array_length(COALESCE("topStocks", '[]'::jsonb))::int AS "matchedCount",
          "executionTime"
        FROM "ScreeningSession"
        WHERE ${whereSql}
        ORDER BY "executedAt" DESC, id DESC
        LIMIT ${params.limit}
        OFFSET ${params.offset}
      `),
      this.prisma.$queryRaw<Array<{ totalCount: number }>>(Prisma.sql`
        SELECT COUNT(*)::int AS "totalCount"
        FROM "ScreeningSession"
        WHERE ${whereSql}
      `),
    ]);

    return {
      items,
      totalCount: countResult[0]?.totalCount ?? 0,
    };
  }

  async save(session: ScreeningSession): Promise<void> {
    const prismaClient = asScreeningSessionClient(this.prisma);
    const data = {
      strategyId: session.strategyId,
      strategyName: session.strategyName,
      executedAt: session.executedAt,
      status: session.status,
      progressPercent: session.progressPercent,
      currentStep: session.currentStep,
      errorMessage: session.errorMessage,
      cancellationRequestedAt: session.cancellationRequestedAt,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      totalScanned: session.totalScanned,
      executionTime: session.executionTime,
      topStocks: session.topStocks.map((stock) => stock.toDict()) as object[],
      otherStockCodes: session.otherStockCodes.map((code) => code.value),
      filtersSnapshot: session.filtersSnapshot.toDict() as object,
      scoringConfigSnapshot: session.scoringConfigSnapshot.toDict() as object,
      userId: session.userId,
    };

    await prismaClient.screeningSession.upsert({
      where: { id: session.id },
      create: {
        id: session.id,
        ...data,
      },
      update: data,
    });
  }

  async findById(id: string): Promise<ScreeningSession | null> {
    const prismaClient = asScreeningSessionClient(this.prisma);
    const record = await prismaClient.screeningSession.findUnique({
      where: { id },
    });

    if (!record) {
      return null;
    }

    return this.toDomain(record);
  }

  async delete(id: string): Promise<void> {
    const prismaClient = asScreeningSessionClient(this.prisma);
    await prismaClient.screeningSession.delete({
      where: { id },
    });
  }

  async findByStrategy(
    strategyId: string,
    limit?: number,
    offset?: number,
  ): Promise<ScreeningSession[]> {
    const prismaClient = asScreeningSessionClient(this.prisma);
    const records = await prismaClient.screeningSession.findMany({
      where: { strategyId },
      take: limit,
      skip: offset,
      orderBy: [{ executedAt: "desc" }, { id: "desc" }],
    });

    return records.map((record) => this.toDomain(record));
  }

  async findByStrategyForUser(
    strategyId: string,
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<ScreeningSession[]> {
    const prismaClient = asScreeningSessionClient(this.prisma);
    const records = await prismaClient.screeningSession.findMany({
      where: { strategyId, userId },
      take: limit,
      skip: offset,
      orderBy: [{ executedAt: "desc" }, { id: "desc" }],
    });

    return records.map((record) => this.toDomain(record));
  }

  async findRecentSessions(
    limit?: number,
    offset?: number,
  ): Promise<ScreeningSession[]> {
    const prismaClient = asScreeningSessionClient(this.prisma);
    const records = await prismaClient.screeningSession.findMany({
      take: limit,
      skip: offset,
      orderBy: [{ executedAt: "desc" }, { id: "desc" }],
    });

    return records.map((record) => this.toDomain(record));
  }

  async findRecentSessionsByUser(
    userId: string,
    limit?: number,
    offset?: number,
  ): Promise<ScreeningSession[]> {
    const prismaClient = asScreeningSessionClient(this.prisma);
    const records = await prismaClient.screeningSession.findMany({
      where: { userId },
      take: limit,
      skip: offset,
      orderBy: [{ executedAt: "desc" }, { id: "desc" }],
    });

    return records.map((record) => this.toDomain(record));
  }

  async claimNextPendingSession(): Promise<ScreeningSession | null> {
    return this.prisma.$transaction(async (tx) => {
      const txClient = asScreeningSessionClient(tx);
      const candidate = await txClient.screeningSession.findFirst({
        where: {
          status: ScreeningSessionStatus.PENDING,
        },
        orderBy: [{ executedAt: "asc" }, { id: "asc" }],
      });

      if (!candidate) {
        return null;
      }

      const claimResult = await txClient.screeningSession.updateMany({
        where: {
          id: candidate.id,
          status: ScreeningSessionStatus.PENDING,
        },
        data: {
          status: ScreeningSessionStatus.RUNNING,
          startedAt: candidate.startedAt ?? new Date(),
          currentStep: "准备执行",
          progressPercent: Math.max(candidate.progressPercent, 1),
        },
      });

      if (claimResult.count === 0) {
        return null;
      }

      const claimed = await txClient.screeningSession.findUnique({
        where: { id: candidate.id },
      });

      return claimed ? this.toDomain(claimed) : null;
    });
  }

  async findRunningSessions(limit = 20): Promise<ScreeningSession[]> {
    const prismaClient = asScreeningSessionClient(this.prisma);
    const records = await prismaClient.screeningSession.findMany({
      where: {
        status: ScreeningSessionStatus.RUNNING,
      },
      orderBy: [{ startedAt: "asc" }, { executedAt: "asc" }],
      take: limit,
    });

    return records.map((record) => this.toDomain(record));
  }

  private toDomain(record: ScreeningSessionRecord): ScreeningSession {
    const topStocksData = record.topStocks as Record<string, unknown>[];
    const topStocks = topStocksData.map((stockData) =>
      ScoredStock.fromDict(stockData),
    );
    const otherStockCodes = record.otherStockCodes.map((code) =>
      StockCode.create(code),
    );
    const filtersSnapshot = FilterGroup.fromDict(
      record.filtersSnapshot as Record<string, unknown>,
    );
    const scoringConfigSnapshot = ScoringConfig.fromDict(
      record.scoringConfigSnapshot as Record<string, unknown>,
    );

    return ScreeningSession.fromDict({
      id: record.id,
      strategyId: record.strategyId,
      strategyName: record.strategyName,
      userId: record.userId,
      executedAt: record.executedAt.toISOString(),
      status: record.status,
      progressPercent: record.progressPercent,
      currentStep: record.currentStep,
      errorMessage: record.errorMessage,
      cancellationRequestedAt:
        record.cancellationRequestedAt?.toISOString() ?? null,
      startedAt: record.startedAt?.toISOString() ?? null,
      completedAt: record.completedAt?.toISOString() ?? null,
      totalScanned: record.totalScanned,
      executionTime: record.executionTime,
      topStocks: topStocks.map((stock) => stock.toDict()),
      otherStockCodes: otherStockCodes.map((code) => code.value),
      filtersSnapshot: filtersSnapshot.toDict(),
      scoringConfigSnapshot: scoringConfigSnapshot.toDict(),
    });
  }
}

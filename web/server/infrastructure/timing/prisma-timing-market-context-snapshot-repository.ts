import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  MarketContextAnalysis,
  MarketContextSnapshot,
  MarketContextSnapshotRecord,
} from "~/server/domain/timing/types";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function mapRecord(record: {
  id: string;
  asOfDate: Date;
  state: string;
  transition: string;
  persistenceDays: number;
  snapshotJson: unknown;
  analysisJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}): MarketContextSnapshotRecord {
  return {
    id: record.id,
    asOfDate: record.asOfDate.toISOString().slice(0, 10),
    state: record.state as MarketContextSnapshotRecord["state"],
    transition: record.transition as MarketContextSnapshotRecord["transition"],
    persistenceDays: record.persistenceDays,
    snapshot: record.snapshotJson as MarketContextSnapshot,
    analysis: record.analysisJson as MarketContextAnalysis,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class PrismaTimingMarketContextSnapshotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getByAsOfDate(asOfDate: string) {
    const record = await this.prisma.timingMarketContextSnapshot.findUnique({
      where: {
        asOfDate: toDateOnly(asOfDate),
      },
    });

    return record ? mapRecord(record) : null;
  }

  async getLatest() {
    const record = await this.prisma.timingMarketContextSnapshot.findFirst({
      orderBy: {
        asOfDate: "desc",
      },
    });

    return record ? mapRecord(record) : null;
  }

  async listRecent(limit = 30) {
    const records = await this.prisma.timingMarketContextSnapshot.findMany({
      take: limit,
      orderBy: {
        asOfDate: "desc",
      },
    });

    return records.map((record) => mapRecord(record));
  }

  async upsert(params: {
    asOfDate: string;
    snapshot: MarketContextSnapshot;
    analysis: MarketContextAnalysis;
  }) {
    const record = await this.prisma.timingMarketContextSnapshot.upsert({
      where: {
        asOfDate: toDateOnly(params.asOfDate),
      },
      create: {
        asOfDate: toDateOnly(params.asOfDate),
        state: params.analysis.state,
        transition: params.analysis.transition,
        persistenceDays: params.analysis.persistenceDays,
        snapshotJson: toJson(params.snapshot),
        analysisJson: toJson(params.analysis),
      },
      update: {
        state: params.analysis.state,
        transition: params.analysis.transition,
        persistenceDays: params.analysis.persistenceDays,
        snapshotJson: toJson(params.snapshot),
        analysisJson: toJson(params.analysis),
      },
    });

    return mapRecord(record);
  }
}

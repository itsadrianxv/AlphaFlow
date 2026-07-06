import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  PortfolioSnapshotDraft,
  PortfolioSnapshotRecord,
} from "~/server/domain/timing/types";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

function mapRecord(record: {
  id: string;
  userId: string;
  name: string;
  baseCurrency: string;
  cash: number;
  totalCapital: number;
  positions: unknown;
  riskPreferences: unknown;
  createdAt: Date;
  updatedAt: Date;
}): PortfolioSnapshotRecord {
  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    baseCurrency: record.baseCurrency,
    cash: record.cash,
    totalCapital: record.totalCapital,
    positions: record.positions as PortfolioSnapshotRecord["positions"],
    riskPreferences:
      record.riskPreferences as PortfolioSnapshotRecord["riskPreferences"],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class PrismaPortfolioSnapshotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(params: PortfolioSnapshotDraft) {
    const record = await this.prisma.portfolioSnapshot.create({
      data: {
        userId: params.userId,
        name: params.name,
        baseCurrency: params.baseCurrency,
        cash: params.cash,
        totalCapital: params.totalCapital,
        positions: toJson(params.positions),
        riskPreferences: toJson(params.riskPreferences),
      },
    });

    return mapRecord(record);
  }

  async update(
    id: string,
    userId: string,
    params: Omit<PortfolioSnapshotDraft, "userId">,
  ) {
    const record = await this.prisma.portfolioSnapshot.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!record) {
      return null;
    }

    const updated = await this.prisma.portfolioSnapshot.update({
      where: { id },
      data: {
        name: params.name,
        baseCurrency: params.baseCurrency,
        cash: params.cash,
        totalCapital: params.totalCapital,
        positions: toJson(params.positions),
        riskPreferences: toJson(params.riskPreferences),
      },
    });

    return mapRecord(updated);
  }

  async getByIdForUser(userId: string, id: string) {
    const record = await this.prisma.portfolioSnapshot.findFirst({
      where: {
        id,
        userId,
      },
    });

    return record ? mapRecord(record) : null;
  }

  async listForUser(userId: string) {
    const records = await this.prisma.portfolioSnapshot.findMany({
      where: {
        userId,
      },
      orderBy: [
        {
          updatedAt: "desc",
        },
      ],
    });

    return records.map((record) => mapRecord(record));
  }
}

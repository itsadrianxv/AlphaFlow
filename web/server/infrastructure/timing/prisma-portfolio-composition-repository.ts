import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  PortfolioCompositionDraft,
  PortfolioCompositionPosition,
  PortfolioCompositionRecord,
} from "~/server/domain/timing/types";

const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const mapRecord = (record: any): PortfolioCompositionRecord => ({
  ...record,
  positions: record.positions as PortfolioCompositionPosition[],
  source: record.source as PortfolioCompositionRecord["source"],
});

export class PrismaPortfolioCompositionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: PortfolioCompositionDraft) {
    return mapRecord(await this.prisma.portfolioComposition.create({ data: { ...input, positions: toJson(input.positions) } }));
  }

  async update(id: string, userId: string, input: Pick<PortfolioCompositionDraft, "name" | "positions">) {
    const existing = await this.prisma.portfolioComposition.findFirst({ where: { id, userId } });
    if (!existing) return null;
    return mapRecord(await this.prisma.portfolioComposition.update({ where: { id }, data: { name: input.name, positions: toJson(input.positions) } }));
  }

  async getByIdForUser(userId: string, id: string) {
    const record = await this.prisma.portfolioComposition.findFirst({ where: { id, userId } });
    return record ? mapRecord(record) : null;
  }

  async listForUser(userId: string) {
    return (await this.prisma.portfolioComposition.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } })).map(mapRecord);
  }
}

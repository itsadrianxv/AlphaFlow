import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  TimingPresetDraft,
  TimingPresetRecord,
} from "~/server/domain/timing/types";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

function mapRecord(record: {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
}): TimingPresetRecord {
  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    description: record.description,
    config: record.config as TimingPresetRecord["config"],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class PrismaTimingPresetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(params: TimingPresetDraft) {
    const record = await this.prisma.timingPreset.create({
      data: {
        userId: params.userId,
        name: params.name,
        description: params.description,
        config: toJson(params.config),
      },
    });

    return mapRecord(record);
  }

  async update(
    id: string,
    userId: string,
    params: Omit<TimingPresetDraft, "userId">,
  ) {
    const existing = await this.prisma.timingPreset.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!existing) {
      return null;
    }

    const record = await this.prisma.timingPreset.update({
      where: { id },
      data: {
        name: params.name,
        description: params.description,
        config: toJson(params.config),
      },
    });

    return mapRecord(record);
  }

  async getByIdForUser(userId: string, id: string) {
    const record = await this.prisma.timingPreset.findFirst({
      where: {
        id,
        userId,
      },
    });

    return record ? mapRecord(record) : null;
  }

  async listForUser(userId: string) {
    const records = await this.prisma.timingPreset.findMany({
      where: { userId },
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    });

    return records.map((record) => mapRecord(record));
  }
}

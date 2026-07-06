import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  TimingPresetAdjustmentSuggestionDraft,
  TimingPresetAdjustmentSuggestionRecord,
  TimingPresetAdjustmentSuggestionStatus,
} from "~/server/domain/timing/types";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

function mapRecord(record: {
  id: string;
  userId: string;
  presetId: string | null;
  kind: string;
  status: string;
  title: string;
  summary: string;
  patch: unknown;
  metrics: unknown;
  appliedAt: Date | null;
  dismissedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): TimingPresetAdjustmentSuggestionRecord {
  return {
    id: record.id,
    userId: record.userId,
    presetId: record.presetId,
    kind: record.kind as TimingPresetAdjustmentSuggestionRecord["kind"],
    status: record.status as TimingPresetAdjustmentSuggestionStatus,
    title: record.title,
    summary: record.summary,
    patch: record.patch as TimingPresetAdjustmentSuggestionRecord["patch"],
    metrics:
      record.metrics as TimingPresetAdjustmentSuggestionRecord["metrics"],
    appliedAt: record.appliedAt,
    dismissedAt: record.dismissedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class PrismaTimingPresetAdjustmentSuggestionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listForUser(params: {
    userId: string;
    status?: TimingPresetAdjustmentSuggestionStatus;
    presetId?: string;
    limit: number;
  }) {
    const records = await this.prisma.timingPresetAdjustmentSuggestion.findMany(
      {
        where: {
          userId: params.userId,
          presetId: params.presetId,
          status: params.status,
        },
        take: params.limit,
        orderBy: [{ createdAt: "desc" }],
      },
    );

    return records.map((record) => mapRecord(record));
  }

  async getByIdForUser(userId: string, id: string) {
    const record = await this.prisma.timingPresetAdjustmentSuggestion.findFirst(
      {
        where: {
          userId,
          id,
        },
      },
    );

    return record ? mapRecord(record) : null;
  }

  async replacePendingForPreset(params: {
    userId: string;
    presetId?: string | null;
    items: TimingPresetAdjustmentSuggestionDraft[];
  }) {
    await this.prisma.timingPresetAdjustmentSuggestion.deleteMany({
      where: {
        userId: params.userId,
        presetId: params.presetId ?? null,
        status: "PENDING",
      },
    });

    if (!params.items.length) {
      return [];
    }

    const records = await this.prisma.$transaction(
      params.items.map((item) =>
        this.prisma.timingPresetAdjustmentSuggestion.create({
          data: {
            userId: item.userId,
            presetId: item.presetId,
            kind: item.kind,
            status: item.status,
            title: item.title,
            summary: item.summary,
            patch: toJson(item.patch),
            metrics: toJson(item.metrics),
            appliedAt: item.appliedAt,
            dismissedAt: item.dismissedAt,
          },
        }),
      ),
    );

    return records.map((record) => mapRecord(record));
  }

  async markApplied(id: string) {
    const record = await this.prisma.timingPresetAdjustmentSuggestion.update({
      where: {
        id,
      },
      data: {
        status: "APPLIED",
        appliedAt: new Date(),
      },
    });

    return mapRecord(record);
  }

  async markDismissed(id: string) {
    const record = await this.prisma.timingPresetAdjustmentSuggestion.update({
      where: {
        id,
      },
      data: {
        status: "DISMISSED",
        dismissedAt: new Date(),
      },
    });

    return mapRecord(record);
  }
}

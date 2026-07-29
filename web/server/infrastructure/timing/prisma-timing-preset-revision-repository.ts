import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

import {
  TIMING_FEATURE_VERSION,
  TIMING_RULE_ENGINE_VERSION,
} from "~/server/domain/timing/services/timing-rule-engine";
import type {
  TimingResearchRuleConfig,
  TimingPresetRevisionRecord,
  TimingStrategyRecord,
} from "~/server/domain/timing/types";

const toJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function hashTimingPresetConfig(config: TimingResearchRuleConfig) {
  return createHash("sha256")
    .update(JSON.stringify(stableValue(config)))
    .digest("hex");
}

function mapRevision(record: {
  id: string;
  presetId: string;
  userId: string;
  revisionNumber: number;
  status: string;
  config: unknown;
  configHash: string;
  engineVersion: string;
  featureVersion: string;
  templateVersion: number | null;
  validationSource: string | null;
  publishedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): TimingPresetRevisionRecord {
  return {
    ...record,
    status: record.status as TimingPresetRevisionRecord["status"],
    config: record.config as TimingResearchRuleConfig,
    validationSource:
      record.validationSource as TimingPresetRevisionRecord["validationSource"],
  };
}

function mapStrategy(record: {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  origin: string;
  templateKey: string | null;
  activeRevisionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  activeRevision?: Parameters<typeof mapRevision>[0] | null;
  revisions: Parameters<typeof mapRevision>[0][];
}): TimingStrategyRecord {
  return {
    id: record.id,
    userId: record.userId,
    name: record.name,
    description: record.description,
    origin: record.origin as TimingStrategyRecord["origin"],
    templateKey: record.templateKey,
    activeRevisionId: record.activeRevisionId,
    activeRevision: record.activeRevision
      ? mapRevision(record.activeRevision)
      : null,
    revisions: record.revisions.map(mapRevision),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

const strategyInclude = {
  activeRevision: true,
  revisions: { orderBy: { revisionNumber: "desc" as const } },
};

export class PrismaTimingPresetRevisionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createStrategy(params: {
    userId: string;
    name: string;
    description?: string;
    config: TimingResearchRuleConfig;
  }) {
    const configHash = hashTimingPresetConfig(params.config);
    const record = await this.prisma.$transaction(async (tx) => {
      const preset = await tx.timingPreset.create({
        data: {
          userId: params.userId,
          name: params.name,
          description: params.description,
          origin: "USER",
          config: toJson(params.config),
        },
      });
      await tx.timingPresetRevision.create({
        data: {
          presetId: preset.id,
          userId: params.userId,
          revisionNumber: 1,
          status: "DRAFT",
          config: toJson(params.config),
          configHash,
          engineVersion: TIMING_RULE_ENGINE_VERSION,
          featureVersion: TIMING_FEATURE_VERSION,
        },
      });
      return tx.timingPreset.findUniqueOrThrow({
        where: { id: preset.id },
        include: strategyInclude,
      });
    });
    return mapStrategy(record);
  }

  async ensureSystemTemplate(params: {
    userId: string;
    templateKey: string;
    templateVersion: number;
    name: string;
    description: string;
    config: TimingResearchRuleConfig;
  }) {
    const configHash = hashTimingPresetConfig(params.config);
    const record = await this.prisma.$transaction(async (tx) => {
      const preset = await tx.timingPreset.findFirst({
        where: { userId: params.userId, templateKey: params.templateKey },
        include: strategyInclude,
      });
      if (!preset) {
        const created = await tx.timingPreset.create({
          data: {
            userId: params.userId,
            name: params.name,
            description: params.description,
            origin: "SYSTEM_TEMPLATE",
            templateKey: params.templateKey,
            config: toJson(params.config),
          },
        });
        const revision = await tx.timingPresetRevision.create({
          data: {
            presetId: created.id,
            userId: params.userId,
            revisionNumber: 1,
            status: "PUBLISHED",
            config: toJson(params.config),
            configHash,
            engineVersion: TIMING_RULE_ENGINE_VERSION,
            featureVersion: TIMING_FEATURE_VERSION,
            templateVersion: params.templateVersion,
            validationSource: "SYSTEM_TEMPLATE",
            publishedAt: new Date(),
          },
        });
        await tx.timingPreset.update({
          where: { id: created.id },
          data: { activeRevisionId: revision.id },
        });
      } else {
        const current = preset.activeRevision;
        if (
          current?.templateVersion !== params.templateVersion ||
          current.configHash !== configHash
        ) {
          const nextNumber =
            Math.max(
              0,
              ...preset.revisions.map((item) => item.revisionNumber),
            ) + 1;
          await tx.timingPresetRevision.updateMany({
            where: { presetId: preset.id, status: "PUBLISHED" },
            data: { status: "ARCHIVED", archivedAt: new Date() },
          });
          const revision = await tx.timingPresetRevision.create({
            data: {
              presetId: preset.id,
              userId: params.userId,
              revisionNumber: nextNumber,
              status: "PUBLISHED",
              config: toJson(params.config),
              configHash,
              engineVersion: TIMING_RULE_ENGINE_VERSION,
              featureVersion: TIMING_FEATURE_VERSION,
              templateVersion: params.templateVersion,
              validationSource: "SYSTEM_TEMPLATE",
              publishedAt: new Date(),
            },
          });
          await tx.timingPreset.update({
            where: { id: preset.id },
            data: {
              activeRevisionId: revision.id,
              name: params.name,
              description: params.description,
              config: toJson(params.config),
            },
          });
        }
      }
      return tx.timingPreset.findFirstOrThrow({
        where: { userId: params.userId, templateKey: params.templateKey },
        include: strategyInclude,
      });
    });
    return mapStrategy(record);
  }

  async listStrategies(userId: string) {
    const records = await this.prisma.timingPreset.findMany({
      where: { userId },
      include: strategyInclude,
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    });
    return records.map(mapStrategy);
  }

  async getStrategy(userId: string, presetId: string) {
    const record = await this.prisma.timingPreset.findFirst({
      where: { id: presetId, userId },
      include: strategyInclude,
    });
    return record ? mapStrategy(record) : null;
  }

  async getRevision(userId: string, revisionId: string) {
    const record = await this.prisma.timingPresetRevision.findFirst({
      where: { id: revisionId, userId },
    });
    return record ? mapRevision(record) : null;
  }

  async updateDraft(params: {
    userId: string;
    revisionId: string;
    name: string;
    description?: string;
    config: TimingResearchRuleConfig;
  }) {
    const revision = await this.prisma.timingPresetRevision.findFirst({
      where: { id: params.revisionId, userId: params.userId },
    });
    if (!revision || revision.status !== "DRAFT") return null;

    const configHash = hashTimingPresetConfig(params.config);
    await this.prisma.$transaction([
      this.prisma.timingPreset.update({
        where: { id: revision.presetId },
        data: {
          name: params.name,
          description: params.description,
          config: toJson(params.config),
        },
      }),
      this.prisma.timingPresetRevision.update({
        where: { id: revision.id },
        data: {
          config: toJson(params.config),
          configHash,
          engineVersion: TIMING_RULE_ENGINE_VERSION,
          featureVersion: TIMING_FEATURE_VERSION,
        },
      }),
    ]);
    return this.getStrategy(params.userId, revision.presetId);
  }

  async cloneAsDraft(params: { userId: string; revisionId: string }) {
    const source = await this.prisma.timingPresetRevision.findFirst({
      where: { id: params.revisionId, userId: params.userId },
    });
    if (!source) return null;
    const latest = await this.prisma.timingPresetRevision.aggregate({
      where: { presetId: source.presetId },
      _max: { revisionNumber: true },
    });
    const record = await this.prisma.timingPresetRevision.create({
      data: {
        presetId: source.presetId,
        userId: source.userId,
        revisionNumber: (latest._max.revisionNumber ?? 0) + 1,
        status: "DRAFT",
        config: source.config as Prisma.InputJsonValue,
        configHash: source.configHash,
        engineVersion: TIMING_RULE_ENGINE_VERSION,
        featureVersion: TIMING_FEATURE_VERSION,
      },
    });
    return mapRevision(record);
  }

  async markValidating(userId: string, revisionId: string) {
    const revision = await this.prisma.timingPresetRevision.findFirst({
      where: { id: revisionId, userId, status: "DRAFT" },
    });
    if (!revision) return null;
    return mapRevision(
      await this.prisma.timingPresetRevision.update({
        where: { id: revision.id },
        data: { status: "VALIDATING" },
      }),
    );
  }

  async returnToDraft(userId: string, revisionId: string) {
    const revision = await this.prisma.timingPresetRevision.findFirst({
      where: { id: revisionId, userId, status: "VALIDATING" },
    });
    if (!revision) return null;
    return mapRevision(
      await this.prisma.timingPresetRevision.update({
        where: { id: revision.id },
        data: { status: "DRAFT" },
      }),
    );
  }

  async publish(params: {
    userId: string;
    revisionId: string;
    validatedConfigHash: string;
  }) {
    const revision = await this.prisma.timingPresetRevision.findFirst({
      where: { id: params.revisionId, userId: params.userId },
    });
    if (
      !revision ||
      revision.status !== "VALIDATING" ||
      revision.configHash !== params.validatedConfigHash
    ) {
      return null;
    }
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.timingPresetRevision.updateMany({
        where: {
          presetId: revision.presetId,
          status: "PUBLISHED",
          id: { not: revision.id },
        },
        data: { status: "ARCHIVED", archivedAt: now },
      }),
      this.prisma.timingPresetRevision.update({
        where: { id: revision.id },
        data: {
          status: "PUBLISHED",
          publishedAt: now,
          archivedAt: null,
          validationSource: "RULE_COVERAGE_VALIDATION",
        },
      }),
      this.prisma.timingPreset.update({
        where: { id: revision.presetId },
        data: { activeRevisionId: revision.id },
      }),
    ]);
    return this.getStrategy(params.userId, revision.presetId);
  }
}

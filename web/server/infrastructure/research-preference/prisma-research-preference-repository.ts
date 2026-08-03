import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  type ResearchPreferenceImportCandidate,
  type ResearchPreferenceItem,
  type ResearchPreferenceSnapshot,
  type ResearchPreferenceState,
  researchPreferenceLevelSchema,
  researchPreferenceTargetTypeSchema,
} from "~/contracts/research-preference";
import type { ResearchPreferenceRepository } from "~/server/domain/research-preference/repository";
import {
  normalizeItem,
  type ResearchPreferenceCommand,
  type ResearchPreferenceSnapshotInput,
  sortItems,
} from "~/server/domain/research-preference/research-preference";

type TransactionClient = Prisma.TransactionClient;

export class PrismaResearchPreferenceRepository
  implements ResearchPreferenceRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async getCurrent(userId: string): Promise<ResearchPreferenceState> {
    return toState(
      await this.prisma.researchPreference.findUnique({
        where: { userId },
        include: {
          items: {
            where: { removedAt: null },
            orderBy: [{ targetType: "asc" }, { targetKey: "asc" }],
          },
        },
      }),
      userId,
    );
  }

  async listImportCandidates(
    userId: string,
  ): Promise<ResearchPreferenceImportCandidate[]> {
    const [companies, industries, watchLists] = await Promise.all([
      this.prisma.savedCompany.findMany({
        where: { userId, archivedAt: null },
        select: { stockCode: true, companyName: true },
        orderBy: { companyName: "asc" },
      }),
      this.prisma.savedIndustry.findMany({
        where: { userId, archivedAt: null },
        select: { source: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.prisma.watchList.findMany({
        where: { userId },
        select: { stocks: true },
        orderBy: { name: "asc" },
      }),
    ]);

    const candidates = new Map<string, ResearchPreferenceImportCandidate>();
    for (const company of companies) {
      const candidate: ResearchPreferenceImportCandidate = {
        targetType: "COMPANY",
        targetKey: company.stockCode.trim(),
        source: "SAVED_COMPANY",
        label: company.companyName.trim() || company.stockCode.trim(),
      };
      candidates.set(
        `${candidate.targetType}:${candidate.targetKey}`,
        candidate,
      );
    }
    for (const industry of industries) {
      const targetKey = `${industry.source.trim()}:${industry.name.trim()}`;
      const candidate: ResearchPreferenceImportCandidate = {
        targetType: "INDUSTRY",
        targetKey,
        source: "SAVED_INDUSTRY",
        label: industry.name.trim(),
      };
      candidates.set(
        `${candidate.targetType}:${candidate.targetKey}`,
        candidate,
      );
    }
    for (const watchList of watchLists) {
      if (!Array.isArray(watchList.stocks)) continue;
      for (const stock of watchList.stocks) {
        if (!isRecord(stock) || typeof stock.stockCode !== "string") continue;
        const targetKey = stock.stockCode.trim();
        if (!targetKey) continue;
        const candidate: ResearchPreferenceImportCandidate = {
          targetType: "COMPANY",
          targetKey,
          source: "WATCHLIST",
          label:
            typeof stock.stockName === "string" && stock.stockName.trim()
              ? stock.stockName.trim()
              : targetKey,
        };
        candidates.set(
          `${candidate.targetType}:${candidate.targetKey}`,
          candidate,
        );
      }
    }
    return [...candidates.values()].sort((left, right) => {
      const typeOrder = left.targetType.localeCompare(right.targetType, "en");
      if (typeOrder !== 0) return typeOrder;
      return left.targetKey.localeCompare(right.targetKey, "en");
    });
  }

  async applyCommand(
    userId: string,
    command: ResearchPreferenceCommand,
  ): Promise<ResearchPreferenceState> {
    return this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          const preference = await tx.researchPreference.upsert({
            where: { userId },
            create: { id: randomUUID(), userId },
            update: {},
            include: {
              items: {
                where: { removedAt: null },
                orderBy: [{ targetType: "asc" }, { targetKey: "asc" }],
              },
            },
          });

          if (preference.lastCommandId === command.commandId) {
            return toState(preference, userId);
          }

          const recordedCommand = await tx.researchPreferenceCommand.findUnique(
            {
              where: { commandId: command.commandId },
            },
          );
          if (recordedCommand) {
            if (recordedCommand.userId !== userId) {
              throw new Error("研究偏好命令标识已属于其他用户");
            }
            return toState(preference, userId);
          }

          const now = new Date();
          switch (command.type) {
            case "ADD":
              await upsertActiveItem(
                tx,
                preference.id,
                command.item,
                command.commandId,
                now,
              );
              break;
            case "IMPORT":
              for (const target of command.items) {
                const item = { ...target, level: "REGULAR" as const };
                const active = await tx.researchPreferenceItem.findFirst({
                  where: {
                    preferenceId: preference.id,
                    removedAt: null,
                    targetType: item.targetType,
                    targetKey: item.targetKey,
                  },
                });
                if (!active) {
                  await tx.researchPreferenceItem.create({
                    data: {
                      id: randomUUID(),
                      preferenceId: preference.id,
                      targetType: item.targetType,
                      targetKey: item.targetKey,
                      level: item.level,
                      createdByCommandId: command.commandId,
                    },
                  });
                }
              }
              break;
            case "SET_LEVEL": {
              const active = await findActiveItem(
                tx,
                preference.id,
                command.target,
              );
              if (!active) {
                throw new Error("只能修改当前存在的研究关注级别");
              }
              await tx.researchPreferenceItem.update({
                where: { id: active.id },
                data: {
                  level: command.level,
                  createdByCommandId: command.commandId,
                },
              });
              break;
            }
            case "REMOVE":
              await tx.researchPreferenceItem.updateMany({
                where: {
                  preferenceId: preference.id,
                  targetType: command.target.targetType,
                  targetKey: command.target.targetKey,
                  removedAt: null,
                },
                data: { removedAt: now },
              });
              break;
            case "RESTORE": {
              const active = await findActiveItem(
                tx,
                preference.id,
                command.target,
              );
              if (active) break;
              const removed = await tx.researchPreferenceItem.findFirst({
                where: {
                  preferenceId: preference.id,
                  targetType: command.target.targetType,
                  targetKey: command.target.targetKey,
                  removedAt: { not: null },
                },
                orderBy: { removedAt: "desc" },
              });
              if (removed) {
                await tx.researchPreferenceItem.update({
                  where: { id: removed.id },
                  data: {
                    removedAt: null,
                    createdByCommandId: command.commandId,
                  },
                });
              }
              break;
            }
            case "SET_ENABLED":
              await tx.researchPreference.update({
                where: { id: preference.id },
                data: { enabled: command.enabled },
              });
              break;
            case "SET_CHANNELS":
              await tx.researchPreference.update({
                where: { id: preference.id },
                data: command.channels,
              });
              break;
            case "CLEAR":
              // 清除是不可恢复的隐私动作；不能留下可由 RESTORE 找回的软删除关注。
              await tx.researchPreferenceItem.deleteMany({
                where: { preferenceId: preference.id },
              });
              await tx.researchPreference.update({
                where: { id: preference.id },
                data: { enabled: false },
              });
              break;
          }

          const updated = await tx.researchPreference.update({
            where: { id: preference.id },
            data: { lastCommandId: command.commandId },
            include: {
              items: {
                where: { removedAt: null },
                orderBy: [{ targetType: "asc" }, { targetKey: "asc" }],
              },
            },
          });
          await tx.researchPreferenceCommand.create({
            data: {
              id: randomUUID(),
              commandId: command.commandId,
              userId,
              commandType: command.type,
              payloadJson: command as unknown as Prisma.InputJsonValue,
            },
          });
          return toState(updated, userId);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async createOrGetSnapshot(
    userId: string,
    input: ResearchPreferenceSnapshotInput,
    contentHash: string,
    frozenAt: Date,
  ): Promise<ResearchPreferenceSnapshot> {
    const existing = await this.prisma.researchPreferenceSnapshot.findFirst({
      where: { userId, contentHash, personalDataDeletedAt: null },
      include: { items: { orderBy: { ordinal: "asc" } } },
    });
    if (existing) return toSnapshot(existing);

    try {
      const created = await this.prisma.researchPreferenceSnapshot.create({
        data: {
          id: randomUUID(),
          userId,
          contractVersion: input.contractVersion,
          enabled: input.enabled,
          urgentAlertsEnabled: input.urgentAlertsEnabled,
          briefingsEnabled: input.briefingsEnabled,
          externalCopiesEnabled: input.externalCopiesEnabled,
          normalizedItemsJson: input.items as unknown as Prisma.InputJsonValue,
          contentHash,
          frozenAt,
          items: {
            create: input.items.map((item, ordinal) => ({
              ordinal,
              targetType: item.targetType,
              targetKey: item.targetKey,
              level: item.level,
            })),
          },
        },
        include: { items: { orderBy: { ordinal: "asc" } } },
      });
      return toSnapshot(created);
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const raced = await this.prisma.researchPreferenceSnapshot.findFirst({
        where: { userId, contentHash, personalDataDeletedAt: null },
        include: { items: { orderBy: { ordinal: "asc" } } },
      });
      if (!raced) throw error;
      return toSnapshot(raced);
    }
  }

  async getSnapshotForUser(
    userId: string,
    snapshotId: string,
  ): Promise<ResearchPreferenceSnapshot | null> {
    const snapshot = await this.prisma.researchPreferenceSnapshot.findFirst({
      where: { id: snapshotId, userId, personalDataDeletedAt: null },
      include: { items: { orderBy: { ordinal: "asc" } } },
    });
    return snapshot ? toSnapshot(snapshot) : null;
  }

  async deletePersonalData(userId: string, deletedAt: Date): Promise<void> {
    await this.withSerializableRetry(async () =>
      this.prisma.$transaction(
        async (tx) => {
          // 相关性评估会保存命中的关注和冻结输入；保留历史评估行，但先清除可识别的偏好输入。
          await tx.researchEventRelevanceAssessment.updateMany({
            where: { userId, personalDataDeletedAt: null },
            data: {
              userId: null,
              matchedPreferencesJson: Prisma.JsonNull,
              dimensionJson: Prisma.JsonNull,
              inputSnapshotJson: Prisma.JsonNull,
              personalDataDeletedAt: deletedAt,
            },
          });

          const snapshots = await tx.researchPreferenceSnapshot.findMany({
            where: { userId, personalDataDeletedAt: null },
            select: { id: true },
          });
          for (const snapshot of snapshots) {
            await tx.researchPreferenceSnapshot.update({
              where: { id: snapshot.id },
              data: {
                userId: null,
                normalizedItemsJson: Prisma.JsonNull,
                personalDataDeletedAt: deletedAt,
              },
            });
            await tx.researchPreferenceSnapshotItem.deleteMany({
              where: { snapshotId: snapshot.id },
            });
          }

          const preference = await tx.researchPreference.findUnique({
            where: { userId },
            select: { id: true },
          });
          if (preference) {
            await tx.researchPreferenceItem.deleteMany({
              where: { preferenceId: preference.id },
            });
            await tx.researchPreference.delete({
              where: { id: preference.id },
            });
          }
          await tx.researchPreferenceCommand.deleteMany({ where: { userId } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  private async withSerializableRetry<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (
          (!isSerializationError(error) && !isUniqueConstraintError(error)) ||
          attempt === 2
        ) {
          throw error;
        }
      }
    }
    throw new Error("研究偏好写入重试耗尽");
  }
}

async function upsertActiveItem(
  tx: TransactionClient,
  preferenceId: string,
  item: ResearchPreferenceItem,
  commandId: string,
  now: Date,
) {
  const active = await findActiveItem(tx, preferenceId, item);
  if (active) {
    return tx.researchPreferenceItem.update({
      where: { id: active.id },
      data: { level: item.level, createdByCommandId: commandId },
    });
  }
  return tx.researchPreferenceItem.create({
    data: {
      id: randomUUID(),
      preferenceId,
      targetType: item.targetType,
      targetKey: item.targetKey,
      level: item.level,
      createdByCommandId: commandId,
      createdAt: now,
    },
  });
}

function findActiveItem(
  tx: TransactionClient,
  preferenceId: string,
  target: { targetType: string; targetKey: string },
) {
  return tx.researchPreferenceItem.findFirst({
    where: {
      preferenceId,
      targetType: target.targetType,
      targetKey: target.targetKey,
      removedAt: null,
    },
  });
}

function toState(
  preference: {
    id: string;
    userId: string;
    enabled: boolean;
    urgentAlertsEnabled: boolean;
    briefingsEnabled: boolean;
    externalCopiesEnabled: boolean;
    lastCommandId: string | null;
    items?: Array<{ targetType: string; targetKey: string; level: string }>;
  } | null,
  userId: string,
): ResearchPreferenceState {
  const items =
    preference?.items?.map((item) =>
      normalizeItem({
        targetType: researchPreferenceTargetTypeSchema.parse(item.targetType),
        targetKey: item.targetKey,
        level: researchPreferenceLevelSchema.parse(item.level),
      }),
    ) ?? [];
  return {
    userId,
    enabled: preference?.enabled ?? true,
    urgentAlertsEnabled: preference?.urgentAlertsEnabled ?? true,
    briefingsEnabled: preference?.briefingsEnabled ?? true,
    externalCopiesEnabled: preference?.externalCopiesEnabled ?? true,
    items: sortItems(items),
    lastCommandId: preference?.lastCommandId ?? null,
  };
}

function toSnapshot(snapshot: {
  id: string;
  userId: string | null;
  contractVersion: string;
  enabled: boolean;
  urgentAlertsEnabled: boolean;
  briefingsEnabled: boolean;
  externalCopiesEnabled: boolean;
  contentHash: string;
  frozenAt: Date;
  personalDataDeletedAt: Date | null;
  items: Array<{ targetType: string; targetKey: string; level: string }>;
}): ResearchPreferenceSnapshot {
  if (!snapshot.userId)
    throw new Error("无法将已删除个人数据的偏好快照作为用户输入返回");
  return {
    id: snapshot.id,
    userId: snapshot.userId,
    contractVersion: snapshot.contractVersion,
    enabled: snapshot.enabled,
    urgentAlertsEnabled: snapshot.urgentAlertsEnabled,
    briefingsEnabled: snapshot.briefingsEnabled,
    externalCopiesEnabled: snapshot.externalCopiesEnabled,
    items: sortItems(
      snapshot.items.map((item) =>
        normalizeItem({
          targetType: researchPreferenceTargetTypeSchema.parse(item.targetType),
          targetKey: item.targetKey,
          level: researchPreferenceLevelSchema.parse(item.level),
        }),
      ),
    ),
    contentHash: snapshot.contentHash,
    frozenAt: snapshot.frozenAt,
    personalDataDeletedAt: snapshot.personalDataDeletedAt,
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

function isSerializationError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

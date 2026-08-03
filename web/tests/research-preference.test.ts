import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  type ResearchPreferenceSnapshot,
  type ResearchPreferenceState,
} from "~/contracts/research-preference";
import { ResearchPreferenceService } from "~/server/application/research-preference/research-preference-service";
import {
  canonicalJson,
  hashPreferenceContent,
  resolvePreferenceMatches,
  sortItems,
  type ResearchPreferenceCommand,
  type ResearchPreferenceSnapshotInput,
} from "~/server/domain/research-preference/research-preference";
import type { ResearchPreferenceRepository } from "~/server/domain/research-preference/repository";

function emptyState(userId: string): ResearchPreferenceState {
  return {
    userId,
    enabled: true,
    urgentAlertsEnabled: true,
    briefingsEnabled: true,
    externalCopiesEnabled: true,
    items: [],
    lastCommandId: null,
  };
}

class MemoryResearchPreferenceRepository implements ResearchPreferenceRepository {
  private readonly states = new Map<string, ResearchPreferenceState>();
  private readonly snapshots = new Map<string, ResearchPreferenceSnapshot>();
  private readonly removedLevels = new Map<string, "REGULAR" | "FOCUS">();
  private readonly commands = new Map<string, string>();
  private readonly clearedTargets = new Set<string>();

  async getCurrent(userId: string) {
    return structuredClone(this.states.get(userId) ?? emptyState(userId));
  }

  async listImportCandidates() {
    return [];
  }

  async applyCommand(userId: string, command: ResearchPreferenceCommand) {
    const current = await this.getCurrent(userId);
    if (current.lastCommandId === command.commandId) return current;
    const recordedUserId = this.commands.get(command.commandId);
    if (recordedUserId) {
      if (recordedUserId !== userId) throw new Error("command belongs to another user");
      return current;
    }
    const next = structuredClone(current);
    next.lastCommandId = command.commandId;
    if (command.type === "ADD") {
      const existing = next.items.find(
        (item) => item.targetType === command.item.targetType && item.targetKey === command.item.targetKey,
      );
      if (existing) existing.level = command.item.level;
      else next.items.push(command.item);
    }
    if (command.type === "IMPORT") {
      for (const target of command.items) {
        if (!next.items.some((item) => item.targetType === target.targetType && item.targetKey === target.targetKey)) {
          next.items.push({ ...target, level: "REGULAR" });
        }
      }
    }
    if (command.type === "SET_LEVEL") {
      const item = next.items.find(
        (candidate) => candidate.targetType === command.target.targetType && candidate.targetKey === command.target.targetKey,
      );
      if (item) item.level = command.level;
    }
    if (command.type === "REMOVE") {
      const removed = next.items.find(
        (item) => item.targetType === command.target.targetType && item.targetKey === command.target.targetKey,
      );
      if (removed) {
        this.removedLevels.set(
          `${userId}:${command.target.targetType}:${command.target.targetKey}`,
          removed.level,
        );
      }
      next.items = next.items.filter(
        (item) => item.targetType !== command.target.targetType || item.targetKey !== command.target.targetKey,
      );
    }
    if (command.type === "RESTORE") {
      // The in-memory adapter models the same observable restore contract as PostgreSQL.
      const targetKey = `${userId}:${command.target.targetType}:${command.target.targetKey}`;
      if (
        !this.clearedTargets.has(targetKey) &&
        !next.items.some((item) => item.targetType === command.target.targetType && item.targetKey === command.target.targetKey)
      ) {
        next.items.push({
          ...command.target,
          level:
            this.removedLevels.get(
              `${userId}:${command.target.targetType}:${command.target.targetKey}`,
            ) ?? "REGULAR",
        });
      }
    }
    if (command.type === "SET_ENABLED") next.enabled = command.enabled;
    if (command.type === "SET_CHANNELS") Object.assign(next, command.channels);
    if (command.type === "CLEAR") {
      for (const item of next.items) {
        this.clearedTargets.add(
          `${userId}:${item.targetType}:${item.targetKey}`,
        );
      }
      for (const key of this.removedLevels.keys()) {
        if (key.startsWith(`${userId}:`)) this.clearedTargets.add(key);
      }
      next.items = [];
      next.enabled = false;
      for (const key of this.removedLevels.keys()) {
        if (key.startsWith(`${userId}:`)) this.removedLevels.delete(key);
      }
    }
    next.items = sortItems(next.items);
    this.states.set(userId, next);
    this.commands.set(command.commandId, userId);
    return structuredClone(next);
  }

  async createOrGetSnapshot(userId: string, input: ResearchPreferenceSnapshotInput, contentHash: string, frozenAt: Date) {
    const key = `${userId}:${contentHash}`;
    const existing = this.snapshots.get(key);
    if (existing) return structuredClone(existing);
    const snapshot: ResearchPreferenceSnapshot = {
      id: randomUUID(),
      userId,
      contractVersion: input.contractVersion,
      enabled: input.enabled,
      urgentAlertsEnabled: input.urgentAlertsEnabled,
      briefingsEnabled: input.briefingsEnabled,
      externalCopiesEnabled: input.externalCopiesEnabled,
      items: structuredClone(input.items),
      contentHash,
      frozenAt,
      personalDataDeletedAt: null,
    };
    this.snapshots.set(key, snapshot);
    return structuredClone(snapshot);
  }

  async getSnapshotForUser(userId: string, snapshotId: string) {
    return [...this.snapshots.values()].find(
      (snapshot) => snapshot.id === snapshotId && snapshot.userId === userId && !snapshot.personalDataDeletedAt,
    ) ?? null;
  }

  async deletePersonalData(userId: string, deletedAt: Date) {
    for (const [key, snapshot] of this.snapshots) {
      if (snapshot.userId !== userId) continue;
      snapshot.userId = "";
      snapshot.items = [];
      snapshot.personalDataDeletedAt = deletedAt;
      this.snapshots.set(key, snapshot);
    }
    this.states.delete(userId);
    for (const [commandId, commandUserId] of this.commands) {
      if (commandUserId === userId) this.commands.delete(commandId);
    }
    for (const key of this.removedLevels.keys()) {
      if (key.startsWith(`${userId}:`)) this.removedLevels.delete(key);
    }
    for (const key of this.clearedTargets) {
      if (key.startsWith(`${userId}:`)) this.clearedTargets.delete(key);
    }
  }
}

describe("显式研究关注与冻结偏好", () => {
  it("以稳定顺序和规范 JSON 计算相同内容哈希", () => {
    const items = [
      { targetType: "THEME" as const, targetKey: "风电", level: "REGULAR" as const },
      { targetType: "COMPANY" as const, targetKey: "000001.SZ", level: "FOCUS" as const },
    ];
    expect(sortItems([...items].reverse())).toEqual(sortItems(items));
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(hashPreferenceContent({
      contractVersion: "1.0",
      enabled: true,
      urgentAlertsEnabled: true,
      briefingsEnabled: true,
      externalCopiesEnabled: true,
      items,
    })).toBe(hashPreferenceContent({
      contractVersion: "1.0",
      enabled: true,
      urgentAlertsEnabled: true,
      briefingsEnabled: true,
      externalCopiesEnabled: true,
      items: [...items].reverse(),
    }));
  });

  it("新增与导入只创建显式关注，导入项默认为常规关注", async () => {
    const repository = new MemoryResearchPreferenceRepository();
    const service = new ResearchPreferenceService(repository);
    await service.add("user-1", {
      commandId: "add-1",
      target: { targetType: "COMPANY", targetKey: "000001.SZ" },
      level: "FOCUS",
    });
    const state = await service.import("user-1", {
      commandId: "import-1",
      targets: [
        { targetType: "INDUSTRY", targetKey: "电力设备" },
        { targetType: "COMPANY", targetKey: "000002.SZ" },
      ],
    });
    expect(state.items).toEqual([
      { targetType: "COMPANY", targetKey: "000001.SZ", level: "FOCUS" },
      { targetType: "COMPANY", targetKey: "000002.SZ", level: "REGULAR" },
      { targetType: "INDUSTRY", targetKey: "电力设备", level: "REGULAR" },
    ]);
  });

  it("冻结快照按内容幂等，偏好变更生成新快照", async () => {
    let now = new Date("2026-08-02T08:00:00.000Z");
    const repository = new MemoryResearchPreferenceRepository();
    const service = new ResearchPreferenceService(repository, { clock: () => now });
    await service.add("user-1", {
      commandId: "add-1",
      target: { targetType: "THEME", targetKey: "储能" },
    });
    const first = await service.freeze("user-1");
    now = new Date("2026-08-02T08:01:00.000Z");
    const replay = await service.freeze("user-1");
    expect(replay.id).toBe(first.id);
    await service.setLevel("user-1", {
      commandId: "focus-1",
      target: { targetType: "THEME", targetKey: "储能" },
      level: "FOCUS",
    });
    const second = await service.freeze("user-1");
    expect(second.id).not.toBe(first.id);
    expect(second.items[0]?.level).toBe("FOCUS");
  });

  it("解释命中关注并阻止弱层级传播继承重点级别", () => {
    const items = [
      { targetType: "INDUSTRY" as const, targetKey: "电力设备", level: "FOCUS" as const },
      { targetType: "COMPANY" as const, targetKey: "000001.SZ", level: "REGULAR" as const },
    ];
    const matches = resolvePreferenceMatches(items, [
      { targetType: "INDUSTRY", targetKey: "电力设备", relation: "DIRECT" },
      { targetType: "COMPANY", targetKey: "000001.SZ", relation: "WEAK", path: ["电力设备", "000001.SZ"] },
    ]);
    expect(matches).toEqual([
      { targetType: "COMPANY", targetKey: "000001.SZ", level: "REGULAR", relation: "WEAK", path: ["电力设备", "000001.SZ"] },
      { targetType: "INDUSTRY", targetKey: "电力设备", level: "FOCUS", relation: "DIRECT" },
    ]);
  });

  it("清除只影响未来冻结，旧快照仍可验证但隐私删除后不可访问", async () => {
    const repository = new MemoryResearchPreferenceRepository();
    const service = new ResearchPreferenceService(repository);
    await service.add("user-1", {
      commandId: "add-1",
      target: { targetType: "COMPANY", targetKey: "000001.SZ" },
    });
    const oldSnapshot = await service.freeze("user-1");
    const cleared = await service.clear("user-1", "clear-1");
    expect(cleared.enabled).toBe(false);
    expect(cleared.items).toEqual([]);
    const emptySnapshot = await service.freeze("user-1");
    expect(emptySnapshot.items).toEqual([]);
    expect((await repository.getSnapshotForUser("user-1", oldSnapshot.id))?.items).toHaveLength(1);
    const attemptedRestore = await service.restore("user-1", {
      commandId: "restore-after-clear-1",
      target: { targetType: "COMPANY", targetKey: "000001.SZ" },
    });
    expect(attemptedRestore.items).toEqual([]);
    await service.deletePersonalData("user-1");
    expect(await repository.getSnapshotForUser("user-1", oldSnapshot.id)).toBeNull();
  });

  it("移除可通过显式恢复命令撤销", async () => {
    const repository = new MemoryResearchPreferenceRepository();
    const service = new ResearchPreferenceService(repository);
    await service.add("user-1", {
      commandId: "add-1",
      target: { targetType: "COMPANY", targetKey: "000001.SZ" },
      level: "FOCUS",
    });
    await service.remove("user-1", {
      commandId: "remove-1",
      target: { targetType: "COMPANY", targetKey: "000001.SZ" },
    });
    const restored = await service.restore("user-1", {
      commandId: "restore-1",
      target: { targetType: "COMPANY", targetKey: "000001.SZ" },
    });
    expect(restored.items).toEqual([
      { targetType: "COMPANY", targetKey: "000001.SZ", level: "FOCUS" },
    ]);
  });

  it("旧命令在后续变更后重放也不会重新修改当前态", async () => {
    const repository = new MemoryResearchPreferenceRepository();
    const service = new ResearchPreferenceService(repository);
    await service.add("user-1", {
      commandId: "add-1",
      target: { targetType: "COMPANY", targetKey: "000001.SZ" },
    });
    await service.remove("user-1", {
      commandId: "remove-1",
      target: { targetType: "COMPANY", targetKey: "000001.SZ" },
    });
    await service.restore("user-1", {
      commandId: "restore-1",
      target: { targetType: "COMPANY", targetKey: "000001.SZ" },
    });
    await service.remove("user-1", {
      commandId: "remove-1",
      target: { targetType: "COMPANY", targetKey: "000001.SZ" },
    });
    expect((await service.getCurrent("user-1")).items).toHaveLength(1);
  });
});

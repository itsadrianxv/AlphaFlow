import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { ResearchPreferenceService } from "~/server/application/research-preference/research-preference-service";
import { PrismaResearchPreferenceRepository } from "~/server/infrastructure/research-preference/prisma-research-preference-repository";

const contractDatabaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = contractDatabaseUrl ? describe : describe.skip;

function key(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describePostgres("研究偏好 application/repository PostgreSQL 契约", () => {
  const db = new PrismaClient({
    datasources: {
      db: {
        url:
          contractDatabaseUrl ??
          "postgresql://unused:unused@127.0.0.1:1/unused",
      },
    },
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("并发命令都提交且重复最后命令不产生第二条关注", async () => {
    const userId = key("preference-user");
    await db.user.create({ data: { id: userId } });
    const repository = new PrismaResearchPreferenceRepository(db);
    const service = new ResearchPreferenceService(repository);

    try {
      await Promise.all([
        service.add(userId, {
          commandId: key("add-company"),
          target: { targetType: "COMPANY", targetKey: "000001.SZ" },
        }),
        service.add(userId, {
          commandId: key("add-industry"),
          target: { targetType: "INDUSTRY", targetKey: "电力设备" },
        }),
      ]);
      const state = await service.getCurrent(userId);
      expect(state.items).toHaveLength(2);

      const commandId = key("replay");
      await service.setLevel(userId, {
        commandId,
        target: { targetType: "COMPANY", targetKey: "000001.SZ" },
        level: "FOCUS",
      });
      await service.setLevel(userId, {
        commandId,
        target: { targetType: "COMPANY", targetKey: "000001.SZ" },
        level: "REGULAR",
      });
      expect(
        (await service.getCurrent(userId)).items.find(
          (item) => item.targetKey === "000001.SZ",
        )?.level,
      ).toBe("FOCUS");
    } finally {
      await service.deletePersonalData(userId);
      await db.user.delete({ where: { id: userId } });
    }
  });

  it("暂停可恢复、移除可恢复、清除不恢复关注且快照可幂等冻结", async () => {
    const userId = key("preference-user");
    await db.user.create({ data: { id: userId } });
    const repository = new PrismaResearchPreferenceRepository(db);
    const service = new ResearchPreferenceService(repository, {
      clock: () => new Date("2026-08-02T08:00:00.000Z"),
    });

    try {
      await service.add(userId, {
        commandId: key("add"),
        target: { targetType: "THEME", targetKey: "储能" },
        level: "FOCUS",
      });
      await service.setEnabled(userId, { commandId: key("pause"), enabled: false });
      expect((await service.getCurrent(userId)).enabled).toBe(false);
      await service.setEnabled(userId, { commandId: key("resume"), enabled: true });
      expect((await service.getCurrent(userId)).enabled).toBe(true);

      await service.remove(userId, {
        commandId: key("remove"),
        target: { targetType: "THEME", targetKey: "储能" },
      });
      await service.restore(userId, {
        commandId: key("restore"),
        target: { targetType: "THEME", targetKey: "储能" },
      });
      expect((await service.getCurrent(userId)).items[0]?.level).toBe("FOCUS");

      const snapshot = await service.freeze(userId);
      expect((await service.freeze(userId)).id).toBe(snapshot.id);
      await service.clear(userId, key("clear"));
      expect((await service.getCurrent(userId)).items).toEqual([]);
      expect((await service.freeze(userId)).items).toEqual([]);
      expect(await repository.getSnapshotForUser(userId, snapshot.id)).toBeNull();
      await service.restore(userId, {
        commandId: key("restore-after-clear"),
        target: { targetType: "THEME", targetKey: "储能" },
      });
      expect((await service.getCurrent(userId)).items).toEqual([]);
    } finally {
      await service.deletePersonalData(userId);
      await db.user.delete({ where: { id: userId } });
    }
  });

  it("个人数据删除优先于快照读取并保留删除标记", async () => {
    const userId = key("preference-user");
    await db.user.create({ data: { id: userId } });
    const repository = new PrismaResearchPreferenceRepository(db);
    const service = new ResearchPreferenceService(repository, {
      clock: () => new Date("2026-08-02T08:00:00.000Z"),
    });

    try {
      await service.add(userId, {
        commandId: key("add"),
        target: { targetType: "COMPANY", targetKey: "000001.SZ" },
      });
      const snapshot = await service.freeze(userId);
      await service.deletePersonalData(userId);
      expect(await repository.getSnapshotForUser(userId, snapshot.id)).toBeNull();
      const rows = await db.$queryRaw<Array<{ userId: string | null; personalDataDeletedAt: Date | null }>>`
        SELECT "userId", "personalDataDeletedAt"
        FROM "ResearchPreferenceSnapshot"
        WHERE "id" = ${snapshot.id}
      `;
      expect(rows[0]?.userId).toBeNull();
      expect(rows[0]?.personalDataDeletedAt).toBeInstanceOf(Date);
    } finally {
      await db.$executeRaw`DELETE FROM "ResearchPreferenceSnapshotItem" WHERE "snapshotId" IN (SELECT "id" FROM "ResearchPreferenceSnapshot" WHERE "userId" IS NULL AND "personalDataDeletedAt" IS NOT NULL)`;
      await db.$executeRaw`DELETE FROM "ResearchPreferenceSnapshot" WHERE "userId" IS NULL AND "personalDataDeletedAt" IS NOT NULL`;
      await db.user.delete({ where: { id: userId } }).catch(() => undefined);
    }
  });
});

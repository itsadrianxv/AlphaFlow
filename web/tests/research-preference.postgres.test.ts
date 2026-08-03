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

describePostgres("研究偏好 PostgreSQL repository 契约", () => {
  const db = new PrismaClient({
    datasources: {
      db: {
        url: contractDatabaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused",
      },
    },
  });
  const service = new ResearchPreferenceService(
    new PrismaResearchPreferenceRepository(db),
    { clock: () => new Date("2026-08-03T08:00:00.000Z") },
  );

  afterAll(async () => {
    await db.$disconnect();
  });

  it("同一 command 并发重放只落一份关注，跨用户 commandId 冲突被拒绝", async () => {
    const userId = key("user");
    const otherUserId = key("user");
    await db.user.createMany({ data: [{ id: userId }, { id: otherUserId }] });
    const commandId = key("command");

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        service.add(userId, {
          commandId,
          target: { targetType: "COMPANY", targetKey: "000001.SZ" },
          level: "FOCUS",
        }),
      ),
    );
    expect(results.every((state) => state.items.length === 1)).toBe(true);
    const commandRows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "ResearchPreferenceCommand" WHERE "commandId" = $1`,
      commandId,
    );
    expect(Number(commandRows[0]?.count)).toBe(1);

    await expect(
      service.add(otherUserId, {
        commandId,
        target: { targetType: "COMPANY", targetKey: "000002.SZ" },
      }),
    ).rejects.toThrow("已属于其他用户");
  });

  it("REMOVE 优先于旧命令重放，RESTORE 恢复原关注级别，CLEAR 后冻结为空", async () => {
    const userId = key("user");
    await db.user.create({ data: { id: userId } });
    await service.add(userId, {
      commandId: key("add"),
      target: { targetType: "THEME", targetKey: "储能" },
      level: "FOCUS",
    });
    await service.remove(userId, {
      commandId: "remove-once",
      target: { targetType: "THEME", targetKey: "储能" },
    });
    await service.remove(userId, {
      commandId: "remove-once",
      target: { targetType: "THEME", targetKey: "储能" },
    });
    expect((await service.getCurrent(userId)).items).toEqual([]);

    await service.restore(userId, {
      commandId: key("restore"),
      target: { targetType: "THEME", targetKey: "储能" },
    });
    expect((await service.getCurrent(userId)).items).toEqual([
      { targetType: "THEME", targetKey: "储能", level: "FOCUS" },
    ]);

    const cleared = await service.clear(userId, key("clear"));
    expect(cleared.enabled).toBe(false);
    expect(cleared.items).toEqual([]);
    expect((await service.freeze(userId)).items).toEqual([]);
  });

  it("隐私删除后旧快照不可作为用户输入返回，但历史命令已经清除", async () => {
    const userId = key("user");
    await db.user.create({ data: { id: userId } });
    await service.add(userId, {
      commandId: key("add"),
      target: { targetType: "COMPANY", targetKey: "000001.SZ" },
    });
    const snapshot = await service.freeze(userId);
    expect(await service.explain({ userId, snapshotId: snapshot.id, candidates: [] })).toMatchObject({
      snapshotId: snapshot.id,
    });

    await service.deletePersonalData(userId);
    await expect(
      service.explain({ userId, snapshotId: snapshot.id, candidates: [] }),
    ).rejects.toThrow("不存在或不可访问");
    const commandRows = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "ResearchPreferenceCommand" WHERE "userId" = $1`,
      userId,
    );
    expect(Number(commandRows[0]?.count)).toBe(0);
  });
});

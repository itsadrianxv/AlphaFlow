import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { PostgresResearchScheduler } from "~/server/application/scheduling/postgres-research-scheduler";
import { PostgresSchedulingControl } from "~/server/application/scheduling/postgres-scheduling-control";

const databaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

function key(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describePostgres("研究调度控制 PostgreSQL 契约", () => {
  const db = new PrismaClient({
    datasources: {
      db: {
        url:
          databaseUrl ??
          "postgresql://unused:unused@127.0.0.1:1/unused",
      },
    },
  });
  const poolIds: string[] = [];

  afterAll(async () => {
    await db.$disconnect();
  });

  afterEach(async () => {
    for (const poolId of poolIds.splice(0)) {
      await db.$executeRawUnsafe(
        `DELETE FROM "ResearchResourcePermit" WHERE "resourcePoolId" = $1`,
        poolId,
      );
      await db.$executeRawUnsafe(
        `DELETE FROM "ResearchCircuitBreaker" WHERE "resourcePoolId" = $1`,
        poolId,
      );
      await db.$executeRawUnsafe(
        `DELETE FROM "ResearchTask" WHERE "resourcePoolId" = $1`,
        poolId,
      );
      await db.$executeRawUnsafe(
        `DELETE FROM "ResearchResourcePool" WHERE "id" = $1`,
        poolId,
      );
    }
  });

  async function createPool(currentConcurrency = 2, healthySince?: Date) {
    const poolId = key("pool");
    poolIds.push(poolId);
    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchResourcePool" (
         "id", "poolKey", "resourceKind", "hardConcurrency", "currentConcurrency", "healthySince"
       ) VALUES ($1, $2, 'PROVIDER', $3, $4, $5)`,
      poolId,
      key("pool-key"),
      Math.max(4, currentConcurrency),
      currentConcurrency,
      healthySince ?? null,
    );
    return poolId;
  }

  async function enqueue(
    scheduler: PostgresResearchScheduler,
    poolId: string,
    idempotencyKey: string,
  ) {
    const result = await scheduler.enqueue({
      taskType: "provider.fetch",
      idempotencyKey,
      inputHash: `sha256:${idempotencyKey}`,
      inputContractVersion: "1.0",
      input: {},
      schedulingTier: "INTERACTIVE",
      resourcePoolId: poolId,
      fairnessKey: idempotencyKey,
    });
    if (!result.task) throw new Error("测试任务未被接纳");
    return result.task;
  }

  it("配置阻断保持阻断，显式允许后才恢复", async () => {
    const poolId = await createPool(1);
    const control = new PostgresSchedulingControl(db);

    const blocked = await control.blockConfiguration(
      poolId,
      "credential_missing",
    );
    expect(blocked.state).toBe("CONFIG_BLOCKED");
    const unchanged = await control.recordOutcome(poolId, {
      kind: "RATE_LIMITED",
    });
    expect(unchanged.state).toBe("CONFIG_BLOCKED");
    expect((await control.allowConfiguration(poolId)).state).toBe("CLOSED");
  });

  it("重启资源池时保守恢复到单并发", async () => {
    const poolId = await createPool(3, new Date("2026-08-03T00:00:00Z"));
    const control = new PostgresSchedulingControl(db);

    const restarted = await control.restartPool(poolId);

    expect(restarted.currentConcurrency).toBe(1);
    expect(restarted.successStreak).toBe(0);
    expect(restarted.healthySince).toBeNull();
  });

  it("限流和超时只校准所属资源池", async () => {
    const firstPoolId = await createPool(4);
    const secondPoolId = await createPool(2);
    const control = new PostgresSchedulingControl(db);

    expect(
      await control.recordAdaptiveOutcome(firstPoolId, {
        kind: "RATE_LIMITED",
      }),
    ).toMatchObject({ previous: 4, current: 2, reason: "RATE_LIMITED_HALVED" });
    expect(
      await control.recordAdaptiveOutcome(firstPoolId, { kind: "TIMEOUT" }),
    ).toMatchObject({ previous: 2, current: 1, reason: "TIMEOUT_DECREASED" });
    expect((await control.getPool(secondPoolId))?.currentConcurrency).toBe(2);
  });

  it("健康成功达到持续时间与次数后增加并发", async () => {
    let now = new Date("2026-08-03T00:00:00.000Z");
    const poolId = await createPool(1, now);
    const control = new PostgresSchedulingControl(db, { now: () => now });

    for (let index = 0; index < 20; index += 1) {
      now = new Date(now.getTime() + 15_000);
      await control.recordAdaptiveOutcome(poolId, {
        kind: "SUCCESS",
        latencyMs: 10,
      });
    }

    expect((await control.getPool(poolId))?.currentConcurrency).toBe(2);
  });

  it("熔断冷却后只允许一个半开探测任务", async () => {
    let now = new Date("2026-08-03T02:00:00.000Z");
    const poolId = await createPool(2);
    const scheduler = new PostgresResearchScheduler(db, {
      now: () => now,
      leaseMs: 10_000,
      permitLeaseMs: 10_000,
    });
    const control = new PostgresSchedulingControl(db, { now: () => now });
    await enqueue(scheduler, poolId, key("probe-a"));
    await enqueue(scheduler, poolId, key("probe-b"));

    const opened = await control.recordOutcome(poolId, {
      kind: "RATE_LIMITED",
      retryAfterMs: 500,
      at: now,
    });
    expect(opened.state).toBe("OPEN");
    expect(await scheduler.claim(poolId, "worker-before-retry")).toBeNull();

    now = new Date(opened.retryAfter!.getTime() + 1);
    const probe = await scheduler.claim(poolId, "worker-probe");
    expect(probe).not.toBeNull();
    expect((await control.getCircuit(poolId))?.state).toBe("HALF_OPEN");
    expect(await scheduler.claim(poolId, "worker-second-probe")).toBeNull();

    await scheduler.settle(probe!.task.id, probe!.task.fencingToken, {
      disposition: "COMPLETED",
      resultContractVersion: "1.0",
      result: { ok: true },
    });
    expect((await control.getCircuit(poolId))?.state).toBe("CLOSED");
  });

  it("普通成功结果不会绕过已经打开的熔断冷却", async () => {
    const poolId = await createPool(1);
    const scheduler = new PostgresResearchScheduler(db);
    const control = new PostgresSchedulingControl(db);
    const task = await enqueue(scheduler, poolId, key("circuit-success"));
    const claimed = await scheduler.claim(poolId, "worker-a");
    await control.recordOutcome(poolId, { kind: "RATE_LIMITED" });
    const opened = await control.getCircuit(poolId);

    await control.recordOutcome(poolId, { kind: "SUCCESS" });
    expect((await control.getCircuit(poolId))?.retryAfter).toEqual(
      opened?.retryAfter,
    );
    await scheduler.settle(task.id, claimed!.task.fencingToken, {
      disposition: "COMPLETED",
      resultContractVersion: "1.0",
      result: {},
    });
    expect((await control.getCircuit(poolId))?.state).toBe("OPEN");
  });
});

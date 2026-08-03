import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  LeaseLostError,
  PostgresResearchScheduler,
} from "~/server/application/scheduling/postgres-research-scheduler";

const databaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

function key(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

describePostgres("研究调度 PostgreSQL 契约", () => {
  const db = new PrismaClient({
    datasources: { db: { url: databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused" } },
  });
  const poolIds: string[] = [];

  afterAll(async () => {
    await db.$disconnect();
  });

  afterEach(async () => {
    for (const poolId of poolIds.splice(0)) {
      await db.$executeRawUnsafe(`DELETE FROM "ResearchResourcePermit" WHERE "resourcePoolId" = $1`, poolId);
      await db.$executeRawUnsafe(`DELETE FROM "ResearchTask" WHERE "resourcePoolId" = $1`, poolId);
      await db.$executeRawUnsafe(`DELETE FROM "ResearchCircuitBreaker" WHERE "resourcePoolId" = $1`, poolId);
      await db.$executeRawUnsafe(`DELETE FROM "ResearchResourcePool" WHERE "id" = $1`, poolId);
    }
  });

  async function scheduler(currentConcurrency = 2) {
    const poolId = key("pool");
    poolIds.push(poolId);
    await db.$executeRawUnsafe(
      `INSERT INTO "ResearchResourcePool" ("id", "poolKey", "resourceKind", "hardConcurrency", "currentConcurrency")
       VALUES ($1, $2, 'PROVIDER', 4, $3)`,
      poolId,
      key("pool-key"),
      currentConcurrency,
    );
    return {
      poolId,
      value: new PostgresResearchScheduler(db, { leaseMs: 1_000, permitLeaseMs: 500 }),
    };
  }

  async function enqueue(
    value: PostgresResearchScheduler,
    poolId: string,
    idempotencyKey: string,
    tier: "INTERACTIVE" | "TIME_CRITICAL" | "BACKGROUND" = "INTERACTIVE",
  ) {
    const result = await value.enqueue({
      taskType: "provider.fetch",
      idempotencyKey,
      inputHash: `sha256:${idempotencyKey}`,
      inputContractVersion: "1.0",
      input: { idempotencyKey },
      schedulingTier: tier,
      resourcePoolId: poolId,
      fairnessKey: idempotencyKey,
    });
    expect(result.task).not.toBeNull();
    return result.task!;
  }

  it("多 Worker 领取不超过全局许可并保持 fencing 唯一", async () => {
    const { poolId, value } = await scheduler(2);
    await enqueue(value, poolId, key("task"));
    await enqueue(value, poolId, key("task"));
    const claimed = await Promise.all([
      value.claim(poolId, "worker-a"),
      value.claim(poolId, "worker-b"),
    ]);
    expect(claimed.filter(Boolean)).toHaveLength(2);
    expect(new Set(claimed.filter(Boolean).map((item) => item?.task.id)).size).toBe(2);
    const active = await db.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM "ResearchResourcePermit" WHERE "resourcePoolId" = $1 AND "status" = 'ACTIVE'`,
      poolId,
    );
    expect(Number(active[0]?.count ?? 0n)).toBe(2);
  });

  it("旧 fencing 不能结算，租约过期后新 Worker 可接管", async () => {
    const { poolId, value } = await scheduler(1);
    const task = await enqueue(value, poolId, key("lease"));
    const first = await value.claim(poolId, "worker-a");
    expect(first).not.toBeNull();
    await db.$executeRawUnsafe(
      `UPDATE "ResearchTask" SET "leaseExpiresAt" = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE "id" = $1`,
      task.id,
    );
    await expect(value.settle(task.id, first!.task.fencingToken, {
      disposition: "COMPLETED",
      resultContractVersion: "1.0",
      result: { stale: true },
    })).rejects.toBeInstanceOf(LeaseLostError);
    const second = await value.claim(poolId, "worker-b");
    expect(second?.task.fencingToken).toBeGreaterThan(first!.task.fencingToken);
  });

  it("相同幂等键复用任务，跨池许可必须通过目标池子任务", async () => {
    const { poolId, value } = await scheduler(1);
    const first = await enqueue(value, poolId, key("idempotent"));
    const duplicate = await value.enqueue({
      taskType: "provider.fetch",
      idempotencyKey: first.idempotencyKey,
      inputHash: first.inputHash,
      inputContractVersion: first.inputContractVersion,
      input: first.input,
      schedulingTier: first.schedulingTier,
      resourcePoolId: poolId,
      fairnessKey: first.fairnessKey,
    });
    expect(duplicate.decision).toBe("DEDUPLICATED");
    const claim = await value.claim(poolId, "worker-a");
    await expect(value.acquireNestedPermit({
      taskId: first.id,
      resourcePoolId: key("other-pool"),
      holderId: "worker-a",
      fencingToken: claim!.task.fencingToken,
    })).rejects.toThrow(/目标资源池/);
  });

  it("配置阻断保持阻断，显式允许后才恢复", async () => {
    const { poolId, value } = await scheduler(1);
    const blocked = await value.blockConfiguration(poolId, "credential_missing");
    expect(blocked.state).toBe("CONFIG_BLOCKED");
    const unchanged = await value.recordOutcome(poolId, { kind: "RATE_LIMITED" });
    expect(unchanged.state).toBe("CONFIG_BLOCKED");
    const allowed = await value.allowConfiguration(poolId);
    expect(allowed.state).toBe("CLOSED");
  });
});

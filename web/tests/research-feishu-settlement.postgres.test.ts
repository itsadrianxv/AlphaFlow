import { randomUUID } from "node:crypto";

import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { FeishuDueCopyScheduler } from "~/server/application/research-distribution/feishu-due-copy-worker";
import { PostgresExternalCopyAttemptRepository } from "~/server/application/scheduling/postgres-external-copy-attempt-repository";
import { PostgresResearchScheduler } from "~/server/application/scheduling/postgres-research-scheduler";
import { LeaseLostError } from "~/server/domain/scheduling/types";

const databaseUrl = process.env.RESEARCH_POSTGRES_CONTRACT_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

function key(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

describePostgres("飞书外部副本尝试 PostgreSQL 原子结算契约", () => {
  const db = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl ?? "postgresql://unused:unused@127.0.0.1:1/unused",
      },
    },
  });
  const poolIds: string[] = [];
  const userIds: string[] = [];

  afterAll(async () => {
    await db.$disconnect();
  });

  afterEach(async () => {
    for (const poolId of poolIds.splice(0)) {
      await db.researchResourcePermit.deleteMany({ where: { resourcePoolId: poolId } });
      await db.researchCircuitBreaker.deleteMany({ where: { resourcePoolId: poolId } });
      await db.researchTask.deleteMany({ where: { resourcePoolId: poolId } });
      await db.researchResourcePool.deleteMany({ where: { id: poolId } });
    }
    for (const userId of userIds.splice(0)) {
      await db.researchExternalCopy.deleteMany({ where: { entry: { userId } } });
      await db.researchInboxEntry.deleteMany({ where: { userId } });
      await db.user.deleteMany({ where: { id: userId } });
    }
  });

  async function claimedAttempt(now = new Date("2026-08-08T12:00:00.000Z")) {
    const poolId = key("feishu-pool");
    const userId = key("feishu-user");
    poolIds.push(poolId);
    userIds.push(userId);
    await db.researchResourcePool.create({
      data: { id: poolId, poolKey: key("feishu-pool-key"), resourceKind: "FEISHU", hardConcurrency: 1, currentConcurrency: 1 },
    });
    await db.user.create({ data: { id: userId } });
    const entry = await db.researchInboxEntry.create({
      data: { distributionKey: key("distribution"), userId, highestChannel: "URGENT_ALERT", entryKind: "EVENT", title: "研究事件", summary: "摘要", bodyJson: {} },
    });
    const copy = await db.researchExternalCopy.create({
      data: { entryId: entry.id, idempotencyKey: key("copy"), payloadJson: { idempotencyKey: key("payload"), title: "研究事件", reason: "满足门控", status: "已核实", inboxLink: `/research/inbox/${entry.id}` }, retryDeadline: new Date(now.getTime() + 30 * 60_000) },
    });
    const scheduler = new PostgresResearchScheduler(db, { now: () => now, leaseMs: 60_000, permitLeaseMs: 60_000 });
    const taskInput = { contractVersion: "feishu-delivery-task.v1", copyId: copy.id, attemptNo: 1 };
    const admitted = await scheduler.enqueue({ taskType: "research.feishu-delivery.v1", idempotencyKey: key("task"), inputHash: key("hash"), inputContractVersion: taskInput.contractVersion, input: taskInput, schedulingTier: "TIME_CRITICAL", resourcePoolId: poolId, fairnessKey: entry.id, externalCopyId: copy.id, maxAttempts: 1 });
    const claimedTask = await scheduler.claim(poolId, "feishu-worker");
    expect(admitted.task).not.toBeNull();
    expect(claimedTask).not.toBeNull();
    const repository = new PostgresExternalCopyAttemptRepository(db, scheduler);
    const claimedCopy = await repository.claimExternalCopyAttempt({ taskId: claimedTask!.task.id, taskFencingToken: claimedTask!.task.fencingToken, copyId: copy.id, claimedAt: now, leaseMs: 60_000 });
    expect(claimedCopy).not.toBeNull();
    return { poolId, repository, scheduler, claimedTask: claimedTask!, claimedCopy: claimedCopy!, now };
  }

  it("成功时副本、任务、主 permit 与共享 circuit 在同一事务中结算", async () => {
    const attempt = await claimedAttempt();
    const settled = await attempt.repository.settleExternalCopyAttempt({ taskId: attempt.claimedTask.task.id, taskFencingToken: attempt.claimedTask.task.fencingToken, copyId: attempt.claimedCopy.id, copyFencingToken: BigInt(attempt.claimedCopy.fencingToken), outcome: { kind: "SUCCESS" }, completedAt: new Date(attempt.now.getTime() + 1_000) });
    expect(settled.copy.status).toBe("SENT");
    expect(settled.task).toMatchObject({ status: "SUCCEEDED", result: { copyId: attempt.claimedCopy.id, attemptNo: 1, status: "SENT" } });
    expect(settled.permit).toMatchObject({ status: "RELEASED", releaseReason: "SUCCEEDED" });
    expect(settled.circuit).toMatchObject({ state: "CLOSED", consecutiveFailures: 0, windowAttempts: 1, windowFailures: 0 });
  });

  it("可重试失败同时安排副本下一次尝试并终结本次任务", async () => {
    const attempt = await claimedAttempt();
    const settled = await attempt.repository.settleExternalCopyAttempt({
      taskId: attempt.claimedTask.task.id,
      taskFencingToken: attempt.claimedTask.task.fencingToken,
      copyId: attempt.claimedCopy.id,
      copyFencingToken: BigInt(attempt.claimedCopy.fencingToken),
      outcome: { kind: "RATE_LIMITED", errorCode: "FEISHU_HTTP_429", retryAfterMs: 30_000 },
      completedAt: new Date(attempt.now.getTime() + 1_000),
    });
    expect(settled.copy).toMatchObject({ status: "RETRY_WAIT", failureClass: "RATE_LIMITED" });
    expect(settled.task).toMatchObject({ status: "FAILED", terminalReason: "EXTERNAL_COPY_RETRY_SCHEDULED" });
    expect(settled.permit.status).toBe("RELEASED");
    expect(settled.circuit.state).toBe("OPEN");
  });

  it("单目标配置失败不改变共享 circuit", async () => {
    const attempt = await claimedAttempt();
    const before = await db.researchCircuitBreaker.findUnique({ where: { resourcePoolId: attempt.poolId } });
    const settled = await attempt.repository.settleExternalCopyAttempt({
      taskId: attempt.claimedTask.task.id,
      taskFencingToken: attempt.claimedTask.task.fencingToken,
      copyId: attempt.claimedCopy.id,
      copyFencingToken: BigInt(attempt.claimedCopy.fencingToken),
      outcome: { kind: "TARGET_CONFIGURATION", errorCode: "FEISHU_HTTP_400" },
      completedAt: new Date(attempt.now.getTime() + 1_000),
    });
    expect(settled.copy).toMatchObject({ status: "FAILED", failureClass: "TARGET_CONFIGURATION" });
    expect(settled.circuit.version).toBe(before?.version ?? 0n);
  });

  it("事务中任一更新失败会回滚四类权威状态", async () => {
    const attempt = await claimedAttempt();
    const circuitBefore = await db.researchCircuitBreaker.findUniqueOrThrow({ where: { resourcePoolId: attempt.poolId } });
    const repository = new PostgresExternalCopyAttemptRepository(db, attempt.scheduler, {
      beforeCommit: () => { throw new Error("模拟事务末尾失败"); },
    });
    await expect(repository.settleExternalCopyAttempt({
      taskId: attempt.claimedTask.task.id,
      taskFencingToken: attempt.claimedTask.task.fencingToken,
      copyId: attempt.claimedCopy.id,
      copyFencingToken: BigInt(attempt.claimedCopy.fencingToken),
      outcome: { kind: "SUCCESS" },
      completedAt: new Date(attempt.now.getTime() + 1_000),
    })).rejects.toThrow("模拟事务末尾失败");
    await expect(db.researchExternalCopy.findUniqueOrThrow({ where: { id: attempt.claimedCopy.id } })).resolves.toMatchObject({ status: "SENDING" });
    await expect(db.researchTask.findUniqueOrThrow({ where: { id: attempt.claimedTask.task.id } })).resolves.toMatchObject({ status: "RUNNING" });
    await expect(db.researchResourcePermit.findUniqueOrThrow({ where: { id: attempt.claimedTask.permit.id } })).resolves.toMatchObject({ status: "ACTIVE" });
    await expect(db.researchCircuitBreaker.findUniqueOrThrow({ where: { resourcePoolId: attempt.poolId } })).resolves.toMatchObject({ version: circuitBefore.version, state: circuitBefore.state, windowAttempts: circuitBefore.windowAttempts });
  });

  it.each(["task", "copy", "permit"] as const)("%s fencing 失效时整体拒绝结算", async (lost) => {
    const attempt = await claimedAttempt();
    if (lost === "task") await db.researchTask.update({ where: { id: attempt.claimedTask.task.id }, data: { fencingToken: { increment: 1 } } });
    if (lost === "copy") await db.researchExternalCopy.update({ where: { id: attempt.claimedCopy.id }, data: { fencingToken: { increment: 1 } } });
    if (lost === "permit") await db.researchResourcePermit.update({ where: { id: attempt.claimedTask.permit.id }, data: { status: "REVOKED" } });
    const taskBefore = await db.researchTask.findUniqueOrThrow({ where: { id: attempt.claimedTask.task.id } });
    const circuitBefore = await db.researchCircuitBreaker.findUniqueOrThrow({ where: { resourcePoolId: attempt.poolId } });
    await expect(attempt.repository.settleExternalCopyAttempt({
      taskId: attempt.claimedTask.task.id,
      taskFencingToken: attempt.claimedTask.task.fencingToken,
      copyId: attempt.claimedCopy.id,
      copyFencingToken: BigInt(attempt.claimedCopy.fencingToken),
      outcome: { kind: "SUCCESS" },
      completedAt: new Date(attempt.now.getTime() + 1_000),
    })).rejects.toBeInstanceOf(LeaseLostError);
    await expect(db.researchExternalCopy.findUniqueOrThrow({ where: { id: attempt.claimedCopy.id } })).resolves.not.toMatchObject({ status: "SENT" });
    await expect(db.researchTask.findUniqueOrThrow({ where: { id: attempt.claimedTask.task.id } })).resolves.toMatchObject({ status: taskBefore.status, fencingToken: taskBefore.fencingToken, resultJson: taskBefore.resultJson });
    await expect(db.researchCircuitBreaker.findUniqueOrThrow({ where: { resourcePoolId: attempt.poolId } })).resolves.toMatchObject({ version: circuitBefore.version, state: circuitBefore.state, windowAttempts: circuitBefore.windowAttempts });
  });

  it("两个 worker 竞争结算时最多一个成功", async () => {
    const attempt = await claimedAttempt();
    const input = { taskId: attempt.claimedTask.task.id, taskFencingToken: attempt.claimedTask.task.fencingToken, copyId: attempt.claimedCopy.id, copyFencingToken: BigInt(attempt.claimedCopy.fencingToken), outcome: { kind: "SUCCESS" as const }, completedAt: new Date(attempt.now.getTime() + 1_000) };
    const results = await Promise.allSettled([
      attempt.repository.settleExternalCopyAttempt(input),
      attempt.repository.settleExternalCopyAttempt(input),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("HTTP 成功后事务前崩溃会以新的一次性任务恢复发送", async () => {
    const attempt = await claimedAttempt();
    let sends = 1;
    await db.researchTask.update({ where: { id: attempt.claimedTask.task.id }, data: { leaseExpiresAt: new Date(attempt.now.getTime() - 1) } });
    await db.researchResourcePermit.update({ where: { id: attempt.claimedTask.permit.id }, data: { leaseExpiresAt: new Date(attempt.now.getTime() - 1) } });
    await db.researchExternalCopy.update({ where: { id: attempt.claimedCopy.id }, data: { claimExpiresAt: new Date(attempt.now.getTime() - 1) } });

    const scheduled = await new FeishuDueCopyScheduler(db, attempt.scheduler).scheduleDueCopies({ poolId: attempt.poolId, now: attempt.now });
    expect(scheduled.accepted).toBe(1);
    const recoveredTask = await attempt.scheduler.claim(attempt.poolId, "feishu-worker-recovered");
    expect(recoveredTask?.task.input).toMatchObject({ copyId: attempt.claimedCopy.id, attemptNo: 2 });
    expect(recoveredTask?.task.maxAttempts).toBe(1);
    const recoveredCopy = await attempt.repository.claimExternalCopyAttempt({ taskId: recoveredTask!.task.id, taskFencingToken: recoveredTask!.task.fencingToken, copyId: attempt.claimedCopy.id, claimedAt: attempt.now, leaseMs: 60_000 });
    sends += 1;
    await attempt.repository.settleExternalCopyAttempt({ taskId: recoveredTask!.task.id, taskFencingToken: recoveredTask!.task.fencingToken, copyId: recoveredCopy!.id, copyFencingToken: BigInt(recoveredCopy!.fencingToken), outcome: { kind: "SUCCESS" }, completedAt: new Date(attempt.now.getTime() + 1_000) });

    expect(sends).toBe(2);
    await expect(db.researchTask.findMany({ where: { externalCopyId: attempt.claimedCopy.id }, orderBy: { createdAt: "asc" } })).resolves.toMatchObject([{ status: "FAILED", maxAttempts: 1 }, { status: "SUCCEEDED", maxAttempts: 1 }]);
    await expect(db.researchExternalCopy.findUniqueOrThrow({ where: { id: attempt.claimedCopy.id } })).resolves.toMatchObject({ status: "SENT", attempts: 2 });
  });
});

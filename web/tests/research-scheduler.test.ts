import { describe, expect, it } from "vitest";

import {
  LeaseLostError,
  ResearchScheduler,
} from "~/server/application/scheduling/research-scheduler";
import type { SchedulerClock } from "~/server/application/scheduling/research-scheduler";

class TestClock implements SchedulerClock {
  private current: Date;

  constructor(value = "2026-08-03T00:00:00.000Z") {
    this.current = new Date(value);
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }
}

function createScheduler(
  clock: TestClock,
  currentConcurrency = 1,
  hardConcurrency = 4,
  maxUserConcurrencyPerPool = 1,
) {
  const scheduler = new ResearchScheduler({
    clock,
    leaseMs: 1_000,
    permitLeaseMs: 500,
    maxUserConcurrencyPerPool,
    retryDelaysMs: [100, 200, 300],
  });
  scheduler.registerPool({
    id: "pool-provider",
    poolKey: "provider:tushare",
    resourceKind: "PROVIDER",
    hardConcurrency,
    currentConcurrency,
  });
  return scheduler;
}

function enqueue(
  scheduler: ResearchScheduler,
  idempotencyKey: string,
  schedulingTier: "INTERACTIVE" | "TIME_CRITICAL" | "BACKGROUND",
  overrides: Partial<Parameters<ResearchScheduler["enqueue"]>[0]> = {},
) {
  const result = scheduler.enqueue({
    taskType: "provider.fetch",
    idempotencyKey,
    inputHash: `sha256:${idempotencyKey}`,
    inputContractVersion: "1.0",
    input: { idempotencyKey },
    schedulingTier,
    resourcePoolId: "pool-provider",
    fairnessKey: overrides.fairnessKey ?? idempotencyKey,
    ...overrides,
  });
  expect(result.task).not.toBeNull();
  return result.task!;
}

describe("研究调度 module", () => {
  it("按 5:3:1 权重领取并在空闲时借用容量", () => {
    const clock = new TestClock();
    const scheduler = createScheduler(clock, 2);
    for (let index = 0; index < 5; index += 1) enqueue(scheduler, `i-${index}`, "INTERACTIVE");
    for (let index = 0; index < 3; index += 1) enqueue(scheduler, `t-${index}`, "TIME_CRITICAL");
    enqueue(scheduler, "b-0", "BACKGROUND");

    const claimed: string[] = [];
    for (let index = 0; index < 9; index += 1) {
      const task = scheduler.claim("pool-provider", `worker-${index}`);
      expect(task).not.toBeNull();
      claimed.push(task!.task.schedulingTier);
      scheduler.settle(task!.task.id, task!.task.fencingToken, {
        disposition: "COMPLETED",
        resultContractVersion: "1.0",
        result: { ok: true },
      });
    }

    expect(claimed.filter((tier) => tier === "INTERACTIVE")).toHaveLength(5);
    expect(claimed.filter((tier) => tier === "TIME_CRITICAL")).toHaveLength(3);
    expect(claimed.filter((tier) => tier === "BACKGROUND")).toHaveLength(1);
  });

  it("限制同一用户同资源池并发，但允许不同用户竞争", () => {
    const clock = new TestClock();
    const scheduler = createScheduler(clock, 2);
    const first = enqueue(scheduler, "user-a-1", "INTERACTIVE", { userId: "user-a" });
    enqueue(scheduler, "user-a-2", "INTERACTIVE", { userId: "user-a" });
    enqueue(scheduler, "user-b-1", "INTERACTIVE", { userId: "user-b" });

    const firstClaim = scheduler.claim("pool-provider", "worker-a");
    expect(firstClaim?.task.id).toBe(first.id);
    const secondClaim = scheduler.claim("pool-provider", "worker-b");
    expect(secondClaim?.task.userId).toBe("user-b");
  });

  it("尊重资源池配置的同用户并发上限", () => {
    const clock = new TestClock();
    const scheduler = createScheduler(clock, 3, 4, 2);
    enqueue(scheduler, "user-limit-1", "INTERACTIVE", { userId: "user-a" });
    enqueue(scheduler, "user-limit-2", "INTERACTIVE", { userId: "user-a" });
    enqueue(scheduler, "user-limit-3", "INTERACTIVE", { userId: "user-a" });

    expect(scheduler.claim("pool-provider", "worker-a")).not.toBeNull();
    expect(scheduler.claim("pool-provider", "worker-b")).not.toBeNull();
    expect(scheduler.claim("pool-provider", "worker-c")).toBeNull();
  });

  it("同等级先领取目标完成时间更紧迫的任务", () => {
    const clock = new TestClock();
    const scheduler = createScheduler(clock, 1);
    const later = enqueue(scheduler, "urgency-later", "INTERACTIVE", {
      targetCompletionAt: new Date(clock.now().getTime() + 60 * 60_000),
      fairnessKey: "a",
    });
    enqueue(scheduler, "urgency-sooner", "INTERACTIVE", {
      targetCompletionAt: new Date(clock.now().getTime() + 60_000),
      fairnessKey: "b",
    });

    expect(scheduler.claim("pool-provider", "worker-a")?.task.id).not.toBe(
      later.id,
    );
  });

  it("嵌套调用共用资源许可并拒绝旧 fencing", () => {
    const clock = new TestClock();
    const scheduler = createScheduler(clock, 3);
    const task = enqueue(scheduler, "nested-1", "INTERACTIVE");
    const claim = scheduler.claim("pool-provider", "worker-a");
    expect(claim?.task.id).toBe(task.id);
    const nested = scheduler.acquireNestedPermit({
      taskId: task.id,
      resourcePoolId: "pool-provider",
      holderId: "worker-a",
      fencingToken: claim!.task.fencingToken,
      permitKey: "nested-permit-1",
    });
    expect(nested.status).toBe("ACTIVE");
    expect(() =>
      scheduler.acquireNestedPermit({
        taskId: task.id,
        resourcePoolId: "pool-provider",
        holderId: "worker-a",
        fencingToken: claim!.task.fencingToken - 1n,
      }),
    ).toThrow(LeaseLostError);
  });

  it("配置阻断不会被资源结果自动解除", () => {
    const clock = new TestClock();
    const scheduler = createScheduler(clock);
    scheduler.blockConfiguration("pool-provider", "credential_missing");
    scheduler.recordOutcome("pool-provider", { kind: "RATE_LIMITED" });
    expect(scheduler.getCircuit("pool-provider")?.state).toBe("CONFIG_BLOCKED");
    expect(scheduler.allowConfiguration("pool-provider").state).toBe("CLOSED");
  });

  it("背压按等级返回繁忙、合并和暂停，并保留最老任务年龄", () => {
    const clock = new TestClock();
    const scheduler = createScheduler(clock, 1, 1);
    for (let index = 0; index < 4; index += 1) enqueue(scheduler, `interactive-${index}`, "INTERACTIVE");
    clock.advance(500);
    expect(scheduler.enqueue({
      taskType: "provider.fetch",
      idempotencyKey: "interactive-overflow",
      inputHash: "sha256:interactive-overflow",
      inputContractVersion: "1.0",
      input: {},
      schedulingTier: "INTERACTIVE",
      resourcePoolId: "pool-provider",
      fairnessKey: "overflow",
    }).decision).toBe("BUSY");
    for (let index = 0; index < 20; index += 1) enqueue(scheduler, `critical-${index}`, "TIME_CRITICAL");
    expect(scheduler.enqueue({
      taskType: "provider.fetch",
      idempotencyKey: "critical-overflow",
      inputHash: "sha256:critical-overflow",
      inputContractVersion: "1.0",
      input: {},
      schedulingTier: "TIME_CRITICAL",
      resourcePoolId: "pool-provider",
      fairnessKey: "overflow",
    }).decision).toBe("MERGED");
    for (let index = 0; index < 50; index += 1) enqueue(scheduler, `background-${index}`, "BACKGROUND");
    const paused = scheduler.enqueue({
      taskType: "provider.fetch",
      idempotencyKey: "background-overflow",
      inputHash: "sha256:background-overflow",
      inputContractVersion: "1.0",
      input: {},
      schedulingTier: "BACKGROUND",
      resourcePoolId: "pool-provider",
      fairnessKey: "overflow",
    });
    expect(paused.decision).toBe("PAUSED");
    expect(paused.oldestBacklogAgeMs).toBe(500n);
  });

  it("重试尊重 Retry-After、预算和结构化终态原因", () => {
    const clock = new TestClock();
    const scheduler = createScheduler(clock);
    const task = enqueue(scheduler, "retry-1", "INTERACTIVE");
    const claim = scheduler.claim("pool-provider", "worker-a")!;
    const retry = scheduler.settle(task.id, claim.task.fencingToken, {
      disposition: "RETRY",
      errorClass: "RATE_LIMITED",
      retryAfterMs: 700,
    });
    expect(retry.status).toBe("RETRY_WAIT");
    expect(retry.nextAttemptAt?.getTime()).toBe(clock.now().getTime() + 700);
    expect(scheduler.claim("pool-provider", "worker-b")).toBeNull();
    clock.advance(700);
    const second = scheduler.claim("pool-provider", "worker-b")!;
    expect(second.task.attempts).toBe(2);
    const failed = scheduler.settle(task.id, second.task.fencingToken, {
      disposition: "RETRY",
      errorClass: "INVALID_RESPONSE",
      retryable: false,
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.terminalReason).toBe("NON_RETRYABLE_FAILURE");
  });

  it("租约过期后回收许可，旧持有者不能结算", () => {
    const clock = new TestClock();
    const scheduler = createScheduler(clock);
    const task = enqueue(scheduler, "lease-1", "INTERACTIVE");
    const first = scheduler.claim("pool-provider", "worker-a")!;
    clock.advance(1_001);
    expect(() => scheduler.settle(task.id, first.task.fencingToken, {
      disposition: "COMPLETED",
      resultContractVersion: "1.0",
      result: {},
    })).toThrow(LeaseLostError);
    const second = scheduler.claim("pool-provider", "worker-b");
    expect(second?.task.fencingToken).toBeGreaterThan(first.task.fencingToken);
  });

  it("连续失败或 429 熔断，半开仅允许一次探测", () => {
    const clock = new TestClock();
    const scheduler = createScheduler(clock, 2);
    for (let index = 0; index < 5; index += 1) {
      scheduler.recordOutcome("pool-provider", { kind: "FAILURE" });
    }
    expect(scheduler.getCircuit("pool-provider")?.state).toBe("OPEN");
    expect(scheduler.claim("pool-provider", "worker-a")).toBeNull();
    clock.advance(60_000);
    enqueue(scheduler, "probe-1", "INTERACTIVE");
    const probe = scheduler.claim("pool-provider", "worker-a");
    expect(probe).not.toBeNull();
    expect(scheduler.claim("pool-provider", "worker-b")).toBeNull();
  });

  it("半开探测失败会重新打开熔断并清除探测占用", () => {
    const clock = new TestClock();
    const scheduler = createScheduler(clock, 2);
    scheduler.recordOutcome("pool-provider", { kind: "RATE_LIMITED" });
    clock.advance(60_000);
    enqueue(scheduler, "probe-failure-1", "INTERACTIVE");
    const probe = scheduler.claim("pool-provider", "worker-a");
    expect(probe).not.toBeNull();
    expect(scheduler.getCircuit("pool-provider")?.state).toBe("HALF_OPEN");

    const reopened = scheduler.recordOutcome("pool-provider", {
      kind: "FAILURE",
    });
    expect(reopened.state).toBe("OPEN");
    expect(reopened.halfOpenProbeTaskId).toBeNull();
  });

  it("健康成功 20 次且持续健康后增加并发，429 立即减半并冷却", () => {
    const clock = new TestClock();
    const scheduler = createScheduler(clock, 1);
    for (let index = 0; index < 20; index += 1) {
      clock.advance(15_000);
      scheduler.recordAdaptiveOutcome("pool-provider", { kind: "SUCCESS", latencyMs: 10 });
    }
    expect(scheduler.getPool("pool-provider")?.currentConcurrency).toBe(2);
    const reduced = scheduler.recordAdaptiveOutcome("pool-provider", {
      kind: "RATE_LIMITED",
      retryAfterMs: 90_000,
    });
    expect(reduced.current).toBe(1);
    expect(reduced.cooldownUntil).not.toBeNull();
  });
});

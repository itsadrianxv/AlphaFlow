import { createHash, randomUUID } from "node:crypto";

import {
  BACKLOG_FACTORS,
  backlogLimit,
  CIRCUIT_RETRY_DELAYS_MS,
  DEFAULT_RETRY_DELAYS_MS,
  defaultMaxAttempts,
  defaultRetryDeadline,
  retryDelayMs,
  TIER_WEIGHTS,
  urgencyBucket,
  weightedTierOrder,
} from "~/server/domain/scheduling/policies";
import {
  type AdaptiveConcurrencyResult,
  type AdmissionResult,
  type BacklogSnapshot,
  type CircuitBreaker,
  type ClaimedTask,
  type EnqueueTaskInput,
  LeaseLostError,
  type ResearchTask,
  type ResourceOutcome,
  type ResourcePermit,
  ResourcePermitUnavailableError,
  type ResourcePool,
  SchedulingInvariantError,
  type SchedulingTier,
  type TaskSettlement,
} from "~/server/domain/scheduling/types";

export {
  LeaseLostError,
  ResourcePermitUnavailableError,
  SchedulingInvariantError,
} from "~/server/domain/scheduling/types";

export interface SchedulerClock {
  now(): Date;
}

export class SystemSchedulerClock implements SchedulerClock {
  now(): Date {
    return new Date();
  }
}

export interface ResearchSchedulerOptions {
  clock?: SchedulerClock;
  leaseMs?: number;
  permitLeaseMs?: number;
  maxUserConcurrencyPerPool?: number;
  retryDelaysMs?: readonly number[];
  maxP95Multiplier?: number;
}

type MutablePool = ResourcePool & {
  tierCursor: bigint;
  recentFailures: boolean[];
};

type MutableCircuit = CircuitBreaker & {
  failureTimes: Date[];
  recentOutcomes: boolean[];
};

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value.getTime()) : null;
}

function cloneTask(task: ResearchTask): ResearchTask {
  return {
    ...task,
    targetCompletionAt: cloneDate(task.targetCompletionAt),
    retryDeadline: new Date(task.retryDeadline.getTime()),
    nextAttemptAt: cloneDate(task.nextAttemptAt),
    leaseExpiresAt: cloneDate(task.leaseExpiresAt),
    heartbeatAt: cloneDate(task.heartbeatAt),
    createdAt: new Date(task.createdAt.getTime()),
    updatedAt: new Date(task.updatedAt.getTime()),
  };
}

function clonePermit(permit: ResourcePermit): ResourcePermit {
  return {
    ...permit,
    acquiredAt: new Date(permit.acquiredAt.getTime()),
    leaseExpiresAt: new Date(permit.leaseExpiresAt.getTime()),
    releasedAt: cloneDate(permit.releasedAt),
  };
}

function clonePool(pool: ResourcePool): ResourcePool {
  return {
    ...pool,
    lastHealthyAt: cloneDate(pool.lastHealthyAt),
    healthySince: cloneDate(pool.healthySince),
    cooldownUntil: cloneDate(pool.cooldownUntil),
  };
}

function cloneCircuit(circuit: CircuitBreaker): CircuitBreaker {
  return {
    ...circuit,
    retryAfter: cloneDate(circuit.retryAfter),
    updatedAt: new Date(circuit.updatedAt.getTime()),
  };
}

function hashResult(result: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(result) ?? "null", "utf8")
    .digest("hex")}`;
}

/**
 * PostgreSQL-compatible scheduling semantics used by application tests and
 * by adapters that need deterministic decisions before opening a transaction.
 */
export class ResearchScheduler {
  private readonly clock: SchedulerClock;
  private readonly leaseMs: number;
  private readonly permitLeaseMs: number;
  private readonly maxUserConcurrencyPerPool: number;
  private readonly retryDelaysMs: readonly number[];
  private readonly maxP95Multiplier: number;
  private readonly pools = new Map<string, MutablePool>();
  private readonly tasks = new Map<string, ResearchTask>();
  private readonly permits = new Map<string, ResourcePermit>();
  private readonly circuits = new Map<string, MutableCircuit>();

  constructor(options: ResearchSchedulerOptions = {}) {
    this.clock = options.clock ?? new SystemSchedulerClock();
    this.leaseMs = options.leaseMs ?? 15 * 60_000;
    this.permitLeaseMs = options.permitLeaseMs ?? 60_000;
    this.maxUserConcurrencyPerPool = options.maxUserConcurrencyPerPool ?? 1;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    this.maxP95Multiplier = options.maxP95Multiplier ?? 2;
    if (
      this.leaseMs <= 0 ||
      this.permitLeaseMs <= 0 ||
      this.maxUserConcurrencyPerPool <= 0
    ) {
      throw new SchedulingInvariantError("任务 lease 必须为正数");
    }
  }

  registerPool(
    input: Omit<
      ResourcePool,
      | "controlVersion"
      | "lastHealthyAt"
      | "healthySince"
      | "successStreak"
      | "latencyBaselineMs"
      | "cooldownUntil"
    > &
      Partial<
        Pick<
          ResourcePool,
          | "controlVersion"
          | "lastHealthyAt"
          | "healthySince"
          | "successStreak"
          | "latencyBaselineMs"
          | "cooldownUntil"
        >
      >,
  ): ResourcePool {
    if (input.hardConcurrency <= 0 || input.currentConcurrency <= 0) {
      throw new SchedulingInvariantError("资源池并发必须为正数");
    }
    if (input.currentConcurrency > input.hardConcurrency) {
      throw new SchedulingInvariantError("当前并发不能超过资源池硬上限");
    }
    const existing = this.pools.get(input.id);
    if (existing && existing.poolKey !== input.poolKey) {
      throw new SchedulingInvariantError("资源池标识不能变更");
    }
    const now = this.clock.now();
    const pool: MutablePool = existing ?? {
      ...input,
      controlVersion: input.controlVersion ?? 0n,
      lastHealthyAt: input.lastHealthyAt ?? null,
      cooldownUntil: input.cooldownUntil ?? null,
      tierCursor: 0n,
      healthySince: input.healthySince ?? now,
      successStreak: input.successStreak ?? 0,
      recentFailures: [],
      latencyBaselineMs: input.latencyBaselineMs ?? null,
    };
    if (existing) {
      pool.hardConcurrency = input.hardConcurrency;
      pool.currentConcurrency = input.currentConcurrency;
      pool.resourceKind = input.resourceKind;
    }
    this.pools.set(input.id, pool);
    if (!this.circuits.has(input.id)) {
      this.circuits.set(input.id, {
        resourcePoolId: input.id,
        state: "CLOSED",
        version: 0n,
        consecutiveFailures: 0,
        windowAttempts: 0,
        windowFailures: 0,
        openCount: 0,
        retryAfter: null,
        halfOpenProbeTaskId: null,
        blockedReason: null,
        updatedAt: now,
        failureTimes: [],
        recentOutcomes: [],
      });
    }
    return clonePool(pool);
  }

  getPool(poolId: string): ResourcePool | null {
    const pool = this.pools.get(poolId);
    return pool ? clonePool(pool) : null;
  }

  getCircuit(poolId: string): CircuitBreaker | null {
    const circuit = this.circuits.get(poolId);
    return circuit ? cloneCircuit(circuit) : null;
  }

  enqueue(input: EnqueueTaskInput): AdmissionResult {
    const now = this.clock.now();
    const pool = this.requirePool(input.resourcePoolId);
    const duplicate = [...this.tasks.values()].find(
      (task) => task.idempotencyKey === input.idempotencyKey,
    );
    if (duplicate) {
      return {
        decision: "DEDUPLICATED",
        reason: "IDEMPOTENCY_KEY_REUSED",
        task: cloneTask(duplicate),
        oldestBacklogAgeMs: this.oldestBacklogAge(input.resourcePoolId),
      };
    }

    const circuit = this.requireCircuit(pool.id);
    if (circuit.state === "CONFIG_BLOCKED") {
      return {
        decision: "REJECTED",
        reason: circuit.blockedReason ?? "RESOURCE_CONFIG_BLOCKED",
        task: null,
        oldestBacklogAgeMs: this.oldestBacklogAge(pool.id),
      };
    }
    if (
      circuit.state === "OPEN" &&
      (!circuit.retryAfter || circuit.retryAfter > now)
    ) {
      return {
        decision: "REJECTED",
        reason: "RESOURCE_CIRCUIT_OPEN",
        task: null,
        oldestBacklogAgeMs: this.oldestBacklogAge(pool.id),
      };
    }

    const snapshot = this.getBacklog(pool.id);
    const limit = snapshot.limits[input.schedulingTier];
    if (snapshot.counts[input.schedulingTier] >= limit) {
      const reason = `${input.schedulingTier}_BACKLOG_LIMIT`;
      if (input.schedulingTier === "INTERACTIVE") {
        return {
          decision: "BUSY",
          reason,
          task: null,
          oldestBacklogAgeMs: snapshot.oldestAgeMs,
        };
      }
      if (input.schedulingTier === "TIME_CRITICAL") {
        return {
          decision: "MERGED",
          reason: "TIME_CRITICAL_DUPLICATE_WINDOW_MERGED",
          task: null,
          oldestBacklogAgeMs: snapshot.oldestAgeMs,
        };
      }
      return {
        decision: "PAUSED",
        reason: "BACKGROUND_BACKLOG_PAUSED",
        task: null,
        oldestBacklogAgeMs: snapshot.oldestAgeMs,
      };
    }

    const task: ResearchTask = {
      id: randomUUID(),
      taskType: input.taskType,
      idempotencyKey: input.idempotencyKey,
      inputHash: input.inputHash,
      inputContractVersion: input.inputContractVersion,
      input: input.input,
      schedulingTier: input.schedulingTier,
      resourcePoolId: input.resourcePoolId,
      fairnessKey: input.fairnessKey,
      userId: input.userId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      targetCompletionAt: cloneDate(input.targetCompletionAt ?? null),
      status: "PENDING",
      attempts: 0,
      maxAttempts:
        input.maxAttempts ?? defaultMaxAttempts(input.schedulingTier),
      retryDeadline: new Date(
        (
          input.retryDeadline ?? defaultRetryDeadline(input.schedulingTier, now)
        ).getTime(),
      ),
      nextAttemptAt: null,
      workerId: null,
      fencingToken: 0n,
      leaseExpiresAt: null,
      heartbeatAt: null,
      resultContractVersion: null,
      resultHash: null,
      result: null,
      errorClass: null,
      retryability: null,
      terminalReason: null,
      oldestBacklogAgeMs: 0n,
      createdAt: now,
      updatedAt: now,
    };
    if (task.maxAttempts <= 0 || task.retryDeadline <= now) {
      throw new SchedulingInvariantError("任务重试上限和截止时间必须有效");
    }
    this.tasks.set(task.id, task);
    return {
      decision: "ACCEPTED",
      reason: "ADMITTED",
      task: cloneTask(task),
      oldestBacklogAgeMs: snapshot.oldestAgeMs,
    };
  }

  claim(poolId: string, workerId: string): ClaimedTask | null {
    const now = this.clock.now();
    const pool = this.requirePool(poolId);
    this.recoverExpiredLeases(now, poolId);
    const circuit = this.requireCircuit(poolId);
    if (circuit.state === "CONFIG_BLOCKED") return null;
    if (circuit.state === "OPEN") {
      if (!circuit.retryAfter || circuit.retryAfter > now) return null;
      if (circuit.halfOpenProbeTaskId) return null;
      circuit.state = "HALF_OPEN";
      circuit.halfOpenProbeTaskId = null;
      circuit.version += 1n;
      circuit.updatedAt = now;
    }
    if (circuit.state === "HALF_OPEN" && circuit.halfOpenProbeTaskId) {
      const probe = this.tasks.get(circuit.halfOpenProbeTaskId);
      if (
        !probe ||
        probe.status !== "RUNNING" ||
        !probe.leaseExpiresAt ||
        probe.leaseExpiresAt <= now
      ) {
        circuit.halfOpenProbeTaskId = null;
      }
    }
    if (circuit.state === "HALF_OPEN" && circuit.halfOpenProbeTaskId)
      return null;

    const activePermits = this.activePermits(poolId, now);
    if (activePermits.length >= pool.currentConcurrency) return null;
    const candidates = [...this.tasks.values()].filter(
      (task) =>
        task.resourcePoolId === poolId &&
        (task.status === "PENDING" || task.status === "RETRY_WAIT") &&
        (!task.nextAttemptAt || task.nextAttemptAt <= now) &&
        task.retryDeadline > now &&
        task.attempts < task.maxAttempts &&
        (!task.userId ||
          this.activeUserCount(poolId, task.userId, now) <
            this.maxUserConcurrencyPerPool),
    );
    if (candidates.length === 0) return null;

    const availableTiers = new Set(
      candidates.map((task) => task.schedulingTier),
    );
    const tier = weightedTierOrder(availableTiers, pool.tierCursor)[0];
    if (!tier) return null;
    const candidate = this.selectWithinTier(
      candidates.filter((task) => task.schedulingTier === tier),
      poolId,
      now,
    );
    if (!candidate) return null;
    if (
      candidate.userId &&
      this.activeUserCount(poolId, candidate.userId, now) >=
        this.maxUserConcurrencyPerPool
    ) {
      return null;
    }

    pool.tierCursor += 1n;
    pool.controlVersion += 1n;
    candidate.status = "RUNNING";
    candidate.attempts += 1;
    candidate.workerId = workerId;
    candidate.fencingToken += 1n;
    candidate.leaseExpiresAt = new Date(now.getTime() + this.leaseMs);
    candidate.heartbeatAt = now;
    candidate.nextAttemptAt = null;
    candidate.oldestBacklogAgeMs = BigInt(
      Math.max(0, now.getTime() - candidate.createdAt.getTime()),
    );
    candidate.updatedAt = now;

    const permit: ResourcePermit = {
      id: randomUUID(),
      resourcePoolId: poolId,
      taskId: candidate.id,
      permitKey: `${candidate.id}:${candidate.fencingToken.toString()}:primary`,
      holderId: workerId,
      fencingToken: candidate.fencingToken,
      status: "ACTIVE",
      acquiredAt: now,
      leaseExpiresAt: new Date(now.getTime() + this.permitLeaseMs),
      releasedAt: null,
      releaseReason: null,
    };
    this.permits.set(permit.id, permit);
    if (circuit.state === "HALF_OPEN")
      circuit.halfOpenProbeTaskId = candidate.id;
    return { task: cloneTask(candidate), permit: clonePermit(permit) };
  }

  renew(taskId: string, fencingToken: bigint, holderId: string): ClaimedTask {
    const now = this.clock.now();
    const task = this.requireTask(taskId);
    if (
      task.status !== "RUNNING" ||
      task.fencingToken !== fencingToken ||
      task.workerId !== holderId ||
      (task.leaseExpiresAt && task.leaseExpiresAt <= now)
    ) {
      throw new LeaseLostError();
    }
    task.heartbeatAt = now;
    task.leaseExpiresAt = new Date(now.getTime() + this.leaseMs);
    task.updatedAt = now;
    const permits = this.activePermitsForTask(taskId).filter(
      (permit) =>
        permit.fencingToken === fencingToken && permit.holderId === holderId,
    );
    for (const permit of permits)
      permit.leaseExpiresAt = new Date(now.getTime() + this.permitLeaseMs);
    const primary = permits[0];
    if (!primary)
      throw new ResourcePermitUnavailableError("任务缺少有效资源许可");
    return { task: cloneTask(task), permit: clonePermit(primary) };
  }

  acquireNestedPermit(input: {
    taskId: string;
    resourcePoolId: string;
    holderId: string;
    fencingToken: bigint;
    permitKey?: string;
    leaseMs?: number;
  }): ResourcePermit {
    const now = this.clock.now();
    const task = this.requireTask(input.taskId);
    if (
      task.status !== "RUNNING" ||
      task.fencingToken !== input.fencingToken ||
      task.workerId !== input.holderId ||
      (task.leaseExpiresAt && task.leaseExpiresAt <= now)
    ) {
      throw new LeaseLostError("嵌套调用不能使用旧 fencing token");
    }
    if (task.resourcePoolId !== input.resourcePoolId) {
      throw new ResourcePermitUnavailableError(
        "嵌套调用必须先以目标资源池创建子任务，不能跨池复用父任务许可",
      );
    }
    const pool = this.requirePool(input.resourcePoolId);
    const circuit = this.requireCircuit(pool.id);
    if (circuit.state === "OPEN" || circuit.state === "CONFIG_BLOCKED") {
      throw new ResourcePermitUnavailableError("资源池熔断或配置阻断");
    }
    const active = this.activePermits(pool.id, now);
    if (active.length >= pool.currentConcurrency) {
      throw new ResourcePermitUnavailableError("资源池许可已达到全局并发上限");
    }
    const permitKey =
      input.permitKey ??
      `${input.taskId}:${input.resourcePoolId}:${randomUUID()}`;
    const existing = [...this.permits.values()].find(
      (permit) => permit.permitKey === permitKey && permit.status === "ACTIVE",
    );
    if (existing) {
      if (
        existing.taskId !== task.id ||
        existing.resourcePoolId !== pool.id ||
        existing.holderId !== input.holderId ||
        existing.fencingToken !== input.fencingToken
      ) {
        throw new LeaseLostError("资源许可已被其他 fencing 持有");
      }
      return clonePermit(existing);
    }
    const permit: ResourcePermit = {
      id: randomUUID(),
      resourcePoolId: pool.id,
      taskId: task.id,
      permitKey,
      holderId: input.holderId,
      fencingToken: input.fencingToken,
      status: "ACTIVE",
      acquiredAt: now,
      leaseExpiresAt: new Date(
        now.getTime() + (input.leaseMs ?? this.permitLeaseMs),
      ),
      releasedAt: null,
      releaseReason: null,
    };
    this.permits.set(permit.id, permit);
    return clonePermit(permit);
  }

  releasePermit(
    permitId: string,
    holderId: string,
    fencingToken: bigint,
    reason = "released",
  ): void {
    const permit = this.permits.get(permitId);
    if (!permit || permit.status !== "ACTIVE") return;
    if (permit.holderId !== holderId || permit.fencingToken !== fencingToken) {
      throw new LeaseLostError("旧 fencing token 不能释放资源许可");
    }
    const now = this.clock.now();
    permit.status = "RELEASED";
    permit.releasedAt = now;
    permit.releaseReason = reason;
  }

  settle(
    taskId: string,
    fencingToken: bigint,
    settlement: TaskSettlement,
  ): ResearchTask {
    const now = this.clock.now();
    const task = this.requireTask(taskId);
    if (
      task.status !== "RUNNING" ||
      task.fencingToken !== fencingToken ||
      (task.leaseExpiresAt !== null && task.leaseExpiresAt <= now)
    ) {
      throw new LeaseLostError("旧 fencing token 不能结算任务");
    }
    if (settlement.disposition === "COMPLETED") {
      task.status = "SUCCEEDED";
      task.result = settlement.result;
      task.resultContractVersion = settlement.resultContractVersion;
      task.resultHash = hashResult(settlement.result);
      task.errorClass = null;
      task.retryability = null;
      task.terminalReason = null;
    } else if (settlement.disposition === "RETRY") {
      const retryable = settlement.retryable ?? true;
      const withinBudget =
        task.attempts < task.maxAttempts && task.retryDeadline > now;
      if (!retryable || !withinBudget) {
        task.status = "FAILED";
        task.retryability = retryable ? "RETRYABLE" : "NON_RETRYABLE";
        task.terminalReason = retryable
          ? "RETRY_BUDGET_EXHAUSTED"
          : "NON_RETRYABLE_FAILURE";
      } else {
        const delay = Math.max(
          retryDelayMs(task.attempts, this.retryDelaysMs),
          settlement.retryAfterMs ?? 0,
        );
        const nextAttemptAt = new Date(now.getTime() + delay);
        task.status = "RETRY_WAIT";
        task.nextAttemptAt =
          nextAttemptAt > task.retryDeadline
            ? task.retryDeadline
            : nextAttemptAt;
        task.retryability = "RETRYABLE";
        task.terminalReason = null;
      }
      task.errorClass = settlement.errorClass;
    } else {
      task.status = settlement.disposition;
      task.errorClass = settlement.errorClass;
      task.retryability = "NON_RETRYABLE";
      task.terminalReason = settlement.terminalReason;
    }
    task.workerId = null;
    task.leaseExpiresAt = null;
    task.heartbeatAt = null;
    task.updatedAt = now;
    this.releaseAllTaskPermits(task.id, settlement.disposition.toLowerCase());
    const circuit = this.requireCircuit(task.resourcePoolId);
    if (circuit.state === "HALF_OPEN") {
      circuit.halfOpenProbeTaskId = null;
      if (settlement.disposition === "COMPLETED")
        this.closeCircuit(circuit, now);
    }
    return cloneTask(task);
  }

  cancel(
    taskId: string,
    fencingToken: bigint,
    reason = "cancelled",
  ): ResearchTask {
    return this.settle(taskId, fencingToken, {
      disposition: "CANCELLED",
      errorClass: "TASK_CANCELLED",
      terminalReason: reason,
    });
  }

  getTask(taskId: string): ResearchTask | null {
    const task = this.tasks.get(taskId);
    return task ? cloneTask(task) : null;
  }

  getBacklog(poolId: string): BacklogSnapshot {
    const pool = this.requirePool(poolId);
    const counts: Record<SchedulingTier, number> = {
      INTERACTIVE: 0,
      TIME_CRITICAL: 0,
      BACKGROUND: 0,
    };
    let oldestCreatedAt: Date | null = null;
    for (const task of this.tasks.values()) {
      if (
        task.resourcePoolId !== poolId ||
        (task.status !== "PENDING" && task.status !== "RETRY_WAIT")
      )
        continue;
      counts[task.schedulingTier] += 1;
      if (!oldestCreatedAt || task.createdAt < oldestCreatedAt)
        oldestCreatedAt = task.createdAt;
    }
    const now = this.clock.now();
    return {
      resourcePoolId: poolId,
      limits: {
        INTERACTIVE: backlogLimit("INTERACTIVE", pool.hardConcurrency),
        TIME_CRITICAL: backlogLimit("TIME_CRITICAL", pool.hardConcurrency),
        BACKGROUND: backlogLimit("BACKGROUND", pool.hardConcurrency),
      },
      counts,
      oldestAgeMs: oldestCreatedAt
        ? BigInt(Math.max(0, now.getTime() - oldestCreatedAt.getTime()))
        : null,
      total: counts.INTERACTIVE + counts.TIME_CRITICAL + counts.BACKGROUND,
    };
  }

  recordOutcome(poolId: string, outcome: ResourceOutcome): CircuitBreaker {
    const now = outcome.at ?? this.clock.now();
    const circuit = this.requireCircuit(poolId);
    if (circuit.state === "CONFIG_BLOCKED") return cloneCircuit(circuit);
    circuit.updatedAt = now;
    const failed = outcome.kind !== "SUCCESS";
    circuit.recentOutcomes.push(failed);
    circuit.recentOutcomes = circuit.recentOutcomes.slice(-20);
    circuit.windowAttempts = circuit.recentOutcomes.length;
    circuit.windowFailures = circuit.recentOutcomes.filter(Boolean).length;
    if (failed) {
      circuit.consecutiveFailures += 1;
      circuit.failureTimes.push(now);
    } else {
      circuit.consecutiveFailures = 0;
    }
    circuit.failureTimes = circuit.failureTimes.filter(
      (at) => now.getTime() - at.getTime() <= 20 * 60_000,
    );
    const rateLimited = outcome.kind === "RATE_LIMITED";
    const failureThreshold =
      circuit.consecutiveFailures >= 5 ||
      (circuit.recentOutcomes.length >= 20 &&
        circuit.windowFailures / Math.max(1, circuit.windowAttempts) >= 0.5);
    const shouldOpen =
      circuit.state === "HALF_OPEN" ? failed : rateLimited || failureThreshold;
    if (shouldOpen) {
      const index = Math.min(
        circuit.openCount,
        CIRCUIT_RETRY_DELAYS_MS.length - 1,
      );
      const delay = rateLimited
        ? Math.max(
            outcome.retryAfterMs ?? 0,
            CIRCUIT_RETRY_DELAYS_MS[index] ?? 60_000,
          )
        : (CIRCUIT_RETRY_DELAYS_MS[index] ?? 60_000);
      circuit.state = "OPEN";
      circuit.retryAfter = new Date(now.getTime() + delay);
      circuit.halfOpenProbeTaskId = null;
      circuit.openCount += 1;
      circuit.version += 1n;
    } else if (circuit.state === "HALF_OPEN" && outcome.kind === "SUCCESS") {
      this.closeCircuit(circuit, now);
    }
    return cloneCircuit(circuit);
  }

  blockConfiguration(poolId: string, reason: string): CircuitBreaker {
    const circuit = this.requireCircuit(poolId);
    circuit.state = "CONFIG_BLOCKED";
    circuit.blockedReason = reason;
    circuit.retryAfter = null;
    circuit.halfOpenProbeTaskId = null;
    circuit.version += 1n;
    circuit.updatedAt = this.clock.now();
    return cloneCircuit(circuit);
  }

  allowConfiguration(poolId: string): CircuitBreaker {
    const circuit = this.requireCircuit(poolId);
    this.closeCircuit(circuit, this.clock.now());
    return cloneCircuit(circuit);
  }

  recordAdaptiveOutcome(
    poolId: string,
    outcome: ResourceOutcome,
  ): AdaptiveConcurrencyResult {
    const pool = this.requirePool(poolId);
    const now = outcome.at ?? this.clock.now();
    const previous = pool.currentConcurrency;
    if (outcome.kind === "RATE_LIMITED") {
      pool.currentConcurrency = Math.max(
        1,
        Math.floor(pool.currentConcurrency / 2),
      );
      pool.cooldownUntil = new Date(now.getTime() + 5 * 60_000);
      pool.successStreak = 0;
      pool.healthySince = null;
      pool.controlVersion += 1n;
      return this.adaptiveResult(pool, previous, "RATE_LIMITED_HALVED");
    }
    if (outcome.kind === "TIMEOUT" || outcome.kind === "LATENCY_HIGH") {
      pool.currentConcurrency = Math.max(1, pool.currentConcurrency - 1);
      pool.cooldownUntil = new Date(now.getTime() + 5 * 60_000);
      pool.successStreak = 0;
      pool.healthySince = null;
      pool.controlVersion += 1n;
      return this.adaptiveResult(pool, previous, `${outcome.kind}_DECREASED`);
    }
    if (outcome.kind === "SUCCESS") {
      pool.successStreak += 1;
      pool.lastHealthyAt = now;
      if (!pool.healthySince) pool.healthySince = now;
      if (
        pool.successStreak >= 20 &&
        now.getTime() - pool.healthySince.getTime() >= 5 * 60_000 &&
        (!pool.cooldownUntil || pool.cooldownUntil <= now) &&
        pool.currentConcurrency < pool.hardConcurrency &&
        (outcome.latencyMs === undefined ||
          pool.latencyBaselineMs === null ||
          outcome.latencyMs <= pool.latencyBaselineMs * this.maxP95Multiplier)
      ) {
        pool.currentConcurrency += 1;
        pool.successStreak = 0;
        pool.controlVersion += 1n;
        return this.adaptiveResult(pool, previous, "HEALTHY_STREAK_INCREASED");
      }
      if (outcome.latencyMs !== undefined) {
        pool.latencyBaselineMs =
          pool.latencyBaselineMs === null
            ? outcome.latencyMs
            : Math.min(pool.latencyBaselineMs, outcome.latencyMs);
      }
    }
    return this.adaptiveResult(pool, previous, "NO_CHANGE");
  }

  restartPool(poolId: string): ResourcePool {
    const pool = this.requirePool(poolId);
    pool.currentConcurrency = 1;
    pool.successStreak = 0;
    pool.healthySince = null;
    pool.cooldownUntil = null;
    pool.controlVersion += 1n;
    return clonePool(pool);
  }

  private adaptiveResult(
    pool: MutablePool,
    previous: number,
    reason: string,
  ): AdaptiveConcurrencyResult {
    return {
      previous,
      current: pool.currentConcurrency,
      changed: previous !== pool.currentConcurrency,
      reason,
      cooldownUntil: cloneDate(pool.cooldownUntil),
    };
  }

  private closeCircuit(circuit: MutableCircuit, now: Date): void {
    circuit.state = "CLOSED";
    circuit.retryAfter = null;
    circuit.halfOpenProbeTaskId = null;
    circuit.blockedReason = null;
    circuit.consecutiveFailures = 0;
    circuit.windowAttempts = 0;
    circuit.windowFailures = 0;
    circuit.failureTimes = [];
    circuit.recentOutcomes = [];
    circuit.updatedAt = now;
    circuit.version += 1n;
  }

  private selectWithinTier(
    candidates: ResearchTask[],
    poolId: string,
    now: Date,
  ): ResearchTask | null {
    if (candidates.length === 0) return null;
    const bucket = Math.min(
      ...candidates.map((task) => urgencyBucket(task.targetCompletionAt, now)),
    );
    const urgent = candidates.filter(
      (task) => urgencyBucket(task.targetCompletionAt, now) === bucket,
    );
    const fairnessKeys = [
      ...new Set(urgent.map((task) => task.fairnessKey)),
    ].sort();
    const pool = this.requirePool(poolId);
    const start = Number(
      pool.controlVersion % BigInt(Math.max(1, fairnessKeys.length)),
    );
    const orderedKeys = fairnessKeys
      .slice(start)
      .concat(fairnessKeys.slice(0, start));
    for (const fairnessKey of orderedKeys) {
      const match = urgent
        .filter((task) => task.fairnessKey === fairnessKey)
        .sort(
          (left, right) =>
            Number(left.attempts > 0) - Number(right.attempts > 0) ||
            left.createdAt.getTime() - right.createdAt.getTime(),
        )[0];
      if (match) return match;
    }
    return (
      urgent.sort(
        (left, right) =>
          Number(left.attempts > 0) - Number(right.attempts > 0) ||
          left.createdAt.getTime() - right.createdAt.getTime(),
      )[0] ?? null
    );
  }

  private recoverExpiredLeases(now: Date, poolId: string): void {
    for (const task of this.tasks.values()) {
      if (
        task.resourcePoolId !== poolId ||
        task.status !== "RUNNING" ||
        !task.leaseExpiresAt ||
        task.leaseExpiresAt > now
      )
        continue;
      task.status =
        task.attempts < task.maxAttempts && task.retryDeadline > now
          ? "RETRY_WAIT"
          : "FAILED";
      task.nextAttemptAt = task.status === "RETRY_WAIT" ? now : null;
      task.workerId = null;
      task.leaseExpiresAt = null;
      task.heartbeatAt = null;
      task.errorClass = "LEASE_EXPIRED";
      task.retryability =
        task.status === "RETRY_WAIT" ? "RETRYABLE" : "NON_RETRYABLE";
      task.terminalReason =
        task.status === "FAILED" ? "RETRY_BUDGET_EXHAUSTED" : null;
      task.updatedAt = now;
      for (const permit of this.activePermitsForTask(task.id)) {
        permit.status = "EXPIRED";
        permit.releasedAt = now;
        permit.releaseReason = "task_lease_expired";
      }
    }
  }

  private releaseAllTaskPermits(taskId: string, reason: string): void {
    const now = this.clock.now();
    for (const permit of this.activePermitsForTask(taskId)) {
      permit.status = "RELEASED";
      permit.releasedAt = now;
      permit.releaseReason = reason;
    }
  }

  private activePermits(poolId: string, now: Date): ResourcePermit[] {
    const active: ResourcePermit[] = [];
    for (const permit of this.permits.values()) {
      if (permit.resourcePoolId !== poolId || permit.status !== "ACTIVE")
        continue;
      if (permit.leaseExpiresAt <= now) {
        permit.status = "EXPIRED";
        permit.releasedAt = now;
        permit.releaseReason = "permit_lease_expired";
        continue;
      }
      active.push(permit);
    }
    return active;
  }

  private activePermitsForTask(taskId: string): ResourcePermit[] {
    return [...this.permits.values()].filter(
      (permit) => permit.taskId === taskId && permit.status === "ACTIVE",
    );
  }

  private activeUserCount(poolId: string, userId: string, now: Date): number {
    const activeTaskIds = new Set<string>();
    for (const permit of this.activePermits(poolId, now)) {
      const task = this.tasks.get(permit.taskId);
      if (task?.userId === userId && task.status === "RUNNING") {
        activeTaskIds.add(task.id);
      }
    }
    return activeTaskIds.size;
  }

  private oldestBacklogAge(poolId: string): bigint | null {
    return this.getBacklog(poolId).oldestAgeMs;
  }

  private requirePool(poolId: string): MutablePool {
    const pool = this.pools.get(poolId);
    if (!pool) throw new SchedulingInvariantError(`资源池不存在: ${poolId}`);
    return pool;
  }

  private requireTask(taskId: string): ResearchTask {
    const task = this.tasks.get(taskId);
    if (!task) throw new SchedulingInvariantError(`任务不存在: ${taskId}`);
    return task;
  }

  private requireCircuit(poolId: string): MutableCircuit {
    const circuit = this.circuits.get(poolId);
    if (!circuit)
      throw new SchedulingInvariantError(`资源池熔断器不存在: ${poolId}`);
    return circuit;
  }
}

export const schedulingPolicy = {
  tierWeights: TIER_WEIGHTS,
  backlogFactors: BACKLOG_FACTORS,
};

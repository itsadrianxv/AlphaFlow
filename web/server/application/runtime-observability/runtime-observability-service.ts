import { randomUUID } from "node:crypto";
import {
  evaluateRelease,
  type ReleaseEvaluation,
} from "~/server/domain/runtime-observability/release-gates";
import { resolveRuntimeTargets } from "~/server/domain/runtime-observability/runtime-targets";
import type {
  RuntimeAlert,
  RuntimeBreach,
  RuntimeDimension,
  RuntimeMetric,
  RuntimeMetricFilter,
  RuntimeObservation,
  RuntimeObservationInput,
  RuntimeReleaseCheck,
} from "~/server/domain/runtime-observability/types";

export interface RuntimeObservabilityRepository {
  findObservationByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<RuntimeObservation | null>;
  saveObservation(observation: RuntimeObservation): Promise<RuntimeObservation>;
  saveBreach(breach: RuntimeBreach): Promise<RuntimeBreach>;
  saveAlert(alert: RuntimeAlert): Promise<RuntimeAlert>;
  listObservations(): Promise<RuntimeObservation[]>;
  listBreaches(): Promise<RuntimeBreach[]>;
  listAlerts(): Promise<RuntimeAlert[]>;
  saveReleaseEvaluation(
    evaluation: RuntimeReleaseEvaluationRecord,
  ): Promise<RuntimeReleaseEvaluationRecord>;
  listReleaseEvaluations(): Promise<RuntimeReleaseEvaluationRecord[]>;
}

export type RuntimeRecordResult = RuntimeObservation & {
  breaches: RuntimeBreach[];
  alerts: RuntimeAlert[];
};

export type RuntimeReleaseEvaluationRecord = ReleaseEvaluation & {
  evaluationKey: string;
  checks: RuntimeReleaseCheck[];
  checkedAt: Date;
};

function cloneDate(value: Date | null): Date | null {
  return value ? new Date(value.getTime()) : null;
}

function cloneDimension(dimension: RuntimeDimension): RuntimeDimension {
  return { ...dimension };
}

function cloneObservation(observation: RuntimeObservation): RuntimeObservation {
  return {
    ...observation,
    dimension: cloneDimension(observation.dimension),
    sourceClockAt: cloneDate(observation.sourceClockAt),
    sourceClockKind: observation.sourceClockKind,
    productClockAt: cloneDate(observation.productClockAt),
    readyAt: new Date(observation.readyAt.getTime()),
    actualDataCutoff: cloneDate(observation.actualDataCutoff),
    targetDataCutoff: cloneDate(observation.targetDataCutoff),
    permit: observation.permit ? { ...observation.permit } : null,
    circuit: observation.circuit ? { ...observation.circuit } : null,
    adaptive: observation.adaptive
      ? {
          ...observation.adaptive,
          cooldownUntil: cloneDate(observation.adaptive.cooldownUntil ?? null),
        }
      : null,
    usage: { ...observation.usage },
    delivery: observation.delivery ? { ...observation.delivery } : null,
    recordedAt: new Date(observation.recordedAt.getTime()),
  };
}

function cloneBreach(breach: RuntimeBreach): RuntimeBreach {
  return {
    ...breach,
    actualDataCutoff: cloneDate(breach.actualDataCutoff),
    targetDataCutoff: cloneDate(breach.targetDataCutoff),
    occurredAt: new Date(breach.occurredAt.getTime()),
  };
}

function cloneAlert(alert: RuntimeAlert): RuntimeAlert {
  return { ...alert, occurredAt: new Date(alert.occurredAt.getTime()) };
}

function cloneReleaseEvaluation(
  evaluation: RuntimeReleaseEvaluationRecord,
): RuntimeReleaseEvaluationRecord {
  return {
    ...evaluation,
    checks: evaluation.checks.map((check) => ({ ...check })),
    hardGateFailures: [...evaluation.hardGateFailures],
    manualChecks: [...evaluation.manualChecks],
    runtimeBreaches: [...evaluation.runtimeBreaches],
    runtimeDegradation: { ...evaluation.runtimeDegradation },
    checkedAt: new Date(evaluation.checkedAt.getTime()),
  };
}

/** 内存实现用于 application contract test，也可作为无数据库的本地观测 adapter。 */
export class InMemoryRuntimeObservabilityRepository
  implements RuntimeObservabilityRepository
{
  private readonly observations = new Map<string, RuntimeObservation>();
  private readonly breaches = new Map<string, RuntimeBreach>();
  private readonly alerts = new Map<string, RuntimeAlert>();
  private readonly releaseEvaluations = new Map<
    string,
    RuntimeReleaseEvaluationRecord
  >();

  async findObservationByIdempotencyKey(idempotencyKey: string) {
    const observation = [...this.observations.values()].find(
      (item) => item.idempotencyKey === idempotencyKey,
    );
    return observation ? cloneObservation(observation) : null;
  }

  async saveObservation(observation: RuntimeObservation) {
    const existing = [...this.observations.values()].find(
      (item) => item.idempotencyKey === observation.idempotencyKey,
    );
    if (existing) return cloneObservation(existing);
    this.observations.set(observation.id, cloneObservation(observation));
    return cloneObservation(observation);
  }

  async saveBreach(breach: RuntimeBreach) {
    const existing = this.breaches.get(breach.idempotencyKey);
    if (existing) return cloneBreach(existing);
    this.breaches.set(breach.idempotencyKey, cloneBreach(breach));
    return cloneBreach(breach);
  }

  async saveAlert(alert: RuntimeAlert) {
    const existing = this.alerts.get(alert.idempotencyKey);
    if (existing) return cloneAlert(existing);
    this.alerts.set(alert.idempotencyKey, cloneAlert(alert));
    return cloneAlert(alert);
  }

  async listObservations() {
    return [...this.observations.values()].map(cloneObservation);
  }

  async listBreaches() {
    return [...this.breaches.values()].map(cloneBreach);
  }

  async listAlerts() {
    return [...this.alerts.values()].map(cloneAlert);
  }

  async saveReleaseEvaluation(evaluation: RuntimeReleaseEvaluationRecord) {
    const existing = this.releaseEvaluations.get(evaluation.evaluationKey);
    if (existing) return cloneReleaseEvaluation(existing);
    this.releaseEvaluations.set(
      evaluation.evaluationKey,
      cloneReleaseEvaluation(evaluation),
    );
    return cloneReleaseEvaluation(evaluation);
  }

  async listReleaseEvaluations() {
    return [...this.releaseEvaluations.values()].map(cloneReleaseEvaluation);
  }
}

function validateNonNegative(name: string, value: number | null | undefined) {
  if (value === null || value === undefined) return;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    throw new Error(`${name} 必须是非负整数`);
  }
}

function durationMs(start: Date | null | undefined, end: Date) {
  if (!start) return null;
  const duration = end.getTime() - start.getTime();
  if (duration < 0) throw new Error("运行观测时钟不能晚于就绪时间");
  return duration;
}

function assertValidDate(name: string, value: Date | null | undefined) {
  if (value && Number.isNaN(value.getTime())) {
    throw new Error(`${name} 必须是有效时间`);
  }
}

function percentile(values: readonly number[], fraction: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? null;
}

function summary(values: readonly number[]) {
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length > 0 ? Math.max(...values) : null,
  };
}

function average(values: readonly number[]) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function segmentKey(dimension: RuntimeDimension) {
  return [
    dimension.source ?? "",
    dimension.dataset ?? "",
    dimension.stage ?? "",
    dimension.resourcePool ?? "",
  ].join("\u001f");
}

function sameDimension(
  observation: RuntimeObservation,
  filter: RuntimeMetricFilter,
) {
  return (
    Object.keys({
      source: filter.source,
      dataset: filter.dataset,
      stage: filter.stage,
      resourcePool: filter.resourcePool,
    }) as (keyof RuntimeDimension)[]
  ).every(
    (key) =>
      filter[key] === undefined || observation.dimension[key] === filter[key],
  );
}

function byTime(observation: RuntimeObservation, filter: RuntimeMetricFilter) {
  const time = observation.recordedAt.getTime();
  return (
    (filter.from === undefined || time >= filter.from.getTime()) &&
    (filter.to === undefined || time <= filter.to.getTime())
  );
}

function buildMetric(
  observations: readonly RuntimeObservation[],
  breaches: readonly RuntimeBreach[],
  alerts: readonly RuntimeAlert[],
  tradingDays: readonly string[],
): RuntimeMetric {
  const first = observations[0];
  if (!first) throw new Error("不能为零样本构造运行指标");
  const sourceLatencies = observations.flatMap((item) =>
    item.sourceLatencyMs === null ? [] : [item.sourceLatencyMs],
  );
  const productLatencies = observations.flatMap((item) =>
    item.productLatencyMs === null ? [] : [item.productLatencyMs],
  );
  const backlogAges = observations.flatMap((item) =>
    item.backlogAgeMs === null ? [] : [item.backlogAgeMs],
  );
  const waitTimes = observations.flatMap((item) =>
    item.permit?.waitMs === undefined ? [] : [item.permit.waitMs],
  );
  const heldTimes = observations.flatMap((item) =>
    item.permit?.heldMs === undefined ? [] : [item.permit.heldMs],
  );
  const deliveryLatencies = observations.flatMap((item) =>
    item.deliveryLatencyMs === null ? [] : [item.deliveryLatencyMs],
  );
  const cutoffSamples = observations.filter(
    (item) => item.dataCutoffMet !== null,
  );
  const targetChecks = observations.map((item) => {
    const checks: boolean[] = [];
    if (item.sourceTargetMs !== null && item.sourceLatencyMs !== null) {
      checks.push(item.sourceLatencyMs < item.sourceTargetMs);
    }
    if (item.productTargetMs !== null && item.productLatencyMs !== null) {
      checks.push(item.productLatencyMs < item.productTargetMs);
    }
    if (item.deliveryTargetMs !== null && item.deliveryLatencyMs !== null) {
      checks.push(item.deliveryLatencyMs < item.deliveryTargetMs);
    }
    if (item.backlogTargetMs !== null && item.backlogAgeMs !== null) {
      checks.push(item.backlogAgeMs < item.backlogTargetMs);
    }
    if (item.dataCutoffMet !== null) checks.push(item.dataCutoffMet);
    return checks.length > 0 ? checks.every(Boolean) : null;
  });
  const targetChecked = targetChecks.filter(
    (value): value is boolean => value !== null,
  );
  const sent = observations.filter(
    (item) => item.delivery?.status === "SENT",
  ).length;
  const failed = observations.filter((item) =>
    ["FAILED", "RETRY"].includes(item.delivery?.status ?? ""),
  ).length;
  const adaptiveSamples = observations.flatMap((item) =>
    item.adaptive ? [item.adaptive] : [],
  );

  return {
    segment: cloneDimension(first.dimension),
    sampleCount: observations.length,
    successRate:
      observations.filter((item) => item.success).length / observations.length,
    targetMetRate:
      targetChecked.length > 0
        ? targetChecked.filter(Boolean).length / targetChecked.length
        : null,
    degradedRate:
      observations.filter((item) => item.degraded).length / observations.length,
    dataCutoffRate:
      cutoffSamples.length > 0
        ? cutoffSamples.filter((item) => item.dataCutoffMet).length /
          cutoffSamples.length
        : null,
    sourceLatencyMs: summary(sourceLatencies),
    productLatencyMs: summary(productLatencies),
    backlogAgeMs: summary(backlogAges),
    breachCount: breaches.length,
    alertCount: alerts.length,
    rollingTradingDays: [...tradingDays],
    permit: {
      acquired: observations.filter((item) => item.permit?.state === "ACQUIRED")
        .length,
      unavailable: observations.filter(
        (item) => item.permit?.state === "UNAVAILABLE",
      ).length,
      released: observations.filter((item) => item.permit?.state === "RELEASED")
        .length,
      expired: observations.filter((item) => item.permit?.state === "EXPIRED")
        .length,
      revoked: observations.filter((item) => item.permit?.state === "REVOKED")
        .length,
      averageWaitMs: average(waitTimes),
      p95WaitMs: percentile(waitTimes, 0.95),
      averageHeldMs: average(heldTimes),
    },
    circuit: {
      closed: observations.filter((item) => item.circuit?.state === "CLOSED")
        .length,
      open: observations.filter((item) => item.circuit?.state === "OPEN")
        .length,
      halfOpen: observations.filter(
        (item) => item.circuit?.state === "HALF_OPEN",
      ).length,
      configBlocked: observations.filter(
        (item) => item.circuit?.state === "CONFIG_BLOCKED",
      ).length,
    },
    usage: {
      requests: observations.reduce(
        (sum, item) => sum + item.usage.requests,
        0,
      ),
      inputTokens: observations.reduce(
        (sum, item) => sum + item.usage.inputTokens,
        0,
      ),
      outputTokens: observations.reduce(
        (sum, item) => sum + item.usage.outputTokens,
        0,
      ),
      costMicros: observations.reduce(
        (sum, item) => sum + item.usage.costMicros,
        0,
      ),
    },
    delivery: {
      attempts: observations.reduce(
        (sum, item) => sum + (item.delivery?.attempt ?? 0),
        0,
      ),
      sent,
      failed,
      p95LatencyMs: percentile(deliveryLatencies, 0.95),
    },
    adaptive: {
      samples: adaptiveSamples.length,
      increased: adaptiveSamples.filter(
        (item) => item.reason === "HEALTHY_STREAK_INCREASED",
      ).length,
      decreased: adaptiveSamples.filter((item) =>
        [
          "RATE_LIMITED_HALVED",
          "TIMEOUT_DECREASED",
          "LATENCY_HIGH_DECREASED",
        ].includes(item.reason),
      ).length,
      rateLimitedHalves: adaptiveSamples.filter(
        (item) => item.reason === "RATE_LIMITED_HALVED",
      ).length,
      restartConservative: adaptiveSamples.filter(
        (item) => item.reason === "RESTART_CONSERVATIVE",
      ).length,
      cooldownSamples: adaptiveSamples.filter(
        (item) =>
          item.cooldownUntil !== null && item.cooldownUntil !== undefined,
      ).length,
      maxCurrentConcurrency:
        adaptiveSamples.length > 0
          ? Math.max(...adaptiveSamples.map((item) => item.current))
          : null,
      hardLimit:
        adaptiveSamples.length > 0
          ? Math.max(...adaptiveSamples.map((item) => item.hardLimit))
          : null,
    },
  };
}

export class RuntimeObservabilityService {
  constructor(private readonly repository: RuntimeObservabilityRepository) {}

  async record(input: RuntimeObservationInput): Promise<RuntimeRecordResult> {
    const existing = await this.repository.findObservationByIdempotencyKey(
      input.idempotencyKey,
    );
    if (existing) {
      await this.recordOutcomes(existing);
      return this.withOutcomes(existing);
    }
    if (!input.idempotencyKey.trim()) throw new Error("运行观测幂等键不能为空");
    if (input.tradingDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.tradingDate)) {
      throw new Error("交易日必须使用 YYYY-MM-DD");
    }
    for (const [name, value] of [
      ["sourceClockAt", input.sourceClockAt],
      ["productClockAt", input.productClockAt],
      ["readyAt", input.readyAt],
      ["actualDataCutoff", input.actualDataCutoff],
      ["targetDataCutoff", input.targetDataCutoff],
      ["recordedAt", input.recordedAt],
      ["adaptive.cooldownUntil", input.adaptive?.cooldownUntil],
    ] as const) {
      assertValidDate(name, value);
    }
    for (const [name, value] of [
      ["sourceTargetMs", input.sourceTargetMs],
      ["productTargetMs", input.productTargetMs],
      ["deliveryTargetMs", input.deliveryTargetMs],
      ["backlogAgeMs", input.backlogAgeMs],
      ["backlogTargetMs", input.backlogTargetMs],
      ["permit.waitMs", input.permit?.waitMs],
      ["permit.heldMs", input.permit?.heldMs],
      ["usage.requests", input.usage?.requests],
      ["usage.inputTokens", input.usage?.inputTokens],
      ["usage.outputTokens", input.usage?.outputTokens],
      ["usage.costMicros", input.usage?.costMicros],
      ["delivery.attempt", input.delivery?.attempt],
      ["adaptive.previous", input.adaptive?.previous],
      ["adaptive.current", input.adaptive?.current],
      ["adaptive.hardLimit", input.adaptive?.hardLimit],
    ] as const) {
      validateNonNegative(name, value);
    }
    for (const [name, value] of [
      ["sourceTargetMs", input.sourceTargetMs],
      ["productTargetMs", input.productTargetMs],
      ["deliveryTargetMs", input.deliveryTargetMs],
      ["backlogTargetMs", input.backlogTargetMs],
    ] as const) {
      if (value !== null && value !== undefined && value <= 0) {
        throw new Error(`${name} 必须为正数`);
      }
    }
    if (
      input.adaptive &&
      (input.adaptive.previous < 1 ||
        input.adaptive.current < 1 ||
        input.adaptive.hardLimit < 1 ||
        input.adaptive.current > input.adaptive.hardLimit ||
        input.adaptive.previous > input.adaptive.hardLimit)
    ) {
      throw new Error("自适应并发必须为正数且不能超过资源池硬上限");
    }

    const readyAt = new Date(input.readyAt.getTime());
    const sourceClockAt = input.sourceClockAt
      ? new Date(input.sourceClockAt.getTime())
      : null;
    if (!sourceClockAt && input.sourceClockKind) {
      throw new Error("来源时钟类型必须和来源时钟同时提供");
    }
    const productClockAt = input.productClockAt
      ? new Date(input.productClockAt.getTime())
      : null;
    const actualDataCutoff = input.actualDataCutoff
      ? new Date(input.actualDataCutoff.getTime())
      : null;
    const targetDataCutoff = input.targetDataCutoff
      ? new Date(input.targetDataCutoff.getTime())
      : null;
    const dataCutoffMet = targetDataCutoff
      ? actualDataCutoff
        ? actualDataCutoff.getTime() >= targetDataCutoff.getTime()
        : false
      : null;
    const deliveryLatencyMs = input.delivery?.latencyMs ?? null;
    const defaultTargets = resolveRuntimeTargets({
      dataset: input.dataset,
      stage: input.stage,
      delivery: input.delivery !== undefined && input.delivery !== null,
    });
    validateNonNegative("delivery.latencyMs", deliveryLatencyMs);
    const observation: RuntimeObservation = {
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      metricKind:
        input.metricKind ??
        (input.delivery
          ? "DELIVERY"
          : input.permit || input.circuit || input.adaptive
            ? "RESOURCE"
            : input.source || input.dataset
              ? "DATA"
              : "PROCESSING"),
      dimension: {
        source: input.source ?? null,
        dataset: input.dataset ?? null,
        stage: input.stage ?? null,
        resourcePool: input.resourcePool ?? null,
      },
      tradingDate: input.tradingDate ?? null,
      sourceClockAt,
      sourceClockKind:
        input.sourceClockKind ??
        (sourceClockAt ? "UPSTREAM_AVAILABLE_AT" : null),
      productClockAt,
      readyAt,
      actualDataCutoff,
      targetDataCutoff,
      sourceLatencyMs: durationMs(sourceClockAt, readyAt),
      productLatencyMs: durationMs(productClockAt, readyAt),
      deliveryLatencyMs,
      dataCutoffMet,
      sourceTargetMs: input.sourceTargetMs ?? defaultTargets.sourceTargetMs,
      productTargetMs: input.productTargetMs ?? defaultTargets.productTargetMs,
      deliveryTargetMs:
        input.deliveryTargetMs ?? defaultTargets.deliveryTargetMs,
      backlogAgeMs: input.backlogAgeMs ?? null,
      backlogTargetMs: input.backlogTargetMs ?? null,
      success: input.success ?? true,
      degraded: input.degraded ?? false,
      permit: input.permit ? { ...input.permit } : null,
      circuit: input.circuit ? { ...input.circuit } : null,
      adaptive: input.adaptive
        ? {
            ...input.adaptive,
            cooldownUntil: input.adaptive.cooldownUntil
              ? new Date(input.adaptive.cooldownUntil.getTime())
              : null,
          }
        : null,
      usage: {
        requests: input.usage?.requests ?? (input.delivery ? 1 : 0),
        inputTokens: input.usage?.inputTokens ?? 0,
        outputTokens: input.usage?.outputTokens ?? 0,
        costMicros: input.usage?.costMicros ?? 0,
      },
      delivery: input.delivery ? { ...input.delivery } : null,
      errorClass: input.errorClass ?? null,
      recordedAt: input.recordedAt
        ? new Date(input.recordedAt.getTime())
        : new Date(),
    };

    const saved = await this.repository.saveObservation(observation);
    const breaches = await this.recordOutcomes(saved);
    return { ...saved, breaches, alerts: await this.alertsFor(saved.id) };
  }

  async recordResourceSnapshot(input: {
    idempotencyKey: string;
    resourcePool: string;
    stage?: string | null;
    tradingDate?: string | null;
    observedAt: Date;
    backlogAgeMs?: number | null;
    backlogTargetMs?: number | null;
    permit?: RuntimeObservationInput["permit"];
    circuit?: RuntimeObservationInput["circuit"];
    adaptive?: RuntimeObservationInput["adaptive"];
    usage?: RuntimeObservationInput["usage"];
    success?: boolean;
    degraded?: boolean;
    errorClass?: string | null;
  }) {
    return this.record({
      idempotencyKey: input.idempotencyKey,
      metricKind: "RESOURCE",
      resourcePool: input.resourcePool,
      stage: input.stage,
      tradingDate: input.tradingDate,
      sourceClockAt: null,
      productClockAt: null,
      readyAt: input.observedAt,
      actualDataCutoff: null,
      backlogAgeMs: input.backlogAgeMs,
      backlogTargetMs: input.backlogTargetMs,
      permit: input.permit,
      circuit: input.circuit,
      adaptive: input.adaptive,
      usage: input.usage,
      success: input.success,
      degraded: input.degraded,
      errorClass: input.errorClass,
    });
  }

  async query(filter: RuntimeMetricFilter = {}): Promise<RuntimeMetric[]> {
    const all = (await this.repository.listObservations()).filter(
      (item) => sameDimension(item, filter) && byTime(item, filter),
    );
    const days = [
      ...new Set(
        all.flatMap((item) => (item.tradingDate ? [item.tradingDate] : [])),
      ),
    ].sort();
    const asOf = filter.asOfTradingDate;
    const eligibleDays = days.filter((day) => !asOf || day <= asOf);
    const rollingCount = filter.rollingTradingDays ?? 20;
    const rollingDays = eligibleDays.slice(-Math.max(1, rollingCount));
    const shouldApplyRollingWindow =
      days.length > 0 &&
      (filter.rollingTradingDays !== undefined ||
        asOf !== undefined ||
        (filter.from === undefined && filter.to === undefined));
    const observations = shouldApplyRollingWindow
      ? all.filter(
          (item) =>
            item.tradingDate === null || rollingDays.includes(item.tradingDate),
        )
      : all;
    const groups = new Map<string, RuntimeObservation[]>();
    for (const item of observations) {
      const group = groups.get(segmentKey(item.dimension)) ?? [];
      group.push(item);
      groups.set(segmentKey(item.dimension), group);
    }
    const [breaches, alerts] = await Promise.all([
      this.repository.listBreaches(),
      this.repository.listAlerts(),
    ]);
    return [...groups.values()].map((group) => {
      const ids = new Set(group.map((item) => item.id));
      return buildMetric(
        group,
        breaches.filter((item) => ids.has(item.observationId)),
        alerts.filter((item) => ids.has(item.observationId)),
        rollingDays,
      );
    });
  }

  async listBreaches(filter: RuntimeMetricFilter = {}) {
    const observations = (await this.repository.listObservations()).filter(
      (item) => sameDimension(item, filter) && byTime(item, filter),
    );
    const ids = new Set(observations.map((item) => item.id));
    return (await this.repository.listBreaches()).filter((item) =>
      ids.has(item.observationId),
    );
  }

  async listAlerts(filter: RuntimeMetricFilter = {}) {
    const observations = (await this.repository.listObservations()).filter(
      (item) => sameDimension(item, filter) && byTime(item, filter),
    );
    const ids = new Set(observations.map((item) => item.id));
    return (await this.repository.listAlerts()).filter((item) =>
      ids.has(item.observationId),
    );
  }

  evaluateRelease(input: {
    checks: readonly RuntimeReleaseCheck[];
    runtimeBreaches: readonly string[];
  }): ReleaseEvaluation {
    return evaluateRelease(input);
  }

  async recordReleaseEvaluation(input: {
    evaluationKey: string;
    checks: readonly RuntimeReleaseCheck[];
    runtimeBreaches: readonly string[];
    checkedAt?: Date;
  }) {
    if (!input.evaluationKey.trim()) {
      throw new Error("发布评估幂等键不能为空");
    }
    const evaluation = evaluateRelease(input);
    return this.repository.saveReleaseEvaluation({
      ...evaluation,
      evaluationKey: input.evaluationKey,
      checks: input.checks.map((check) => ({ ...check })),
      checkedAt: input.checkedAt
        ? new Date(input.checkedAt.getTime())
        : new Date(),
    });
  }

  async listReleaseEvaluations() {
    return this.repository.listReleaseEvaluations();
  }

  private async withOutcomes(observation: RuntimeObservation) {
    return {
      ...cloneObservation(observation),
      breaches: (await this.repository.listBreaches()).filter(
        (item) => item.observationId === observation.id,
      ),
      alerts: (await this.repository.listAlerts()).filter(
        (item) => item.observationId === observation.id,
      ),
    };
  }

  private async alertsFor(observationId: string) {
    return (await this.repository.listAlerts()).filter(
      (item) => item.observationId === observationId,
    );
  }

  private async recordOutcomes(observation: RuntimeObservation) {
    const breaches: RuntimeBreach[] = [];
    const checks: Array<{
      kind: RuntimeBreach["kind"];
      observedMs: number | null;
      targetMs: number | null;
      reason: string;
    }> = [
      {
        kind: "SOURCE_CLOCK",
        observedMs: observation.sourceLatencyMs,
        targetMs: observation.sourceTargetMs,
        reason: "来源时钟时效目标达到或失守",
      },
      {
        kind: "PRODUCT_CLOCK",
        observedMs: observation.productLatencyMs,
        targetMs: observation.productTargetMs,
        reason: "产品时钟时效目标达到或失守",
      },
      {
        kind: "BACKLOG",
        observedMs: observation.backlogAgeMs,
        targetMs: observation.backlogTargetMs,
        reason: "积压年龄达到或失守运行预算",
      },
      {
        kind: "DELIVERY",
        observedMs: observation.deliveryLatencyMs,
        targetMs: observation.deliveryTargetMs,
        reason: "投递时效目标达到或失守",
      },
    ];
    for (const check of checks) {
      if (check.observedMs === null || check.targetMs === null) continue;
      if (check.observedMs >= check.targetMs * 0.5) {
        await this.recordThresholdAlerts(observation, check);
      }
      if (check.observedMs < check.targetMs) continue;
      const breach = await this.repository.saveBreach({
        id: randomUUID(),
        idempotencyKey: `${observation.idempotencyKey}:breach:${check.kind}`,
        observationId: observation.id,
        kind: check.kind,
        observedMs: check.observedMs,
        targetMs: check.targetMs,
        actualDataCutoff: observation.actualDataCutoff,
        targetDataCutoff: observation.targetDataCutoff,
        tradingDate: observation.tradingDate,
        reason: check.reason,
        occurredAt: observation.readyAt,
      });
      breaches.push(breach);
    }
    if (observation.dataCutoffMet === false) {
      const breach = await this.repository.saveBreach({
        id: randomUUID(),
        idempotencyKey: `${observation.idempotencyKey}:breach:DATA_CUTOFF`,
        observationId: observation.id,
        kind: "DATA_CUTOFF",
        observedMs:
          observation.actualDataCutoff && observation.targetDataCutoff
            ? Math.max(
                0,
                observation.targetDataCutoff.getTime() -
                  observation.actualDataCutoff.getTime(),
              )
            : null,
        targetMs: 0,
        actualDataCutoff: observation.actualDataCutoff,
        targetDataCutoff: observation.targetDataCutoff,
        tradingDate: observation.tradingDate,
        reason: "实际数据截止点未达到目标数据截止点",
        occurredAt: observation.readyAt,
      });
      breaches.push(breach);
    }
    if (observation.permit?.state === "UNAVAILABLE") {
      breaches.push(
        await this.recordAvailabilityBreach(
          observation,
          "PERMIT",
          "资源许可不可用，任务不能绕过全局许可继续执行",
        ),
      );
    }
    if (
      observation.circuit?.state === "OPEN" ||
      observation.circuit?.state === "CONFIG_BLOCKED"
    ) {
      breaches.push(
        await this.recordAvailabilityBreach(
          observation,
          "CIRCUIT",
          observation.circuit.state === "OPEN"
            ? "资源池熔断开启，拒绝新的外部调用"
            : "资源池配置阻断，拒绝新的外部调用",
        ),
      );
    }
    return breaches;
  }

  private async recordAvailabilityBreach(
    observation: RuntimeObservation,
    kind: "PERMIT" | "CIRCUIT",
    reason: string,
  ) {
    const breach = await this.repository.saveBreach({
      id: randomUUID(),
      idempotencyKey: `${observation.idempotencyKey}:breach:${kind}`,
      observationId: observation.id,
      kind,
      observedMs: null,
      targetMs: null,
      actualDataCutoff: observation.actualDataCutoff,
      targetDataCutoff: observation.targetDataCutoff,
      tradingDate: observation.tradingDate,
      reason,
      occurredAt: observation.readyAt,
    });
    await this.repository.saveAlert({
      id: randomUUID(),
      idempotencyKey: `${observation.idempotencyKey}:alert:${kind}:100`,
      observationId: observation.id,
      kind,
      thresholdPercent: 100,
      observedMs: null,
      targetMs: null,
      tradingDate: observation.tradingDate,
      message: `${reason}（严重告警）`,
      occurredAt: observation.readyAt,
    });
    return breach;
  }

  private async recordThresholdAlerts(
    observation: RuntimeObservation,
    check: {
      kind: RuntimeBreach["kind"];
      observedMs: number | null;
      targetMs: number | null;
      reason: string;
    },
  ) {
    if (check.observedMs === null || check.targetMs === null) return;
    const thresholdPercent = check.observedMs >= check.targetMs ? 100 : 50;
    if (check.observedMs < check.targetMs * 0.5) return;
    await this.repository.saveAlert({
      id: randomUUID(),
      idempotencyKey: `${observation.idempotencyKey}:alert:${check.kind}:${thresholdPercent}`,
      observationId: observation.id,
      kind: check.kind,
      thresholdPercent,
      observedMs: check.observedMs,
      targetMs: check.targetMs,
      tradingDate: observation.tradingDate,
      message: `${check.reason}（达到目标的 ${thresholdPercent}%）`,
      occurredAt: observation.readyAt,
    });
  }
}

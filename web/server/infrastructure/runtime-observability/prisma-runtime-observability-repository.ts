import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  RuntimeObservabilityRepository,
  RuntimeReleaseEvaluationRecord,
} from "~/server/application/runtime-observability/runtime-observability-service";
import type {
  RuntimeAlert,
  RuntimeBreach,
  RuntimeObservation,
} from "~/server/domain/runtime-observability/types";

type ObservationRow = {
  id: string;
  idempotencyKey: string;
  metricKind: string;
  sourceKey: string | null;
  datasetKey: string | null;
  stage: string | null;
  resourcePoolKey: string | null;
  tradingDate: string | null;
  sourceClockAt: Date | null;
  sourceClockKind: string | null;
  productClockAt: Date | null;
  readyAt: Date;
  actualDataCutoff: Date | null;
  targetDataCutoff: Date | null;
  sourceLatencyMs: number | null;
  productLatencyMs: number | null;
  deliveryLatencyMs: number | null;
  dataCutoffMet: boolean | null;
  sourceTargetMs: number | null;
  productTargetMs: number | null;
  deliveryTargetMs: number | null;
  backlogAgeMs: number | null;
  backlogTargetMs: number | null;
  success: boolean;
  degraded: boolean;
  permitState: string | null;
  permitWaitMs: number | null;
  permitHeldMs: number | null;
  circuitState: string | null;
  previousConcurrency: number | null;
  currentConcurrency: number | null;
  hardConcurrency: number | null;
  adaptiveReason: string | null;
  cooldownUntil: Date | null;
  usageRequests: number;
  usageInputTokens: number;
  usageOutputTokens: number;
  usageCostMicros: number;
  deliveryChannel: string | null;
  deliveryStatus: string | null;
  deliveryAttempt: number | null;
  errorClass: string | null;
  observationContextJson: unknown | null;
  recordedAt: Date;
};

type BreachRow = {
  id: string;
  idempotencyKey: string;
  observationId: string;
  kind: string;
  observedMs: number | null;
  targetMs: number | null;
  actualDataCutoff: Date | null;
  targetDataCutoff: Date | null;
  tradingDate: string | null;
  reason: string;
  occurredAt: Date;
};

type AlertRow = {
  id: string;
  idempotencyKey: string;
  observationId: string;
  kind: string;
  thresholdPercent: number;
  observedMs: number | null;
  targetMs: number | null;
  tradingDate: string | null;
  message: string;
  occurredAt: Date;
};

type ReleaseEvaluationRow = {
  evaluationKey: string;
  allowed: boolean;
  checksJson: unknown;
  hardGateFailuresJson: unknown;
  manualChecksJson: unknown;
  runtimeBreachesJson: unknown;
  degradationJson: unknown;
  checkedAt: Date;
};

const observationColumns = Prisma.sql`
  "id", "idempotencyKey", "metricKind", "sourceKey", "datasetKey", "stage",
  "resourcePoolKey", "tradingDate", "sourceClockAt", "productClockAt", "readyAt",
  "sourceClockKind",
  "actualDataCutoff", "targetDataCutoff", "sourceLatencyMs", "productLatencyMs",
  "deliveryLatencyMs", "dataCutoffMet", "sourceTargetMs", "productTargetMs",
  "deliveryTargetMs", "backlogAgeMs", "backlogTargetMs", "success", "degraded",
  "permitState", "permitWaitMs", "permitHeldMs", "circuitState", "usageRequests",
  "previousConcurrency", "currentConcurrency", "hardConcurrency", "adaptiveReason", "cooldownUntil",
  "usageInputTokens", "usageOutputTokens", "usageCostMicros", "deliveryChannel",
  "deliveryStatus", "deliveryAttempt", "errorClass", "observationContextJson", "recordedAt"
`;

const breachColumns = Prisma.sql`
  "id", "idempotencyKey", "observationId", "kind", "observedMs", "targetMs",
  "actualDataCutoff", "targetDataCutoff", "tradingDate", "reason", "occurredAt"
`;

const alertColumns = Prisma.sql`
  "id", "idempotencyKey", "observationId", "kind", "thresholdPercent", "observedMs",
  "targetMs", "tradingDate", "message", "occurredAt"
`;

const releaseEvaluationColumns = Prisma.sql`
  "evaluationKey", "allowed", "checksJson", "hardGateFailuresJson", "manualChecksJson",
  "runtimeBreachesJson", "degradationJson", "checkedAt"
`;

export class PrismaRuntimeObservabilityRepository
  implements RuntimeObservabilityRepository
{
  constructor(private readonly db: PrismaClient) {}

  async findObservationByIdempotencyKey(idempotencyKey: string) {
    const rows = await this.db.$queryRaw<ObservationRow[]>(Prisma.sql`
      SELECT ${observationColumns}
        FROM "ResearchRuntimeObservation"
       WHERE "idempotencyKey" = ${idempotencyKey}
    `);
    return rows[0] ? mapObservation(rows[0]) : null;
  }

  async saveObservation(observation: RuntimeObservation) {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO "ResearchRuntimeObservation" (
        "id", "idempotencyKey", "metricKind", "sourceKey", "datasetKey", "stage",
        "resourcePoolKey", "tradingDate", "sourceClockAt", "sourceClockKind", "productClockAt", "readyAt",
        "actualDataCutoff", "targetDataCutoff", "sourceLatencyMs", "productLatencyMs",
        "deliveryLatencyMs", "dataCutoffMet", "sourceTargetMs", "productTargetMs",
        "deliveryTargetMs", "backlogAgeMs", "backlogTargetMs", "success", "degraded",
        "permitState", "permitWaitMs", "permitHeldMs", "circuitState",
        "previousConcurrency", "currentConcurrency", "hardConcurrency", "adaptiveReason", "cooldownUntil",
        "usageRequests",
        "usageInputTokens", "usageOutputTokens", "usageCostMicros", "deliveryChannel",
        "deliveryStatus", "deliveryAttempt", "errorClass", "observationContextJson", "recordedAt", "createdAt"
      ) VALUES (
        ${observation.id}, ${observation.idempotencyKey}, ${observation.metricKind},
        ${observation.dimension.source}, ${observation.dimension.dataset},
        ${observation.dimension.stage}, ${observation.dimension.resourcePool},
        ${observation.tradingDate}, ${observation.sourceClockAt},
        ${observation.sourceClockKind}, ${observation.productClockAt},
        ${observation.readyAt}, ${observation.actualDataCutoff}, ${observation.targetDataCutoff},
        ${observation.sourceLatencyMs}, ${observation.productLatencyMs}, ${observation.deliveryLatencyMs},
        ${observation.dataCutoffMet}, ${observation.sourceTargetMs}, ${observation.productTargetMs},
        ${observation.deliveryTargetMs}, ${observation.backlogAgeMs}, ${observation.backlogTargetMs},
        ${observation.success}, ${observation.degraded}, ${observation.permit?.state ?? null},
        ${observation.permit?.waitMs ?? null}, ${observation.permit?.heldMs ?? null},
        ${observation.circuit?.state ?? null}, ${observation.adaptive?.previous ?? null},
        ${observation.adaptive?.current ?? null}, ${observation.adaptive?.hardLimit ?? null},
        ${observation.adaptive?.reason ?? null}, ${observation.adaptive?.cooldownUntil ?? null},
        ${observation.usage.requests},
        ${observation.usage.inputTokens}, ${observation.usage.outputTokens}, ${observation.usage.costMicros},
        ${observation.delivery?.channel ?? null}, ${observation.delivery?.status ?? null},
        ${observation.delivery?.attempt ?? null}, ${observation.errorClass},
        CAST(${observation.context ? JSON.stringify(observation.context) : null} AS JSONB),
        ${observation.recordedAt}, CURRENT_TIMESTAMP
      ) ON CONFLICT ("idempotencyKey") DO NOTHING
    `);
    const saved = await this.findObservationByIdempotencyKey(
      observation.idempotencyKey,
    );
    if (!saved) throw new Error("运行观测持久化失败");
    return saved;
  }

  async saveBreach(breach: RuntimeBreach) {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO "ResearchRuntimeBreach" (
        "id", "idempotencyKey", "observationId", "kind", "observedMs", "targetMs",
        "actualDataCutoff", "targetDataCutoff", "tradingDate", "reason", "occurredAt"
      ) VALUES (
        ${breach.id}, ${breach.idempotencyKey}, ${breach.observationId}, ${breach.kind},
        ${breach.observedMs}, ${breach.targetMs}, ${breach.actualDataCutoff},
        ${breach.targetDataCutoff}, ${breach.tradingDate}, ${breach.reason}, ${breach.occurredAt}
      ) ON CONFLICT ("idempotencyKey") DO NOTHING
    `);
    const rows = await this.db.$queryRaw<BreachRow[]>(Prisma.sql`
      SELECT ${breachColumns} FROM "ResearchRuntimeBreach"
       WHERE "idempotencyKey" = ${breach.idempotencyKey}
    `);
    if (!rows[0]) throw new Error("运行目标违约持久化失败");
    return mapBreach(rows[0]);
  }

  async saveAlert(alert: RuntimeAlert) {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO "ResearchRuntimeAlert" (
        "id", "idempotencyKey", "observationId", "kind", "thresholdPercent", "observedMs",
        "targetMs", "tradingDate", "message", "occurredAt"
      ) VALUES (
        ${alert.id}, ${alert.idempotencyKey}, ${alert.observationId}, ${alert.kind},
        ${alert.thresholdPercent}, ${alert.observedMs}, ${alert.targetMs}, ${alert.tradingDate},
        ${alert.message}, ${alert.occurredAt}
      ) ON CONFLICT ("idempotencyKey") DO NOTHING
    `);
    const rows = await this.db.$queryRaw<AlertRow[]>(Prisma.sql`
      SELECT ${alertColumns} FROM "ResearchRuntimeAlert"
       WHERE "idempotencyKey" = ${alert.idempotencyKey}
    `);
    if (!rows[0]) throw new Error("运行目标告警持久化失败");
    return mapAlert(rows[0]);
  }

  async listObservations() {
    const rows = await this.db.$queryRaw<ObservationRow[]>(Prisma.sql`
      SELECT ${observationColumns}
        FROM "ResearchRuntimeObservation"
       ORDER BY "recordedAt" ASC, "id" ASC
    `);
    return rows.map(mapObservation);
  }

  async listBreaches() {
    const rows = await this.db.$queryRaw<BreachRow[]>(Prisma.sql`
      SELECT ${breachColumns}
        FROM "ResearchRuntimeBreach"
       ORDER BY "occurredAt" ASC, "id" ASC
    `);
    return rows.map(mapBreach);
  }

  async listAlerts() {
    const rows = await this.db.$queryRaw<AlertRow[]>(Prisma.sql`
      SELECT ${alertColumns}
        FROM "ResearchRuntimeAlert"
       ORDER BY "occurredAt" ASC, "id" ASC
    `);
    return rows.map(mapAlert);
  }

  async saveReleaseEvaluation(evaluation: RuntimeReleaseEvaluationRecord) {
    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO "ResearchReleaseEvaluation" (
        "id", "evaluationKey", "allowed", "checksJson", "hardGateFailuresJson", "manualChecksJson",
        "runtimeBreachesJson", "degradationJson", "checkedAt"
      ) VALUES (
        ${randomUUID()}, ${evaluation.evaluationKey}, ${evaluation.allowed},
        CAST(${JSON.stringify(evaluation.checks)} AS JSONB),
        CAST(${JSON.stringify(evaluation.hardGateFailures)} AS JSONB),
        CAST(${JSON.stringify(evaluation.manualChecks)} AS JSONB),
        CAST(${JSON.stringify(evaluation.runtimeBreaches)} AS JSONB),
        CAST(${JSON.stringify(evaluation.runtimeDegradation)} AS JSONB),
        ${evaluation.checkedAt}
      ) ON CONFLICT ("evaluationKey") DO NOTHING
    `);
    const rows = await this.db.$queryRaw<ReleaseEvaluationRow[]>(Prisma.sql`
      SELECT ${releaseEvaluationColumns}
        FROM "ResearchReleaseEvaluation"
       WHERE "evaluationKey" = ${evaluation.evaluationKey}
    `);
    if (!rows[0]) throw new Error("发布评估持久化失败");
    return mapReleaseEvaluation(rows[0]);
  }

  async listReleaseEvaluations() {
    const rows = await this.db.$queryRaw<ReleaseEvaluationRow[]>(Prisma.sql`
      SELECT ${releaseEvaluationColumns}
        FROM "ResearchReleaseEvaluation"
       ORDER BY "checkedAt" ASC, "evaluationKey" ASC
    `);
    return rows.map(mapReleaseEvaluation);
  }

  async listAuthoritativeRuntimeBreachKeys() {
    const [breaches, failedStages] = await Promise.all([
      this.db.$queryRaw<Array<{ id: string; kind: string }>>(Prisma.sql`
        SELECT "id", "kind"
          FROM "ResearchRuntimeBreach"
         ORDER BY "occurredAt" ASC, "id" ASC
      `),
      this.db.$queryRaw<
        Array<{ id: string; stage: string | null; errorClass: string | null }>
      >(Prisma.sql`
        SELECT "id", "stage", "errorClass"
          FROM "ResearchRuntimeObservation"
         WHERE "success" = FALSE OR "degraded" = TRUE
         ORDER BY "recordedAt" ASC, "id" ASC
      `),
    ]);
    return [
      ...breaches.map((item) => `${item.kind}:${item.id}`),
      ...failedStages.map(
        (item) =>
          `STAGE:${item.stage ?? "unknown"}:${item.errorClass ?? "DEGRADED"}:${item.id}`,
      ),
    ];
  }
}

function mapObservation(row: ObservationRow): RuntimeObservation {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    metricKind: row.metricKind as RuntimeObservation["metricKind"],
    dimension: {
      source: row.sourceKey,
      dataset: row.datasetKey,
      stage: row.stage,
      resourcePool: row.resourcePoolKey,
    },
    tradingDate: row.tradingDate,
    sourceClockAt: row.sourceClockAt,
    sourceClockKind:
      row.sourceClockKind as RuntimeObservation["sourceClockKind"],
    productClockAt: row.productClockAt,
    readyAt: row.readyAt,
    actualDataCutoff: row.actualDataCutoff,
    targetDataCutoff: row.targetDataCutoff,
    sourceLatencyMs: row.sourceLatencyMs,
    productLatencyMs: row.productLatencyMs,
    deliveryLatencyMs: row.deliveryLatencyMs,
    dataCutoffMet: row.dataCutoffMet,
    sourceTargetMs: row.sourceTargetMs,
    productTargetMs: row.productTargetMs,
    deliveryTargetMs: row.deliveryTargetMs,
    backlogAgeMs: row.backlogAgeMs,
    backlogTargetMs: row.backlogTargetMs,
    success: row.success,
    degraded: row.degraded,
    permit: row.permitState
      ? {
          state: row.permitState as NonNullable<
            RuntimeObservation["permit"]
          >["state"],
          waitMs: row.permitWaitMs ?? undefined,
          heldMs: row.permitHeldMs ?? undefined,
        }
      : null,
    circuit: row.circuitState
      ? {
          state: row.circuitState as NonNullable<
            RuntimeObservation["circuit"]
          >["state"],
        }
      : null,
    adaptive:
      row.previousConcurrency !== null &&
      row.currentConcurrency !== null &&
      row.hardConcurrency !== null &&
      row.adaptiveReason !== null
        ? {
            previous: row.previousConcurrency,
            current: row.currentConcurrency,
            hardLimit: row.hardConcurrency,
            reason: row.adaptiveReason as NonNullable<
              RuntimeObservation["adaptive"]
            >["reason"],
            cooldownUntil: row.cooldownUntil,
          }
        : null,
    usage: {
      requests: row.usageRequests,
      inputTokens: row.usageInputTokens,
      outputTokens: row.usageOutputTokens,
      costMicros: row.usageCostMicros,
    },
    delivery: row.deliveryChannel
      ? {
          channel: row.deliveryChannel,
          status: row.deliveryStatus as NonNullable<
            RuntimeObservation["delivery"]
          >["status"],
          attempt: row.deliveryAttempt ?? undefined,
          latencyMs: row.deliveryLatencyMs ?? undefined,
        }
      : null,
    errorClass: row.errorClass,
    context: row.observationContextJson as RuntimeObservation["context"],
    recordedAt: row.recordedAt,
  };
}

function mapBreach(row: BreachRow): RuntimeBreach {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    observationId: row.observationId,
    kind: row.kind as RuntimeBreach["kind"],
    observedMs: row.observedMs,
    targetMs: row.targetMs,
    actualDataCutoff: row.actualDataCutoff,
    targetDataCutoff: row.targetDataCutoff,
    tradingDate: row.tradingDate,
    reason: row.reason,
    occurredAt: row.occurredAt,
  };
}

function mapAlert(row: AlertRow): RuntimeAlert {
  return {
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    observationId: row.observationId,
    kind: row.kind as RuntimeAlert["kind"],
    thresholdPercent: row.thresholdPercent as RuntimeAlert["thresholdPercent"],
    observedMs: row.observedMs,
    targetMs: row.targetMs,
    tradingDate: row.tradingDate,
    message: row.message,
    occurredAt: row.occurredAt,
  };
}

function mapReleaseEvaluation(
  row: ReleaseEvaluationRow,
): RuntimeReleaseEvaluationRecord {
  return {
    evaluationKey: row.evaluationKey,
    allowed: row.allowed,
    checks: row.checksJson as RuntimeReleaseEvaluationRecord["checks"],
    hardGateFailures:
      row.hardGateFailuresJson as RuntimeReleaseEvaluationRecord["hardGateFailures"],
    manualChecks:
      row.manualChecksJson as RuntimeReleaseEvaluationRecord["manualChecks"],
    runtimeBreaches: row.runtimeBreachesJson as string[],
    runtimeDegradation:
      row.degradationJson as RuntimeReleaseEvaluationRecord["runtimeDegradation"],
    checkedAt: row.checkedAt,
  };
}

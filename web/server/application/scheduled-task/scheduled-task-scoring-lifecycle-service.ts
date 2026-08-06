import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  type DeterministicExecutionPlan,
  scheduleSpecSchema,
} from "~/server/domain/scheduled-task/contracts";
import type { ScheduleSpec } from "~/server/domain/scheduled-task/schedule";
import { publishDefinitiveTaskRun } from "./definitive-task-run-stream";

type PreviewUniverse = DeterministicExecutionPlan["universe"];

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

export function scoringPreviewFingerprint(params: {
  executionPlan: unknown;
  scheduleSpec: unknown;
}) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(params)), "utf8")
    .digest("hex");
}

function normalizeSample(values: string[]) {
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => !/^\d{6}$/.test(value)))
    throw new Error("PREVIEW_SAMPLE_INVALID");
  if (new Set(normalized).size !== normalized.length)
    throw new Error("PREVIEW_SAMPLE_DUPLICATED");
  if (normalized.length < 1) throw new Error("PREVIEW_SAMPLE_REQUIRED");
  if (normalized.length > 20) throw new Error("PREVIEW_SAMPLE_LIMIT");
  return normalized;
}

export function resolvePreviewSample(
  universe: PreviewUniverse,
  requested: string[] | undefined,
) {
  if (universe.type === "all_a_shares") {
    if (!requested?.length) throw new Error("PREVIEW_SAMPLE_REQUIRED");
    return normalizeSample(requested);
  }
  if (!requested?.length) return universe.stockCodes.slice(0, 5);
  const sample = normalizeSample(requested);
  const available = new Set(universe.stockCodes);
  if (sample.some((code) => !available.has(code)))
    throw new Error("PREVIEW_SAMPLE_OUTSIDE_UNIVERSE");
  return sample;
}

export function summarizePreviewGate(params: {
  minScore: number;
  results: Array<{
    evaluationStatus: string;
    score: number;
    minimumPossibleScore: number;
    maximumPossibleScore: number;
  }>;
  warnings: unknown[];
}) {
  const evaluated = params.results.filter(
    (item) => item.evaluationStatus !== "NONE",
  );
  const warnings = params.warnings.map((item) =>
    typeof item === "string" ? item : JSON.stringify(item),
  );
  if (evaluated.length === 0)
    return {
      canActivate: false,
      evaluatedCount: 0,
      sampleCount: params.results.length,
      warnings: [...warnings, "全部样本无法评估"],
    };
  if (evaluated.length < params.results.length)
    warnings.push("部分样本无法评估");
  const highestScore = Math.max(...evaluated.map((item) => item.score));
  if (params.minScore > highestScore)
    warnings.push("最低分高于样本最高分，预期零入选");
  return {
    canActivate: true,
    evaluatedCount: evaluated.length,
    sampleCount: params.results.length,
    warnings,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export class ScheduledTaskScoringLifecycleService {
  constructor(
    private readonly db: PrismaClient,
    private readonly publish: (
      executionId: string,
    ) => Promise<unknown> = publishDefinitiveTaskRun,
  ) {}

  async startPreview(params: {
    userId: string;
    taskId: string;
    expectedVersion: number;
    sampleStockCodes?: string[];
    idempotencyKey: string;
  }) {
    const duplicate = await this.db.scheduledTaskExecution.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
      include: { task: { select: { userId: true } } },
    });
    if (duplicate) {
      if (duplicate.task.userId !== params.userId)
        throw new Error("PREVIEW_NOT_FOUND");
      return { previewId: duplicate.id, status: duplicate.status };
    }
    const task = await this.db.scheduledTask.findFirst({
      where: {
        id: params.taskId,
        userId: params.userId,
        status: "DRAFT",
        currentVersion: params.expectedVersion,
      },
      include: {
        versions: { where: { version: params.expectedVersion }, take: 1 },
      },
    });
    const version = task?.versions[0];
    if (!task || !version) throw new Error("PREVIEW_VERSION_CONFLICT");
    const plan = version.executionPlan as unknown as DeterministicExecutionPlan;
    const sampleStockCodes = resolvePreviewSample(
      plan.universe,
      params.sampleStockCodes,
    );
    const executionPlanOverride = {
      ...plan,
      universe: { type: "stocks", stockCodes: sampleStockCodes },
    } as unknown as Prisma.InputJsonObject;
    const previewSourceFingerprint = scoringPreviewFingerprint({
      executionPlan: version.executionPlan,
      scheduleSpec: version.scheduleSpec,
    });
    const execution = await this.db.scheduledTaskExecution.create({
      data: {
        taskId: task.id,
        taskVersionId: version.id,
        scheduledAt: new Date(),
        status: "PENDING",
        trigger: "PREVIEW",
        deliveryRequested: false,
        idempotencyKey: params.idempotencyKey,
        executionPlanOverride,
        previewSourceFingerprint,
      },
      select: { id: true, status: true },
    });
    try {
      await this.publish(execution.id);
      await this.db.scheduledTaskExecution.updateMany({
        where: { id: execution.id, status: "PENDING" },
        data: { status: "SUBMITTED" },
      });
      return { previewId: execution.id, status: "SUBMITTED" as const };
    } catch (error) {
      await this.db.scheduledTaskExecution.update({
        where: { id: execution.id },
        data: {
          error: {
            code: "PREVIEW_QUEUE_UNAVAILABLE",
            message: error instanceof Error ? error.message : String(error),
          },
        },
      });
      return { previewId: execution.id, status: "PENDING" as const };
    }
  }

  async getPreview(params: { userId: string; previewId: string }) {
    const execution = await this.db.scheduledTaskExecution.findFirst({
      where: {
        id: params.previewId,
        trigger: "PREVIEW",
        task: { userId: params.userId },
      },
      include: {
        task: { select: { currentVersion: true } },
        taskVersion: {
          select: { version: true, executionPlan: true, scheduleSpec: true },
        },
        scoreResults: { orderBy: { rank: "asc" } },
      },
    });
    if (!execution) throw new Error("PREVIEW_NOT_FOUND");
    const result = record(execution.result);
    const plan = execution.taskVersion
      .executionPlan as unknown as DeterministicExecutionPlan;
    const warnings = Array.isArray(result.warnings) ? result.warnings : [];
    const gate =
      execution.status === "SUCCEEDED"
        ? summarizePreviewGate({
            minScore: plan.selection.minScore,
            results: execution.scoreResults,
            warnings,
          })
        : null;
    const fingerprintValid =
      execution.previewSourceFingerprint ===
      scoringPreviewFingerprint({
        executionPlan: execution.taskVersion.executionPlan,
        scheduleSpec: execution.taskVersion.scheduleSpec,
      });
    return {
      previewId: execution.id,
      status: execution.status,
      taskVersion: execution.taskVersion.version,
      valid:
        execution.taskVersion.version === execution.task.currentVersion &&
        fingerprintValid,
      sampleStockCodes: execution.scoreResults.map((item) => item.stockCode),
      dataCutoff: typeof result.asOfDate === "string" ? result.asOfDate : null,
      results: execution.scoreResults,
      warnings: gate?.warnings ?? warnings,
      canActivate: gate?.canActivate ?? false,
      error: execution.error,
    };
  }

  async activate(params: {
    userId: string;
    taskId: string;
    expectedVersion: number;
    previewId: string;
    resolveNextRunAt: (schedule: ScheduleSpec) => Promise<Date | null>;
  }) {
    const preview = await this.db.scheduledTaskExecution.findFirst({
      where: {
        id: params.previewId,
        taskId: params.taskId,
        trigger: "PREVIEW",
        status: "SUCCEEDED",
        taskVersion: { version: params.expectedVersion },
        task: {
          userId: params.userId,
          status: "DRAFT",
          currentVersion: params.expectedVersion,
        },
      },
      include: { taskVersion: true, scoreResults: true },
    });
    if (!preview) throw new Error("PREVIEW_REQUIRED");
    if (
      preview.previewSourceFingerprint !==
      scoringPreviewFingerprint({
        executionPlan: preview.taskVersion.executionPlan,
        scheduleSpec: preview.taskVersion.scheduleSpec,
      })
    )
      throw new Error("PREVIEW_REQUIRED");
    const plan = preview.taskVersion
      .executionPlan as unknown as DeterministicExecutionPlan;
    const result = record(preview.result);
    const gate = summarizePreviewGate({
      minScore: plan.selection.minScore,
      results: preview.scoreResults,
      warnings: Array.isArray(result.warnings) ? result.warnings : [],
    });
    if (!gate.canActivate) throw new Error("PREVIEW_NOT_EVALUABLE");
    const schedule = scheduleSpecSchema.parse(preview.taskVersion.scheduleSpec);
    const nextRunAt = await params.resolveNextRunAt(schedule);
    if (!nextRunAt) throw new Error("NEXT_RUN_UNAVAILABLE");
    const updated = await this.db.scheduledTask.updateMany({
      where: {
        id: params.taskId,
        userId: params.userId,
        status: "DRAFT",
        currentVersion: params.expectedVersion,
      },
      data: { status: "ACTIVE", nextRunAt },
    });
    if (updated.count !== 1) throw new Error("PREVIEW_VERSION_CONFLICT");
    return {
      taskId: params.taskId,
      status: "ACTIVE" as const,
      warnings: gate.warnings,
    };
  }
}

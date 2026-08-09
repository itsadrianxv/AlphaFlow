import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  type ResearchProductionInput,
  researchEventClaimTypeSchema,
  researchProductionInputSchema,
} from "~/contracts/research-production";
import type { ResearchAssessmentLlmAdapter } from "~/server/application/research-assessment/research-assessment-service";
import type { FeishuDeliveryPort } from "~/server/application/research-distribution/research-distribution-service";
import { ProductionRuntimeObserver } from "~/server/application/runtime-observability/production-runtime-observer";
import type { PostgresResearchScheduler } from "~/server/application/scheduling/postgres-research-scheduler";
import { runResearchProduction } from "./production";

export const CANDIDATE_TASK_TYPE = "research.candidate-adjudication.v1";
export const CANDIDATE_RULE_VERSION = "candidate-discovery.rules.v1";
export const CANDIDATE_POOL_KEY = "deepseek:candidate-adjudication";

const hashSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);

const sourceReferenceSchema = z
  .object({
    sourceType: z.enum([
      "SOURCE_ASSERTION",
      "OBSERVATION_REVISION",
      "PUBLIC_WEB",
    ]),
    sourceKey: z.string().trim().min(1),
    summary: z.string().trim().min(1),
    href: z.string().url().optional(),
  })
  .strict();

export const researchCandidateSeedSchema = z
  .object({
    contractVersion: z.literal("research-candidate-seed.v1"),
    idempotencyKey: z.string().trim().min(1),
    triggerSource: z.enum(["IMMEDIATE_RESEARCH", "CONTROLLER_FOLLOW_UP"]),
    runId: z.string().trim().min(1),
    scope: z.string().trim().min(1),
    subject: z
      .object({ type: z.string().trim().min(1), key: z.string().trim().min(1) })
      .strict(),
    question: z.string().trim().min(1),
    outputMode: z.literal("research_only").default("research_only"),
    sourceReferences: z.array(sourceReferenceSchema).min(1).max(50),
  })
  .strict();

export type ResearchCandidateSeed = z.infer<typeof researchCandidateSeedSchema>;

const frozenEvidenceSchema = z
  .object({
    evidenceKey: z.string().min(1),
    kind: z.enum(["MATERIAL", "OBSERVATION_REVISION"]),
    sourceAssertionId: z.string().optional(),
    observationRevisionId: z.string().optional(),
    material: z
      .object({
        materialKey: z.string(),
        sourceAssertionId: z.string().optional(),
        sourceItemKey: z.string().optional(),
        normalizedUrl: z.string().url().optional(),
        contentHash: hashSchema,
        rawContent: z.record(z.unknown()),
        publishedAt: z.string().datetime().optional(),
        fetchedAt: z.string().datetime(),
      })
      .optional(),
    summary: z.string(),
  })
  .strict();

export const candidateTaskInputSchema = z
  .object({
    contractVersion: z.literal("candidate-production-task.v1"),
    triggerSource: z.enum([
      "AUTHORITATIVE_OBSERVATION",
      "IMMEDIATE_RESEARCH",
      "CONTROLLER_FOLLOW_UP",
    ]),
    candidateRuleVersion: z.literal(CANDIDATE_RULE_VERSION),
    seedIdempotencyKey: z.string().optional(),
    observationRevisionId: z.string().optional(),
    subject: z.object({ type: z.string(), key: z.string() }).strict(),
    question: z.string(),
    knownAt: z.string().datetime(),
    evidence: z.array(frozenEvidenceSchema).min(1),
  })
  .strict();

export type CandidateTaskInput = z.infer<typeof candidateTaskInputSchema>;

const evidenceDecisionSchema = z
  .object({
    evidenceKey: z.string().min(1),
    evidenceRole: z.enum(["CORE_FACT", "CONTEXT", "COUNTER_EVIDENCE"]),
    sourceIdentityStatus: z.enum(["VERIFIED", "UNVERIFIED", "UNKNOWN"]),
    proofQualification: z.enum([
      "QUALIFIED",
      "CORROBORATING_ONLY",
      "NOT_QUALIFIED",
    ]),
    independenceKey: z.string().min(1),
    citation: z.record(z.unknown()),
  })
  .strict();

const adjudicationBodySchema = z
  .object({
    outcome: z.enum(["PROMOTE", "DEFER", "REJECT", "TECHNICAL_HOLD"]),
    title: z.string().min(1).optional(),
    summary: z.string().min(1).optional(),
    occurredAt: z.string().datetime().optional(),
    knownAt: z.string().datetime().optional(),
    narrative: z
      .object({
        impact: z.string().min(1),
        reasons: z.array(z.string().min(1)).min(1).max(20),
        nextChecks: z.array(z.string().min(1)).max(20),
        risks: z.array(z.string().min(1)).max(20),
      })
      .strict()
      .optional(),
    uncertainty: z.record(z.unknown()).default({}),
    counterEvidence: z.record(z.unknown()).default({}),
    claims: z
      .array(
        z
          .object({
            claimKey: z.string().min(1),
            claimType: researchEventClaimTypeSchema,
            text: z.string().min(1),
            isInference: z.boolean().default(false),
            evidenceKeys: z.array(z.string().min(1)).min(1),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    impacts: z
      .array(
        z
          .object({
            subjectType: z.string().min(1),
            subjectKey: z.string().min(1),
            impactType: z.enum(["DIRECT", "INDIRECT"]),
            materiality: z.enum(["LOW", "MEDIUM", "HIGH"]),
            path: z.array(z.string().min(1)).max(20),
          })
          .strict(),
      )
      .max(50)
      .default([]),
    observationWindowEndsAt: z.string().datetime().optional(),
    nextCheckAt: z.string().datetime().optional(),
  })
  .strict();

export const candidateAdjudicationOutputSchema = z
  .object({
    contractVersion: z.literal("candidate-adjudication-output.v1"),
    candidate: z
      .object({
        eventIdentityKey: z.string().min(1),
        clusterKey: z.string().min(1),
      })
      .strict(),
    evidence: z.array(evidenceDecisionSchema).min(1),
    adjudication: adjudicationBodySchema,
  })
  .strict();

export type CandidateAdjudicationOutput = z.infer<
  typeof candidateAdjudicationOutputSchema
>;

export interface CandidateAdjudicationAdapter {
  adjudicate(input: CandidateTaskInput): Promise<unknown>;
}

type ProductionDependencies = {
  assessmentLlm?: ResearchAssessmentLlmAdapter;
  clock?: () => Date;
  feishu?: FeishuDeliveryPort;
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hashJson(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(canonicalJson(value)) as Prisma.InputJsonValue;
}

function textFromRecord(value: Prisma.JsonValue, ...keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const field = record[key];
    if (typeof field === "string" && field.trim()) return field.trim();
  }
  return "";
}

function publicHref(value: string) {
  return value.startsWith("https://") || value.startsWith("http://")
    ? value
    : undefined;
}

export class CandidateProductionScheduler {
  constructor(
    private readonly db: PrismaClient,
    private readonly scheduler: PostgresResearchScheduler,
  ) {}

  async scheduleAuthorityInputs(input: { poolId: string; limit?: number }) {
    const existing = await this.db.researchTask.findMany({
      where: { taskType: CANDIDATE_TASK_TYPE },
      select: { inputJson: true },
    });
    const processed = new Set(
      existing
        .map((task) => {
          const value = task.inputJson as Record<string, unknown>;
          return typeof value.observationRevisionId === "string"
            ? value.observationRevisionId
            : undefined;
        })
        .filter((value): value is string => Boolean(value)),
    );
    const revisions = await this.db.dataObservationRevision.findMany({
      where: processed.size > 0 ? { id: { notIn: [...processed] } } : undefined,
      include: {
        observation: true,
        revisionSources: { include: { sourceAssertion: true } },
      },
      orderBy: [{ normalizedAt: "asc" }, { id: "asc" }],
      take: input.limit ?? 100,
    });
    let accepted = 0;
    let deduplicated = 0;
    let rejected = 0;
    for (const revision of revisions) {
      const frozen = candidateTaskInputSchema.parse({
        contractVersion: "candidate-production-task.v1",
        triggerSource: "AUTHORITATIVE_OBSERVATION",
        candidateRuleVersion: CANDIDATE_RULE_VERSION,
        observationRevisionId: revision.id,
        subject: {
          type: revision.observation.subjectType,
          key: revision.observation.subjectKey,
        },
        question: `判断 ${revision.observation.metricCatalogId} 的当前修订是否构成实质研究事件`,
        knownAt: revision.normalizedAt.toISOString(),
        evidence: [
          ...revision.revisionSources.map(({ sourceAssertion }) => {
            const href = publicHref(
              textFromRecord(sourceAssertion.rawRecordJson, "url", "href"),
            );
            return {
              evidenceKey: `source-assertion:${sourceAssertion.id}`,
              kind: "MATERIAL" as const,
              sourceAssertionId: sourceAssertion.id,
              material: {
                materialKey: `source-assertion:${sourceAssertion.id}`,
                sourceAssertionId: sourceAssertion.id,
                sourceItemKey: sourceAssertion.sourceRecordKey,
                ...(href ? { normalizedUrl: href } : {}),
                contentHash: sourceAssertion.contentHash,
                rawContent: sourceAssertion.rawRecordJson,
                ...(sourceAssertion.sourcePublishedAt
                  ? {
                      publishedAt:
                        sourceAssertion.sourcePublishedAt.toISOString(),
                    }
                  : {}),
                fetchedAt: sourceAssertion.fetchedAt.toISOString(),
              },
              summary:
                textFromRecord(
                  sourceAssertion.rawRecordJson,
                  "content",
                  "summary",
                  "title",
                ) || sourceAssertion.sourceRecordKey,
            };
          }),
          {
            evidenceKey: `observation-revision:${revision.id}`,
            kind: "OBSERVATION_REVISION" as const,
            observationRevisionId: revision.id,
            summary:
              revision.valueText ??
              (revision.valueJson
                ? canonicalJson(revision.valueJson)
                : revision.valueHash),
          },
        ],
      });
      const inputHash = hashJson(frozen);
      const result = await this.scheduler.enqueue({
        taskType: CANDIDATE_TASK_TYPE,
        idempotencyKey: `candidate:${CANDIDATE_RULE_VERSION}:${revision.id}:${inputHash}`,
        inputHash,
        inputContractVersion: frozen.contractVersion,
        input: frozen,
        schedulingTier: "BACKGROUND",
        resourcePoolId: input.poolId,
        fairnessKey: revision.observation.subjectKey,
      });
      if (result.decision === "ACCEPTED") accepted += 1;
      else if (result.decision === "DEDUPLICATED") deduplicated += 1;
      else rejected += 1;
    }
    return { accepted, deduplicated, rejected };
  }
}

function productionInput(
  taskId: string,
  taskInput: CandidateTaskInput,
  rawOutput: unknown,
): ResearchProductionInput {
  const output = candidateAdjudicationOutputSchema.parse(rawOutput);
  const frozen = new Map(
    taskInput.evidence.map((item) => [item.evidenceKey, item]),
  );
  if (
    output.evidence.length !== frozen.size ||
    output.evidence.some((item) => !frozen.has(item.evidenceKey))
  ) {
    throw new Error("裁定输出的证据集合与冻结任务输入不一致");
  }
  return researchProductionInputSchema.parse({
    contractVersion: "research-production.v1",
    idempotencyKey: `candidate-task:${taskId}`,
    candidate: {
      candidateKey: `candidate:${hashJson({
        subject: taskInput.subject,
        eventIdentityKey: output.candidate.eventIdentityKey,
      })}`,
      clusterKey: output.candidate.clusterKey,
      subjectType: taskInput.subject.type,
      subjectKey: taskInput.subject.key,
      eventIdentityKey: output.candidate.eventIdentityKey,
      evidence: output.evidence.map((decision) => {
        const item = frozen.get(decision.evidenceKey);
        if (!item) throw new Error("裁定引用了未冻结证据");
        return {
          ...decision,
          ...(item.material ? { material: item.material } : {}),
          ...(item.observationRevisionId
            ? { observationRevisionId: item.observationRevisionId }
            : {}),
        };
      }),
    },
    adjudication: {
      ...output.adjudication,
      contractVersion: output.contractVersion,
      model: "deepseek-v4-flash",
      promptVersion: "candidate-adjudication.prompt.v2",
      schemaVersion: output.contractVersion,
    },
  });
}

export class CandidateProductionWorker {
  constructor(
    private readonly db: PrismaClient,
    private readonly scheduler: PostgresResearchScheduler,
    private readonly adjudication: CandidateAdjudicationAdapter,
    private readonly dependencies: ProductionDependencies = {},
  ) {}

  async runOnce(poolId: string, workerId: string) {
    const claimed = await this.scheduler.claim(poolId, workerId);
    if (!claimed) return null;
    const clock = this.dependencies.clock ?? (() => new Date());
    const startedAt = clock();
    const observer = new ProductionRuntimeObserver(this.db);
    let failureStage = "candidate-production";
    try {
      if (claimed.task.taskType !== CANDIDATE_TASK_TYPE) {
        throw new Error(
          `候选 Worker 不能执行任务类型 ${claimed.task.taskType}`,
        );
      }
      const input = candidateTaskInputSchema.parse(claimed.task.input);
      await observer.record({
        idempotencyKey: `candidate-worker:${claimed.task.id}:${claimed.task.fencingToken.toString()}:candidate`,
        metricKind: "PROCESSING",
        stage: "candidate-production",
        resourcePool: CANDIDATE_POOL_KEY,
        startedAt,
        readyAt: clock(),
        success: true,
        context: {
          taskId: claimed.task.id,
          taskType: claimed.task.taskType,
          inputContractVersion: claimed.task.inputContractVersion,
          inputHash: claimed.task.inputHash,
          authoritativeObjectIds: [claimed.task.id],
          retryAttempt: claimed.task.attempts,
          fencingToken: claimed.task.fencingToken.toString(),
        },
      });
      failureStage = "adjudication-production";
      const rawOutput = await this.adjudication.adjudicate(input);
      await this.scheduler.renew(
        claimed.task.id,
        claimed.task.fencingToken,
        workerId,
      );
      const production = await runResearchProduction(
        this.db,
        productionInput(claimed.task.id, input, rawOutput),
        this.dependencies,
      );
      await observer.record({
        idempotencyKey: `candidate-worker:${claimed.task.id}:${claimed.task.fencingToken.toString()}:success`,
        metricKind: "AGENT",
        stage: "adjudication-production",
        resourcePool: CANDIDATE_POOL_KEY,
        startedAt,
        readyAt: clock(),
        success: true,
        context: {
          taskId: claimed.task.id,
          taskType: claimed.task.taskType,
          inputContractVersion: claimed.task.inputContractVersion,
          inputHash: claimed.task.inputHash,
          resultContractVersion: "candidate-production-result.v1",
          authoritativeObjectIds: [
            production.candidateId,
            ...(production.eventRevisionId ? [production.eventRevisionId] : []),
            ...(production.globalAssessmentId
              ? [production.globalAssessmentId]
              : []),
            ...production.distributions.map((item) => item.entryId),
          ],
          retryAttempt: claimed.task.attempts,
          fencingToken: claimed.task.fencingToken.toString(),
        },
      });
      await this.scheduler.settle(claimed.task.id, claimed.task.fencingToken, {
        disposition: "COMPLETED",
        resultContractVersion: "candidate-production-result.v1",
        result: production,
      });
      return { status: "COMPLETED" as const, production };
    } catch (error) {
      await observer.record({
        idempotencyKey: `candidate-worker:${claimed.task.id}:${claimed.task.fencingToken.toString()}:failure`,
        metricKind: "AGENT",
        stage: failureStage,
        resourcePool: CANDIDATE_POOL_KEY,
        startedAt,
        readyAt: clock(),
        success: false,
        errorClass:
          error instanceof z.ZodError
            ? "LLM_SCHEMA_INVALID"
            : "CANDIDATE_PRODUCTION_FAILED",
        context: {
          taskId: claimed.task.id,
          taskType: claimed.task.taskType,
          inputContractVersion: claimed.task.inputContractVersion,
          inputHash: claimed.task.inputHash,
          retryAttempt: claimed.task.attempts,
          fencingToken: claimed.task.fencingToken.toString(),
        },
      });
      await this.scheduler.settle(claimed.task.id, claimed.task.fencingToken, {
        disposition: "RETRY",
        errorClass:
          error instanceof z.ZodError
            ? "LLM_SCHEMA_INVALID"
            : "CANDIDATE_PRODUCTION_FAILED",
        retryable: !(error instanceof z.ZodError),
      });
      throw error;
    }
  }
}

async function rejectedSeedAudit(
  db: PrismaClient,
  raw: unknown,
  error: z.ZodError,
) {
  const record =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const idempotencyKey =
    typeof record.idempotencyKey === "string" && record.idempotencyKey.trim()
      ? record.idempotencyKey
      : hashJson(raw);
  await db.researchAuditRecord.upsert({
    where: { auditKey: `candidate-seed-rejected:${idempotencyKey}` },
    create: {
      auditKey: `candidate-seed-rejected:${idempotencyKey}`,
      actorType: "DETERMINISTIC_CONTROLLER",
      action: "RESEARCH_CANDIDATE_SEED_REJECTED",
      entityType: "RESEARCH_CANDIDATE_SEED",
      entityId: idempotencyKey,
      inputContractVersion:
        typeof record.contractVersion === "string"
          ? record.contractVersion
          : null,
      inputHash: hashJson(raw),
      outcome: "REJECTED",
      detailsJson: toInputJson({ issues: error.issues }),
      occurredAt: new Date(),
    },
    update: {},
  });
}

export async function enqueueResearchCandidateSeed(
  db: PrismaClient,
  raw: unknown,
  options: { poolId?: string; clock?: () => Date } = {},
) {
  const parsed = researchCandidateSeedSchema.safeParse(raw);
  if (!parsed.success) {
    await rejectedSeedAudit(db, raw, parsed.error);
    throw parsed.error;
  }
  const seed = parsed.data;
  const now = options.clock?.() ?? new Date();
  const pool = options.poolId
    ? await db.researchResourcePool.findUnique({
        where: { id: options.poolId },
      })
    : await db.researchResourcePool.findUnique({
        where: { poolKey: CANDIDATE_POOL_KEY },
      });
  if (!pool) throw new Error("candidate/adjudication 资源池不存在");
  const taskInput = candidateTaskInputSchema.parse({
    contractVersion: "candidate-production-task.v1",
    triggerSource: seed.triggerSource,
    candidateRuleVersion: CANDIDATE_RULE_VERSION,
    seedIdempotencyKey: seed.idempotencyKey,
    subject: seed.subject,
    question: seed.question,
    knownAt: now.toISOString(),
    evidence: seed.sourceReferences.map((reference, index) => {
      const contentHash = hashJson({
        sourceKey: reference.sourceKey,
        summary: reference.summary,
      });
      return {
        evidenceKey: `seed:${seed.idempotencyKey}:${String(index + 1)}`,
        kind: "MATERIAL" as const,
        material: {
          materialKey: `seed-material:${contentHash}`,
          sourceItemKey: reference.sourceKey,
          ...(reference.href ? { normalizedUrl: reference.href } : {}),
          contentHash,
          rawContent: {
            sourceType: reference.sourceType,
            sourceKey: reference.sourceKey,
            summary: reference.summary,
          },
          fetchedAt: now.toISOString(),
        },
        summary: reference.summary,
      };
    }),
  });
  const inputHash = hashJson({
    seed,
    candidateRuleVersion: CANDIDATE_RULE_VERSION,
  });
  return db.$transaction(
    async (tx) => {
      const taskKey = `candidate-seed:${seed.idempotencyKey}`;
      const existing = await tx.researchTask.findUnique({
        where: { idempotencyKey: taskKey },
      });
      if (existing) {
        if (existing.inputHash !== inputHash) {
          throw new Error("相同 seed 幂等键不能改写冻结输入");
        }
        return {
          created: false,
          taskId: existing.id,
          idempotencyKey: seed.idempotencyKey,
        };
      }
      const taskId = randomUUID();
      await tx.researchTask.create({
        data: {
          id: taskId,
          taskType: CANDIDATE_TASK_TYPE,
          idempotencyKey: taskKey,
          inputHash,
          inputContractVersion: taskInput.contractVersion,
          inputJson: toInputJson(taskInput),
          schedulingTier: "INTERACTIVE",
          resourcePoolId: pool.id,
          fairnessKey: seed.subject.key,
          maxAttempts: 3,
          retryDeadline: new Date(now.getTime() + 30 * 60_000),
        },
      });
      await tx.researchAuditRecord.create({
        data: {
          auditKey: `candidate-seed:${seed.idempotencyKey}`,
          actorType: "AGENT_RUNTIME",
          actorId: seed.runId,
          action: "RESEARCH_CANDIDATE_SEED_ENQUEUED",
          entityType: "RESEARCH_CANDIDATE_SEED",
          entityId: seed.idempotencyKey,
          taskId,
          inputContractVersion: seed.contractVersion,
          inputHash,
          outcome: "ACCEPTED",
          detailsJson: {
            triggerSource: seed.triggerSource,
            scope: seed.scope,
            subject: seed.subject,
            sourceReferenceCount: seed.sourceReferences.length,
          },
          occurredAt: now,
        },
      });
      return { created: true, taskId, idempotencyKey: seed.idempotencyKey };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  type BriefingCandidate,
  type BriefingDraft,
  type BriefingSlot,
  briefingScheduleForTradingDay,
  ResearchDistributionService,
} from "~/server/application/research-distribution/research-distribution-service";
import { ResearchInboxService } from "~/server/application/research-inbox/research-inbox-service";
import { ResearchPreferenceService } from "~/server/application/research-preference/research-preference-service";
import { ProductionRuntimeObserver } from "~/server/application/runtime-observability/production-runtime-observer";
import type { PostgresResearchScheduler } from "~/server/application/scheduling/postgres-research-scheduler";
import type { ResearchInboxBody } from "~/server/domain/research-inbox/types";
import { PrismaResearchDistributionStore } from "~/server/infrastructure/research-distribution/prisma-research-distribution-store";
import { PrismaResearchInboxRepository } from "~/server/infrastructure/research-inbox/prisma-research-inbox-repository";
import { PrismaResearchPreferenceRepository } from "~/server/infrastructure/research-preference/prisma-research-preference-repository";

export const BRIEFING_TASK_TYPE = "research.briefing.v1";
export const BRIEFING_POOL_KEY = "briefing:research-production";
const briefingTaskInputSchema = z.object({
  contractVersion: z.literal("briefing-task.v1"),
  userId: z.string().min(1),
  tradingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slot: z.enum(["PRE_MARKET", "CLOSE", "EVENING"]),
});

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function hashJson(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}
function toJson(value: unknown) {
  return JSON.parse(canonicalJson(value)) as Prisma.InputJsonValue;
}

export class BriefingProductionScheduler {
  constructor(
    private readonly db: PrismaClient,
    private readonly scheduler: PostgresResearchScheduler,
  ) {}

  async scheduleDueBriefings(input: {
    poolId: string;
    now: Date;
    tradingDate: string;
    userIds?: string[];
  }) {
    const schedule = briefingScheduleForTradingDay(input.tradingDate);
    const users =
      input.userIds ??
      (
        await this.db.researchPreference.findMany({
          select: { userId: true },
          orderBy: { userId: "asc" },
        })
      ).map((item) => item.userId);
    const dueSlots = (
      Object.entries(schedule) as Array<[BriefingSlot, string]>
    ).filter(([, at]) => new Date(at) <= input.now);
    let accepted = 0;
    let deduplicated = 0;
    let rejected = 0;
    for (const userId of users)
      for (const [slot] of dueSlots) {
        const taskInput = {
          contractVersion: "briefing-task.v1" as const,
          userId,
          tradingDate: input.tradingDate,
          slot,
        };
        const result = await this.scheduler.enqueue({
          taskType: BRIEFING_TASK_TYPE,
          idempotencyKey: `briefing:${userId}:${input.tradingDate}:${slot}`,
          inputHash: hashJson(taskInput),
          inputContractVersion: taskInput.contractVersion,
          input: taskInput,
          schedulingTier: "TIME_CRITICAL",
          resourcePoolId: input.poolId,
          fairnessKey: userId,
          userId,
        });
        if (result.decision === "ACCEPTED") accepted += 1;
        else if (result.decision === "DEDUPLICATED") deduplicated += 1;
        else rejected += 1;
      }
    return { accepted, deduplicated, rejected };
  }
}

type BriefingWorkerDependencies = { clock?: () => Date };

export class BriefingProductionWorker {
  constructor(
    private readonly db: PrismaClient,
    private readonly scheduler: PostgresResearchScheduler,
    private readonly dependencies: BriefingWorkerDependencies = {},
  ) {}

  async runOnce(poolId: string, workerId: string) {
    const claimed = await this.scheduler.claim(poolId, workerId);
    if (!claimed) return null;
    const clock = this.dependencies.clock ?? (() => new Date());
    const startedAt = clock();
    const observer = new ProductionRuntimeObserver(this.db);
    try {
      if (claimed.task.taskType !== BRIEFING_TASK_TYPE)
        throw new Error(
          `简报 Worker 不能执行任务类型 ${claimed.task.taskType}`,
        );
      const input = briefingTaskInputSchema.parse(claimed.task.input);
      const preference = new ResearchPreferenceService(
        new PrismaResearchPreferenceRepository(this.db),
        { clock },
      );
      const snapshot = await preference.freeze(input.userId);
      const currentEvents = await this.db.researchEvent.findMany({
        where: { currentRevisionId: { not: null } },
        select: { currentRevisionId: true },
      });
      const revisions = await this.db.researchEventRevision.findMany({
        where: {
          id: {
            in: currentEvents.flatMap((event) =>
              event.currentRevisionId ? [event.currentRevisionId] : [],
            ),
          },
          relevanceAssessments: { some: { userId: input.userId } },
        },
        include: {
          globalAssessment: true,
          relevanceAssessments: { where: { userId: input.userId }, take: 1 },
          claims: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
      });
      const candidates: BriefingCandidate[] = revisions.map((revision) => ({
        id: revision.id,
        revisionKind:
          revision.revisionKind === "CORRECTED"
            ? "CORRECTION"
            : revision.revisionKind === "RETRACTED"
              ? "RETRACTION"
              : "EVENT",
        importance: (revision.globalAssessment?.importance ??
          null) as BriefingCandidate["importance"],
        confidence: (revision.globalAssessment?.confidence ??
          null) as BriefingCandidate["confidence"],
        informationNovelty: (revision.globalAssessment?.informationNovelty ??
          null) as BriefingCandidate["informationNovelty"],
      }));
      const inbox = new ResearchInboxService(
        new PrismaResearchInboxRepository(this.db),
        { clock },
      );
      const distribution = new ResearchDistributionService(
        inbox,
        new PrismaResearchDistributionStore(this.db),
        { clock },
      );
      const scope = distribution.freezeBriefingScope({
        slot: input.slot,
        taskId: claimed.task.id,
        userId: input.userId,
        capacity: 20,
        candidates,
      });
      const selected = revisions.filter((revision) =>
        scope.includedIds.includes(revision.id),
      );
      const inputProjection = {
        task: input,
        preferenceSnapshot: {
          id: snapshot.id,
          contentHash: snapshot.contentHash,
          items: snapshot.items,
        },
        candidates: selected.map((revision) => ({
          id: revision.id,
          title: revision.title,
          summary: revision.summary,
          occurredAt: revision.occurredAt.toISOString(),
          claims: revision.claims.map((claim) => claim.claimText),
        })),
        includedIds: scope.includedIds,
        mandatoryIds: scope.mandatoryIds,
      };
      const inputHash = hashJson(inputProjection);
      const existing = await this.db.researchBriefingScope.findUnique({
        where: {
          userId_tradingDate_slot: {
            userId: input.userId,
            tradingDate: input.tradingDate,
            slot: input.slot,
          },
        },
      });
      if (existing && existing.inputHash !== inputHash)
        throw new Error("相同简报时点的冻结输入不能改写");
      if (
        existing?.status === "PUBLISHED" ||
        existing?.status === "SKIPPED_NO_INCREMENT"
      ) {
        await recordBriefingObservation(
          observer,
          claimed.task,
          startedAt,
          clock(),
          existing.status,
          [existing.id],
        );
        await this.scheduler.settle(
          claimed.task.id,
          claimed.task.fencingToken,
          {
            disposition: "COMPLETED",
            resultContractVersion: "briefing-result.v1",
            result: { status: existing.status, scopeId: existing.id },
          },
        );
        return {
          status: existing.status as "PUBLISHED" | "SKIPPED_NO_INCREMENT",
          taskId: claimed.task.id,
          scopeId: existing.id,
        };
      }
      if (scope.status === "SKIPPED_NO_INCREMENT") {
        const frozen =
          existing ??
          (await this.db.researchBriefingScope.create({
            data: {
              taskId: claimed.task.id,
              userId: input.userId,
              preferenceSnapshotId: snapshot.id,
              tradingDate: input.tradingDate,
              slot: input.slot,
              contractVersion: "briefing-scope.v1",
              inputHash,
              inputJson: toJson(inputProjection),
              includedIdsJson: [],
              mandatoryIdsJson: [],
              status: "SKIPPED_NO_INCREMENT",
            },
          }));
        await recordBriefingObservation(
          observer,
          claimed.task,
          startedAt,
          clock(),
          "SKIPPED_NO_INCREMENT",
          [frozen.id],
        );
        await this.scheduler.settle(
          claimed.task.id,
          claimed.task.fencingToken,
          {
            disposition: "COMPLETED",
            resultContractVersion: "briefing-result.v1",
            result: { status: "SKIPPED_NO_INCREMENT", scopeId: frozen.id },
          },
        );
        return {
          status: "SKIPPED_NO_INCREMENT" as const,
          taskId: claimed.task.id,
          scopeId: frozen.id,
        };
      }
      const draft = buildDraft(input.slot, selected, scope.includedIds);
      const draftHash = hashJson({ inputHash, draft });
      const frozen =
        existing ??
        (await this.db.researchBriefingScope.create({
          data: {
            taskId: claimed.task.id,
            userId: input.userId,
            preferenceSnapshotId: snapshot.id,
            tradingDate: input.tradingDate,
            slot: input.slot,
            contractVersion: "briefing-scope.v1",
            inputHash,
            inputJson: toJson(inputProjection),
            includedIdsJson: toJson(scope.includedIds),
            mandatoryIdsJson: toJson(scope.mandatoryIds),
            draftJson: toJson(draft),
            draftHash,
          },
        }));
      if (frozen.draftHash !== draftHash)
        throw new Error("简报草稿 hash 与冻结输入不一致");
      const published = await distribution.publishBriefing({
        scope,
        draft,
        preferenceSnapshot: snapshot,
      });
      await this.db.researchBriefingScope.update({
        where: { id: frozen.id },
        data: { status: "PUBLISHED", publishedAt: clock() },
      });
      await recordBriefingObservation(
        observer,
        claimed.task,
        startedAt,
        clock(),
        published.status,
        [frozen.id, ...(published.entry ? [published.entry.id] : [])],
      );
      await this.scheduler.settle(claimed.task.id, claimed.task.fencingToken, {
        disposition: "COMPLETED",
        resultContractVersion: "briefing-result.v1",
        result: {
          status: published.status,
          scopeId: frozen.id,
          entryId: published.entry?.id ?? null,
        },
      });
      return {
        status: "PUBLISHED" as const,
        taskId: claimed.task.id,
        scopeId: frozen.id,
        entryId: published.entry?.id ?? null,
      };
    } catch (error) {
      await observer.record({
        idempotencyKey: `briefing-worker:${claimed.task.id}:${claimed.task.fencingToken.toString()}:failure`,
        stage: "briefing-production",
        resourcePool: BRIEFING_POOL_KEY,
        startedAt,
        readyAt: clock(),
        success: false,
        errorClass: "BRIEFING_WORKER_FAILED",
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
        errorClass: "BRIEFING_WORKER_FAILED",
        retryable: true,
      });
      throw error;
    }
  }
}

async function recordBriefingObservation(
  observer: ProductionRuntimeObserver,
  task: {
    id: string;
    taskType: string;
    inputContractVersion: string;
    inputHash: string;
    attempts: number;
    fencingToken: bigint;
  },
  startedAt: Date,
  readyAt: Date,
  status: string,
  authoritativeObjectIds: string[],
) {
  await observer.record({
    idempotencyKey: `briefing-worker:${task.id}:${task.fencingToken.toString()}:${status}`,
    stage: "briefing-production",
    resourcePool: BRIEFING_POOL_KEY,
    startedAt,
    readyAt,
    success: status === "PUBLISHED" || status === "SKIPPED_NO_INCREMENT",
    degraded: status !== "PUBLISHED",
    context: {
      taskId: task.id,
      taskType: task.taskType,
      inputContractVersion: task.inputContractVersion,
      inputHash: task.inputHash,
      resultContractVersion: "briefing-result.v1",
      authoritativeObjectIds,
      retryAttempt: task.attempts,
      fencingToken: task.fencingToken.toString(),
      ...(status !== "PUBLISHED" ? { degradedReason: status } : {}),
    },
  });
}

function buildDraft(
  slot: BriefingSlot,
  revisions: Array<{
    id: string;
    title: string;
    summary: string;
    occurredAt: Date;
    claims: Array<{ claimText: string }>;
  }>,
  includedIds: string[],
): BriefingDraft {
  const selected = revisions.filter((revision) =>
    includedIds.includes(revision.id),
  );
  const first = selected[0];
  const facts = selected
    .flatMap((revision) => revision.claims.map((claim) => claim.claimText))
    .slice(0, 20);
  const body: ResearchInboxBody = {
    subject: { type: "BRIEFING", key: slot, label: `${slot}研究简报` },
    eventStatus: "BRIEFING",
    occurredAt: (first?.occurredAt ?? new Date()).toISOString(),
    facts:
      facts.length > 0
        ? facts
        : [
            selected.length === 0
              ? "本时段没有达到门槛的新研究事件。"
              : "冻结事件修订未提供额外事实主张。",
          ],
    impact: "简报仅汇总冻结研究事件，不新增事实。",
    reasons: ["依据冻结的事件修订和分发评估生成。"],
    nextChecks: ["继续观察相关事件的后续证据。"],
    risks: ["简报不构成投资建议。"],
    assessments: {
      importance: { level: "综合", reason: "冻结评估" },
      confidence: { level: "综合", reason: "冻结评估" },
      relevance: { level: "综合", reason: "冻结偏好" },
      informationNovelty: { level: "综合", reason: "冻结评估" },
    },
    evidence: selected.map((revision) => ({
      id: revision.id,
      source: "冻结研究事件修订",
      excerpt: revision.summary,
      qualification: "FROZEN",
    })),
    revisions: selected.map((revision) => ({
      id: revision.id,
      kind: "EVENT",
      label: revision.title,
      summary: revision.summary,
      createdAt: revision.occurredAt.toISOString(),
    })),
    aiDisclosure: "简报由确定性编排基于冻结输入生成。",
    externalCopyStatus: "外部副本按独立投递任务结算",
  };
  return {
    includedIds,
    title: `${slot}研究简报`,
    summary: `汇总 ${String(selected.length)} 项冻结研究事件`,
    body,
  };
}

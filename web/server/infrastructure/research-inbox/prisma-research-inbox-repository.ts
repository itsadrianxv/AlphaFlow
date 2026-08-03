import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { researchInboxBodySchema } from "~/contracts/research-inbox";
import type { ResearchInboxRepository } from "~/server/domain/research-inbox/repository";
import type {
  ChangeResearchInboxStateInput,
  CreateResearchInboxEntryInput,
  ResearchInboxEntry,
  ResearchInboxEntryKind,
  ResearchInboxFeedbackValue,
  ResearchInboxFilter,
  ResearchInboxState,
  SetResearchInboxFeedbackInput,
} from "~/server/domain/research-inbox/types";

const inboxInclude = {
  history: { orderBy: { sequence: "asc" as const } },
  feedback: true,
} satisfies Prisma.ResearchInboxEntryInclude;

const inboxDetailInclude = {
  ...inboxInclude,
  eventRevision: {
    include: {
      event: {
        include: {
          revisions: {
            orderBy: [{ revisionNo: "asc" as const }, { id: "asc" as const }],
          },
        },
      },
      claims: {
        orderBy: { ordinal: "asc" as const },
        include: {
          citations: {
            include: {
              candidateEvidence: {
                include: {
                  material: { include: { sourceAssertion: true } },
                  sourceAssertion: true,
                  observationRevision: true,
                },
              },
              sourceAssertion: true,
              observationRevision: true,
            },
          },
        },
      },
    },
  },
  candidate: {
    include: {
      evidence: {
        orderBy: { ordinal: "asc" as const },
        include: {
          material: { include: { sourceAssertion: true } },
          sourceAssertion: true,
          observationRevision: true,
        },
      },
    },
  },
  briefingTask: { include: { briefingScope: true } },
  globalAssessment: true,
  relevanceAssessment: true,
  preferenceSnapshot: { include: { items: true } },
  externalCopy: true,
} satisfies Prisma.ResearchInboxEntryInclude;

type InboxRow = Prisma.ResearchInboxEntryGetPayload<{
  include: typeof inboxInclude;
}>;

type InboxDetailRow = Prisma.ResearchInboxEntryGetPayload<{
  include: typeof inboxDetailInclude;
}>;

export class PrismaResearchInboxRepository implements ResearchInboxRepository {
  constructor(private readonly db: PrismaClient) {}

  async recordDistribution(
    input: CreateResearchInboxEntryInput,
    occurredAt: string,
  ) {
    return this.db.$transaction(async (tx) => {
      await this.validateReferences(tx, input);
      const existing = await tx.researchInboxEntry.findUnique({
        where: {
          userId_distributionKey: {
            userId: input.userId,
            distributionKey: input.distributionKey,
          },
        },
        include: inboxInclude,
      });
      if (existing) return { entry: mapEntry(existing), created: false };

      const timestamp = new Date(occurredAt);
      const inserted = await tx.researchInboxEntry.createMany({
        data: {
          distributionKey: input.distributionKey,
          userId: input.userId,
          eventRevisionId: input.eventRevisionId,
          candidateId: input.candidateId,
          briefingTaskId: input.briefingTaskId,
          globalAssessmentId: input.globalAssessmentId,
          relevanceAssessmentId: input.relevanceAssessmentId,
          preferenceSnapshotId: input.preferenceSnapshotId,
          highestChannel: input.highestChannel,
          entryKind: input.entryKind,
          title: input.title,
          summary: input.summary,
          bodyJson: input.body as Prisma.InputJsonValue,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        skipDuplicates: true,
      });
      const entry = await tx.researchInboxEntry.findUniqueOrThrow({
        where: {
          userId_distributionKey: {
            userId: input.userId,
            distributionKey: input.distributionKey,
          },
        },
        include: inboxInclude,
      });
      if (inserted.count === 1) {
        await tx.researchInboxEntryHistory.create({
          data: {
            entryId: entry.id,
            sequence: 1,
            fromState: null,
            toState: "UNREAD",
            action: "DISTRIBUTED",
            commandId: `distribution:${input.userId}:${input.distributionKey}`,
            occurredAt: timestamp,
          },
        });
      }
      return { entry: mapEntry(entry), created: inserted.count === 1 };
    });
  }

  async list(userId: string, filter: ResearchInboxFilter) {
    const state =
      filter === "PENDING" ? { in: ["UNREAD", "READ", "LATER"] } : filter;
    const entries = await this.db.researchInboxEntry.findMany({
      where: { userId, state },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: inboxInclude,
    });
    return entries.map((row) => mapEntry(row));
  }

  async get(userId: string, entryId: string) {
    const entry = await this.db.researchInboxEntry.findFirst({
      where: { id: entryId, userId },
      include: inboxDetailInclude,
    });
    if (!entry) return null;
    await this.validatePersistedReferences(this.db, entry);
    return mapEntry(entry, projectAuthoritativeBody(entry));
  }

  private async validateReferences(
    db: PrismaClient | Prisma.TransactionClient,
    input: CreateResearchInboxEntryInput,
  ) {
    const subjectCount = [
      input.eventRevisionId,
      input.candidateId,
      input.briefingTaskId,
    ].filter(Boolean).length;
    if (subjectCount !== 1) {
      throw new Error("收件箱必须且只能绑定一个权威主体");
    }
    if (input.eventRevisionId) {
      if (!["EVENT", "CORRECTION", "RETRACTION"].includes(input.entryKind)) {
        throw new Error("事件修订只能创建事件、更正或撤回收件箱记录");
      }
      if (
        !input.globalAssessmentId ||
        !input.relevanceAssessmentId ||
        !input.preferenceSnapshotId
      ) {
        throw new Error("事件收件箱必须绑定全局评估、用户相关性评估和偏好快照");
      }
      const revision = await db.researchEventRevision.findUnique({
        where: { id: input.eventRevisionId },
        select: { id: true },
      });
      if (!revision) throw new Error("收件箱引用的事件修订不存在");
    }
    if (input.candidateId) {
      if (input.entryKind !== "CANDIDATE_PENDING_VERIFICATION") {
        throw new Error("候选主体只能创建待核实收件箱记录");
      }
      const candidate = await db.researchEventCandidate.findUnique({
        where: { id: input.candidateId },
        select: { id: true },
      });
      if (!candidate) throw new Error("收件箱引用的候选不存在");
    }
    if (input.briefingTaskId && input.entryKind !== "BRIEFING") {
      throw new Error("简报任务只能创建简报收件箱记录");
    }
    if (input.globalAssessmentId) {
      const assessment = await db.researchEventGlobalAssessment.findUnique({
        where: { id: input.globalAssessmentId },
        select: { eventRevisionId: true },
      });
      if (!assessment || assessment.eventRevisionId !== input.eventRevisionId)
        throw new Error("收件箱全局评估与事件修订不一致");
    }
    if (input.preferenceSnapshotId) {
      const snapshot = await db.researchPreferenceSnapshot.findUnique({
        where: { id: input.preferenceSnapshotId },
        select: { userId: true, personalDataDeletedAt: true },
      });
      if (!snapshot || snapshot.userId !== input.userId)
        throw new Error("收件箱偏好快照不属于用户");
      if (snapshot.personalDataDeletedAt)
        throw new Error("已删除个人数据的偏好快照不能用于收件箱");
    }
    if (input.relevanceAssessmentId) {
      const assessment = await db.researchEventRelevanceAssessment.findUnique({
        where: { id: input.relevanceAssessmentId },
        select: {
          eventRevisionId: true,
          userId: true,
          preferenceSnapshotId: true,
        },
      });
      if (
        !assessment ||
        assessment.eventRevisionId !== input.eventRevisionId ||
        assessment.userId !== input.userId ||
        assessment.preferenceSnapshotId !== input.preferenceSnapshotId
      )
        throw new Error("收件箱相关性评估与用户/偏好/事件修订不一致");
    }
    if (input.briefingTaskId) {
      const task = await db.researchTask.findUnique({
        where: { id: input.briefingTaskId },
        select: {
          userId: true,
          taskType: true,
          briefingScope: {
            select: { userId: true, preferenceSnapshotId: true },
          },
        },
      });
      if (
        !task ||
        task.userId !== input.userId ||
        task.taskType !== "research.briefing.v1"
      )
        throw new Error("收件箱简报任务与用户不一致");
      if (
        !task.briefingScope ||
        task.briefingScope.userId !== input.userId ||
        task.briefingScope.preferenceSnapshotId !== input.preferenceSnapshotId
      )
        throw new Error("收件箱简报任务与冻结范围不一致");
    }
  }

  private async validatePersistedReferences(
    db: PrismaClient | Prisma.TransactionClient,
    entry: {
      eventRevisionId: string | null;
      candidateId: string | null;
      globalAssessmentId: string | null;
      relevanceAssessmentId: string | null;
      preferenceSnapshotId: string | null;
      briefingTaskId: string | null;
      userId: string;
      entryKind: string;
    },
  ) {
    await this.validateReferences(db, {
      distributionKey: "read-validation",
      userId: entry.userId,
      eventRevisionId: entry.eventRevisionId ?? undefined,
      candidateId: entry.candidateId ?? undefined,
      globalAssessmentId: entry.globalAssessmentId ?? undefined,
      relevanceAssessmentId: entry.relevanceAssessmentId ?? undefined,
      preferenceSnapshotId: entry.preferenceSnapshotId ?? undefined,
      briefingTaskId: entry.briefingTaskId ?? undefined,
      highestChannel: "IN_APP",
      entryKind: entry.entryKind as CreateResearchInboxEntryInput["entryKind"],
      title: "read-validation",
      summary: "read-validation",
      body: {} as never,
    });
  }

  async changeState(
    userId: string,
    input: ChangeResearchInboxStateInput,
    occurredAt: string,
    action: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "ResearchInboxEntry"
        WHERE "id" = ${input.entryId} AND "userId" = ${userId}
        FOR UPDATE
      `;
      if (!locked[0]) return null;
      const current = await tx.researchInboxEntry.findUnique({
        where: { id: input.entryId },
        include: inboxInclude,
      });
      if (!current) return null;
      const repeated = await tx.researchInboxEntryHistory.findUnique({
        where: { commandId: input.commandId },
        select: { entryId: true },
      });
      if (repeated || current.state === input.state) return mapEntry(current);

      await tx.researchInboxEntry.update({
        where: { id: current.id },
        data: {
          state: input.state,
          openedAt:
            action === "OPENED" ? new Date(occurredAt) : current.openedAt,
          archivedAt: input.state === "ARCHIVED" ? new Date(occurredAt) : null,
          updatedAt: new Date(occurredAt),
        },
      });
      const history = await tx.researchInboxEntryHistory.aggregate({
        where: { entryId: current.id },
        _max: { sequence: true },
      });
      await tx.researchInboxEntryHistory.create({
        data: {
          entryId: current.id,
          sequence: (history._max.sequence ?? 0) + 1,
          fromState: current.state,
          toState: input.state,
          action,
          commandId: input.commandId,
          occurredAt: new Date(occurredAt),
        },
      });
      return mapEntry(
        await tx.researchInboxEntry.findUniqueOrThrow({
          where: { id: current.id },
          include: inboxInclude,
        }),
      );
    });
  }

  async setFeedback(userId: string, input: SetResearchInboxFeedbackInput) {
    return this.db.$transaction(async (tx) => {
      const entry = await tx.researchInboxEntry.findFirst({
        where: { id: input.entryId, userId },
        select: { id: true },
      });
      if (!entry) return null;
      const repeated = await tx.researchInboxFeedback.findUnique({
        where: { commandId: input.commandId },
      });
      if (!repeated) {
        await tx.researchInboxFeedback.upsert({
          where: { entryId: entry.id },
          create: {
            entryId: entry.id,
            userId,
            value: input.value,
            commandId: input.commandId,
          },
          update: { value: input.value, commandId: input.commandId },
        });
      }
      return mapEntry(
        await tx.researchInboxEntry.findUniqueOrThrow({
          where: { id: entry.id },
          include: inboxInclude,
        }),
      );
    });
  }
}

function mapEntry(
  row: InboxRow | InboxDetailRow,
  bodyOverride?: ResearchInboxEntry["body"],
): ResearchInboxEntry {
  return {
    id: row.id,
    distributionKey: row.distributionKey,
    userId: row.userId,
    highestChannel: row.highestChannel as ResearchInboxEntry["highestChannel"],
    entryKind: row.entryKind as ResearchInboxEntryKind,
    title: row.title,
    summary: row.summary,
    body: bodyOverride ?? researchInboxBodySchema.parse(row.bodyJson),
    references: {
      eventRevisionId: row.eventRevisionId,
      candidateId: row.candidateId,
      briefingTaskId: row.briefingTaskId,
      globalAssessmentId: row.globalAssessmentId,
      relevanceAssessmentId: row.relevanceAssessmentId,
      preferenceSnapshotId: row.preferenceSnapshotId,
    },
    state: row.state as ResearchInboxState,
    feedback: (row.feedback?.value as ResearchInboxFeedbackValue) ?? null,
    openedAt: row.openedAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    history: row.history.map((history) => ({
      id: history.id,
      sequence: history.sequence,
      fromState: history.fromState as ResearchInboxState | null,
      toState: history.toState as ResearchInboxState,
      action: history.action,
      commandId: history.commandId,
      occurredAt: history.occurredAt.toISOString(),
    })),
  };
}

function projectAuthoritativeBody(
  row: InboxDetailRow,
): ResearchInboxEntry["body"] {
  if (row.eventRevision) {
    const revision = row.eventRevision;
    const evidence = new Map<
      string,
      ResearchInboxEntry["body"]["evidence"][number]
    >();
    for (const claim of revision.claims) {
      for (const citation of claim.citations) {
        const source = citation.candidateEvidence;
        const sourceAssertion =
          source?.sourceAssertion ??
          citation.sourceAssertion ??
          source?.material?.sourceAssertion;
        const observation =
          source?.observationRevision ?? citation.observationRevision;
        const id = source?.id ?? citation.id;
        const citationJson = asRecord(
          source?.citationJson ?? citation.citationJson,
        );
        if (!evidence.has(id)) {
          evidence.set(id, {
            id,
            source: stringField(
              citationJson.source,
              sourceAssertion?.sourceKey ??
                (observation ? "数据观测修订" : "权威研究证据"),
            ),
            excerpt: stringField(citationJson.excerpt, claim.claimText),
            qualification:
              source?.proofQualification ?? citation.proofQualification,
            ...(optionalHref(citationJson.href)
              ? { href: optionalHref(citationJson.href) }
              : {}),
          });
        }
      }
    }
    const narrative = asRecord(revision.narrativeJson);
    const global = asRecord(row.globalAssessment?.dimensionsJson);
    const relevance = asRecord(row.relevanceAssessment?.dimensionJson);
    if (revision.claims.length === 0) {
      throw new Error("事件修订缺少可追溯事实主张");
    }
    if (evidence.size === 0) {
      throw new Error("事件修订事实主张缺少可追溯权威证据");
    }
    return researchInboxBodySchema.parse({
      subject: {
        type: revision.event.subjectType,
        key: revision.event.subjectKey,
        label: revision.event.subjectKey,
      },
      eventStatus: revision.revisionKind,
      occurredAt: revision.occurredAt.toISOString(),
      facts: revision.claims.map((claim) => claim.claimText),
      impact: stringField(narrative.impact, "暂无确定性影响说明"),
      reasons: stringArray(narrative.reasons, "依据已冻结证据形成"),
      nextChecks: stringArray(narrative.nextChecks),
      risks: stringArray(narrative.risks),
      assessments: {
        importance: assessmentFromJson(global.importance),
        confidence: assessmentFromJson(global.confidence),
        relevance: assessmentFromJson(relevance.relevance),
        informationNovelty: assessmentFromJson(global.informationNovelty),
      },
      evidence: [...evidence.values()],
      revisions: revision.event.revisions.map((item) => ({
        id: item.id,
        kind: item.revisionKind,
        label: revisionLabel(item.revisionKind),
        summary: item.summary,
        createdAt: item.createdAt.toISOString(),
      })),
      aiDisclosure: "AI 生成研究解释，仅依据关系中冻结的事实、证据和评估。",
      externalCopyStatus: row.externalCopy
        ? `外部副本状态：${row.externalCopy.status}`
        : "外部副本未创建",
    });
  }

  if (row.candidate) {
    const body = researchInboxBodySchema.parse(row.bodyJson);
    const evidence = row.candidate.evidence.map((item) => {
      const citation = asRecord(item.citationJson);
      const assertion = item.sourceAssertion ?? item.material?.sourceAssertion;
      return {
        id: item.id,
        source: stringField(
          citation.source,
          assertion?.sourceKey ??
            (item.observationRevision ? "数据观测修订" : "候选材料"),
        ),
        excerpt: stringField(
          citation.excerpt,
          body.evidence.find((entry) => entry.id === item.id)?.excerpt ??
            "冻结候选证据",
        ),
        qualification: item.proofQualification,
        ...(optionalHref(citation.href)
          ? { href: optionalHref(citation.href) }
          : {}),
      };
    });
    return researchInboxBodySchema.parse({
      ...body,
      eventStatus: "PENDING_VERIFICATION",
      evidence,
    });
  }

  if (row.briefingTask?.briefingScope?.draftJson) {
    const scope = row.briefingTask.briefingScope;
    if (scope.draftHash && hashJson(scope.draftJson) !== scope.draftHash) {
      throw new Error("简报冻结正文 hash 校验失败");
    }
    const draft = asRecord(scope.draftJson);
    if (draft.body) return researchInboxBodySchema.parse(draft.body);
  }
  return researchInboxBodySchema.parse(row.bodyJson);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : fallback;
}

function stringArray(value: unknown, fallback = "暂无") {
  if (!Array.isArray(value)) return [fallback];
  const items = value.filter(
    (item): item is string =>
      typeof item === "string" && item.trim().length > 0,
  );
  return items.length > 0 ? items : [fallback];
}

function optionalHref(value: unknown) {
  return typeof value === "string" &&
    (value.startsWith("http://") || value.startsWith("https://"))
    ? value
    : undefined;
}

function assessmentFromJson(value: unknown) {
  const dimension = asRecord(value);
  const score = typeof dimension.score === "number" ? dimension.score : null;
  const reasons = Array.isArray(dimension.reasons) ? dimension.reasons : [];
  const first = asRecord(reasons[0]);
  return {
    level: scoreLevel(score),
    reason: stringField(first.text, "无法判断"),
  };
}

function scoreLevel(score: number | null) {
  if (score === null) return "无法判断";
  if (score <= 1) return "低";
  if (score === 2) return "中";
  if (score === 3) return "高";
  return "极高";
}

function revisionLabel(kind: string) {
  if (kind === "CORRECTED") return "更正";
  if (kind === "RETRACTED") return "撤回";
  return "确认";
}

function hashJson(value: unknown) {
  return `sha256:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}

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

import { Prisma, type PrismaClient } from "@prisma/client";
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

type InboxRow = Prisma.ResearchInboxEntryGetPayload<{
  include: typeof inboxInclude;
}>;

export class PrismaResearchInboxRepository implements ResearchInboxRepository {
  constructor(private readonly db: PrismaClient) {}

  async recordDistribution(
    input: CreateResearchInboxEntryInput,
    occurredAt: string,
  ) {
    const existing = await this.db.researchInboxEntry.findUnique({
      where: { distributionKey: input.distributionKey },
      include: inboxInclude,
    });
    if (existing) return { entry: mapEntry(existing), created: false };

    try {
      const entry = await this.db.researchInboxEntry.create({
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
          createdAt: new Date(occurredAt),
          updatedAt: new Date(occurredAt),
          history: {
            create: {
              sequence: 1,
              fromState: null,
              toState: "UNREAD",
              action: "DISTRIBUTED",
              commandId: `distribution:${input.distributionKey}`,
              occurredAt: new Date(occurredAt),
            },
          },
        },
        include: inboxInclude,
      });
      return { entry: mapEntry(entry), created: true };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const repeated = await this.db.researchInboxEntry.findUniqueOrThrow({
        where: { distributionKey: input.distributionKey },
        include: inboxInclude,
      });
      return { entry: mapEntry(repeated), created: false };
    }
  }

  async list(userId: string, filter: ResearchInboxFilter) {
    const state =
      filter === "PENDING" ? { in: ["UNREAD", "READ", "LATER"] } : filter;
    const entries = await this.db.researchInboxEntry.findMany({
      where: { userId, state },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: inboxInclude,
    });
    return entries.map(mapEntry);
  }

  async get(userId: string, entryId: string) {
    const entry = await this.db.researchInboxEntry.findFirst({
      where: { id: entryId, userId },
      include: inboxInclude,
    });
    return entry ? mapEntry(entry) : null;
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

function mapEntry(row: InboxRow): ResearchInboxEntry {
  return {
    id: row.id,
    distributionKey: row.distributionKey,
    userId: row.userId,
    highestChannel: row.highestChannel as ResearchInboxEntry["highestChannel"],
    entryKind: row.entryKind as ResearchInboxEntryKind,
    title: row.title,
    summary: row.summary,
    body: researchInboxBodySchema.parse(row.bodyJson),
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

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

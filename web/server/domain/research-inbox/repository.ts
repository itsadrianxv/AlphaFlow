import type {
  ChangeResearchInboxStateInput,
  CreateResearchInboxEntryInput,
  ResearchInboxEntry,
  ResearchInboxFilter,
  ResearchInboxState,
  SetResearchInboxFeedbackInput,
} from "./types";

export interface ResearchInboxRepository {
  recordDistribution(
    input: CreateResearchInboxEntryInput,
    occurredAt: string,
  ): Promise<{ entry: ResearchInboxEntry; created: boolean }>;
  list(
    userId: string,
    filter: ResearchInboxFilter,
  ): Promise<ResearchInboxEntry[]>;
  get(userId: string, entryId: string): Promise<ResearchInboxEntry | null>;
  changeState(
    userId: string,
    input: ChangeResearchInboxStateInput,
    occurredAt: string,
    action: string,
  ): Promise<ResearchInboxEntry | null>;
  setFeedback(
    userId: string,
    input: SetResearchInboxFeedbackInput,
  ): Promise<ResearchInboxEntry | null>;
}

export class InMemoryResearchInboxRepository
  implements ResearchInboxRepository
{
  private readonly entries = new Map<string, ResearchInboxEntry>();
  private readonly entryIdByDistributionKey = new Map<string, string>();
  private readonly stateCommands = new Set<string>();
  private readonly feedbackCommands = new Set<string>();
  private sequence = 0;

  async recordDistribution(
    input: CreateResearchInboxEntryInput,
    occurredAt: string,
  ) {
    const existingId = this.entryIdByDistributionKey.get(input.distributionKey);
    if (existingId) {
      const existing = this.entries.get(existingId);
      if (!existing) throw new Error("研究收件箱分发索引失效");
      return { entry: structuredClone(existing), created: false };
    }

    const id = this.nextId("inbox");
    const entry: ResearchInboxEntry = {
      id,
      distributionKey: input.distributionKey,
      userId: input.userId,
      highestChannel: input.highestChannel,
      entryKind: input.entryKind,
      title: input.title,
      summary: input.summary,
      body: structuredClone(input.body),
      references: {
        eventRevisionId: input.eventRevisionId ?? null,
        candidateId: input.candidateId ?? null,
        briefingTaskId: input.briefingTaskId ?? null,
        globalAssessmentId: input.globalAssessmentId ?? null,
        relevanceAssessmentId: input.relevanceAssessmentId ?? null,
        preferenceSnapshotId: input.preferenceSnapshotId ?? null,
      },
      state: "UNREAD",
      feedback: null,
      openedAt: null,
      archivedAt: null,
      createdAt: occurredAt,
      updatedAt: occurredAt,
      history: [
        {
          id: this.nextId("history"),
          sequence: 1,
          fromState: null,
          toState: "UNREAD",
          action: "DISTRIBUTED",
          commandId: `distribution:${input.distributionKey}`,
          occurredAt,
        },
      ],
    };
    this.entries.set(id, entry);
    this.entryIdByDistributionKey.set(input.distributionKey, id);
    return { entry: structuredClone(entry), created: true };
  }

  async list(userId: string, filter: ResearchInboxFilter) {
    return [...this.entries.values()]
      .filter(
        (entry) =>
          entry.userId === userId && matchesFilter(entry.state, filter),
      )
      .sort((left, right) => right.id.localeCompare(left.id))
      .map((entry) => structuredClone(entry));
  }

  async get(userId: string, entryId: string) {
    const entry = this.entries.get(entryId);
    return entry?.userId === userId ? structuredClone(entry) : null;
  }

  async changeState(
    userId: string,
    input: ChangeResearchInboxStateInput,
    occurredAt: string,
    action: string,
  ) {
    const entry = this.entries.get(input.entryId);
    if (!entry || entry.userId !== userId) return null;
    if (
      this.stateCommands.has(input.commandId) ||
      entry.state === input.state
    ) {
      return structuredClone(entry);
    }
    const fromState = entry.state;
    entry.state = input.state;
    entry.openedAt = action === "OPENED" ? occurredAt : entry.openedAt;
    entry.archivedAt = input.state === "ARCHIVED" ? occurredAt : null;
    entry.updatedAt = occurredAt;
    entry.history.push({
      id: this.nextId("history"),
      sequence: entry.history.length + 1,
      fromState,
      toState: input.state,
      action,
      commandId: input.commandId,
      occurredAt,
    });
    this.stateCommands.add(input.commandId);
    return structuredClone(entry);
  }

  async setFeedback(userId: string, input: SetResearchInboxFeedbackInput) {
    const entry = this.entries.get(input.entryId);
    if (!entry || entry.userId !== userId) return null;
    if (!this.feedbackCommands.has(input.commandId)) {
      entry.feedback = input.value;
      this.feedbackCommands.add(input.commandId);
    }
    return structuredClone(entry);
  }

  private nextId(prefix: string) {
    this.sequence += 1;
    return `${prefix}_${String(this.sequence).padStart(6, "0")}`;
  }
}

function matchesFilter(state: ResearchInboxState, filter: ResearchInboxFilter) {
  if (filter === "PENDING") return state !== "ARCHIVED";
  return state === filter;
}

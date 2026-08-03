import { researchInboxBodySchema } from "~/contracts/research-inbox";
import type { ResearchInboxRepository } from "~/server/domain/research-inbox/repository";
import type {
  ChangeResearchInboxStateInput,
  CreateResearchInboxEntryInput,
  ResearchInboxFilter,
  ResearchInboxState,
  SetResearchInboxFeedbackInput,
} from "~/server/domain/research-inbox/types";

export class ResearchInboxValidationError extends Error {
  override name = "ResearchInboxValidationError";
}

export class ResearchInboxEntryNotFoundError extends Error {
  override name = "ResearchInboxEntryNotFoundError";
}

export class ResearchInboxService {
  constructor(
    private readonly repository: ResearchInboxRepository,
    private readonly dependencies: { clock: () => Date } = {
      clock: () => new Date(),
    },
  ) {}

  async recordDistribution(input: CreateResearchInboxEntryInput) {
    validateDistribution(input);
    return this.repository.recordDistribution(
      { ...input, body: researchInboxBodySchema.parse(input.body) },
      this.dependencies.clock().toISOString(),
    );
  }

  async list(userId: string, filter: ResearchInboxFilter) {
    const items = await this.repository.list(userId, filter);
    return { items, filter };
  }

  async get(userId: string, entryId: string) {
    return this.requireEntry(await this.repository.get(userId, entryId));
  }

  async open(userId: string, entryId: string, commandId: string) {
    const entry = await this.get(userId, entryId);
    if (entry.state !== "UNREAD") return entry;
    return this.changeState(
      userId,
      { entryId, state: "READ", commandId },
      "OPENED",
    );
  }

  async changeState(
    userId: string,
    input: ChangeResearchInboxStateInput,
    forcedAction?: string,
  ) {
    const changed = await this.repository.changeState(
      userId,
      input,
      this.dependencies.clock().toISOString(),
      forcedAction ?? stateAction(input.state),
    );
    return this.requireEntry(changed);
  }

  async setFeedback(userId: string, input: SetResearchInboxFeedbackInput) {
    return this.requireEntry(await this.repository.setFeedback(userId, input));
  }

  private requireEntry<T>(entry: T | null): T {
    if (!entry)
      throw new ResearchInboxEntryNotFoundError("研究收件箱记录不存在");
    return entry;
  }
}

function validateDistribution(input: CreateResearchInboxEntryInput) {
  if (
    !input.distributionKey.trim() ||
    !input.title.trim() ||
    !input.summary.trim()
  ) {
    throw new ResearchInboxValidationError("分发身份、标题和摘要不能为空");
  }
  const subjectCount = [
    input.eventRevisionId,
    input.candidateId,
    input.briefingTaskId,
  ].filter(Boolean).length;
  if (subjectCount !== 1) {
    throw new ResearchInboxValidationError(
      "站内权威记录必须且只能引用一个分发主体",
    );
  }
  if ((input.entryKind === "BRIEFING") !== Boolean(input.briefingTaskId)) {
    throw new ResearchInboxValidationError("简报记录与简报任务引用不一致");
  }
}

function stateAction(state: ResearchInboxState) {
  const actions: Record<ResearchInboxState, string> = {
    UNREAD: "RESTORED_UNREAD",
    READ: "MARKED_READ",
    LATER: "SAVED_FOR_LATER",
    ARCHIVED: "ARCHIVED",
  };
  return actions[state];
}

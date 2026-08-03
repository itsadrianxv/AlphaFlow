import {
  type ResearchPreferenceExplanation,
  type ResearchPreferenceChannels,
  type ResearchPreferenceImportCandidate,
  type ResearchPreferenceItem,
  type ResearchPreferenceMatchInput,
  type ResearchPreferenceSnapshot,
  type ResearchPreferenceState,
  type ResearchPreferenceTarget,
  researchPreferenceItemSchema,
  researchPreferenceTargetSchema,
} from "~/contracts/research-preference";
import type { ResearchPreferenceRepository } from "~/server/domain/research-preference/repository";
import {
  buildSnapshotContent,
  deduplicateItems,
  hasDirectFocusMatch,
  hashPreferenceContent,
  normalizeItem,
  normalizeTarget,
  type ResearchPreferenceCommand,
  resolvePreferenceMatches,
} from "~/server/domain/research-preference/research-preference";

export class ResearchPreferenceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResearchPreferenceValidationError";
  }
}

export class ResearchPreferenceSnapshotNotFoundError extends Error {
  constructor(snapshotId: string) {
    super(`研究偏好快照不存在或不可访问：${snapshotId}`);
    this.name = "ResearchPreferenceSnapshotNotFoundError";
  }
}

export type ResearchPreferenceServiceOptions = {
  clock?: () => Date;
};

export class ResearchPreferenceService {
  private readonly clock: () => Date;

  constructor(
    private readonly repository: ResearchPreferenceRepository,
    options: ResearchPreferenceServiceOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date());
  }

  getCurrent(userId: string): Promise<ResearchPreferenceState> {
    return this.repository.getCurrent(requireUserId(userId));
  }

  async listImportCandidates(
    userId: string,
  ): Promise<ResearchPreferenceImportCandidate[]> {
    return this.repository.listImportCandidates(requireUserId(userId));
  }

  execute(
    userId: string,
    command: ResearchPreferenceCommand,
  ): Promise<ResearchPreferenceState> {
    const normalizedUserId = requireUserId(userId);
    const normalizedCommand = normalizeCommand(command);
    return this.repository.applyCommand(normalizedUserId, normalizedCommand);
  }

  applyCommand(
    userId: string,
    command: ResearchPreferenceCommand,
  ): Promise<ResearchPreferenceState> {
    return this.execute(userId, command);
  }

  async add(
    userId: string,
    input: {
      commandId: string;
      target: ResearchPreferenceTarget;
      level?: ResearchPreferenceItem["level"];
    },
  ): Promise<ResearchPreferenceState> {
    const item = researchPreferenceItemSchema.parse({
      ...normalizeTarget(input.target),
      level: input.level ?? "REGULAR",
    });
    return this.execute(userId, {
      commandId: input.commandId,
      type: "ADD",
      item,
    });
  }

  async import(
    userId: string,
    input: { commandId: string; targets: ResearchPreferenceTarget[] },
  ): Promise<ResearchPreferenceState> {
    const targets = input.targets.map((target) =>
      researchPreferenceTargetSchema.parse(target),
    );
    return this.execute(userId, {
      commandId: input.commandId,
      type: "IMPORT",
      items: targets,
    });
  }

  async remove(
    userId: string,
    input: { commandId: string; target: ResearchPreferenceTarget },
  ): Promise<ResearchPreferenceState> {
    return this.execute(userId, {
      commandId: input.commandId,
      type: "REMOVE",
      target: normalizeTarget(input.target),
    });
  }

  async setLevel(
    userId: string,
    input: {
      commandId: string;
      target: ResearchPreferenceTarget;
      level: ResearchPreferenceItem["level"];
    },
  ): Promise<ResearchPreferenceState> {
    return this.execute(userId, {
      commandId: input.commandId,
      type: "SET_LEVEL",
      target: normalizeTarget(input.target),
      level: input.level,
    });
  }

  restore(
    userId: string,
    input: { commandId: string; target: ResearchPreferenceTarget },
  ): Promise<ResearchPreferenceState> {
    return this.execute(userId, {
      commandId: input.commandId,
      type: "RESTORE",
      target: normalizeTarget(input.target),
    });
  }

  setEnabled(
    userId: string,
    input: { commandId: string; enabled: boolean },
  ): Promise<ResearchPreferenceState> {
    return this.execute(userId, {
      commandId: input.commandId,
      type: "SET_ENABLED",
      enabled: input.enabled,
    });
  }

  setChannels(
    userId: string,
    input: {
      commandId: string;
      channels: Partial<ResearchPreferenceChannels>;
    },
  ): Promise<ResearchPreferenceState> {
    const channels = {
      ...(input.channels.urgentAlertsEnabled === undefined
        ? {}
        : { urgentAlertsEnabled: input.channels.urgentAlertsEnabled }),
      ...(input.channels.briefingsEnabled === undefined
        ? {}
        : { briefingsEnabled: input.channels.briefingsEnabled }),
      ...(input.channels.externalCopiesEnabled === undefined
        ? {}
        : { externalCopiesEnabled: input.channels.externalCopiesEnabled }),
    };
    if (Object.keys(channels).length === 0) {
      throw new ResearchPreferenceValidationError(
        "至少需要修改一个用户级分发开关",
      );
    }
    return this.execute(userId, {
      commandId: input.commandId,
      type: "SET_CHANNELS",
      channels,
    });
  }

  clear(userId: string, commandId: string): Promise<ResearchPreferenceState> {
    return this.execute(userId, { commandId, type: "CLEAR" });
  }

  async freeze(userId: string): Promise<ResearchPreferenceSnapshot> {
    const normalizedUserId = requireUserId(userId);
    const state = await this.repository.getCurrent(normalizedUserId);
    const content = buildSnapshotContent({
      ...state,
      items: deduplicateItems(state.items),
    });
    const contentHash = hashPreferenceContent(content);
    return this.repository.createOrGetSnapshot(
      normalizedUserId,
      content,
      contentHash,
      this.clock(),
    );
  }

  async explain(input: {
    userId: string;
    snapshotId: string;
    candidates: ResearchPreferenceMatchInput[];
  }): Promise<ResearchPreferenceExplanation> {
    const snapshot = await this.repository.getSnapshotForUser(
      requireUserId(input.userId),
      input.snapshotId,
    );
    if (!snapshot) {
      throw new ResearchPreferenceSnapshotNotFoundError(input.snapshotId);
    }
    const matches = resolvePreferenceMatches(snapshot.items, input.candidates);
    return {
      snapshotId: snapshot.id,
      matches,
      hasDirectFocusMatch: hasDirectFocusMatch(matches),
    };
  }

  deletePersonalData(userId: string): Promise<void> {
    return this.repository.deletePersonalData(
      requireUserId(userId),
      this.clock(),
    );
  }
}

function requireUserId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized)
    throw new ResearchPreferenceValidationError("用户标识不能为空");
  return normalized;
}

function normalizeCommand(
  command: ResearchPreferenceCommand,
): ResearchPreferenceCommand {
  const commandId = command.commandId.trim();
  if (!commandId)
    throw new ResearchPreferenceValidationError("命令标识不能为空");

  switch (command.type) {
    case "ADD":
      return { ...command, commandId, item: normalizeItem(command.item) };
    case "IMPORT":
      if (command.items.length === 0) {
        throw new ResearchPreferenceValidationError("导入关注不能为空");
      }
      return {
        ...command,
        commandId,
        items: deduplicateItems(
          command.items.map((target) => ({
            ...normalizeTarget(target),
            level: "REGULAR",
          })),
        ).map(({ targetType, targetKey }) => ({ targetType, targetKey })),
      };
    case "SET_LEVEL":
      return {
        ...command,
        commandId,
        target: normalizeTarget(command.target),
      };
    case "REMOVE":
      return { ...command, commandId, target: normalizeTarget(command.target) };
    case "RESTORE":
      return { ...command, commandId, target: normalizeTarget(command.target) };
    case "SET_CHANNELS":
      if (Object.keys(command.channels).length === 0) {
        throw new ResearchPreferenceValidationError(
          "至少需要修改一个用户级分发开关",
        );
      }
      return { ...command, commandId };
    case "SET_ENABLED":
    case "CLEAR":
      return { ...command, commandId };
  }
}

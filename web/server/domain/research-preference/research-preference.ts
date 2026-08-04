import { createHash } from "node:crypto";
import {
  type ResearchPreferenceChannels,
  type ResearchPreferenceItem,
  type ResearchPreferenceLevel,
  type ResearchPreferenceMatch,
  type ResearchPreferenceMatchInput,
  type ResearchPreferenceSnapshot,
  type ResearchPreferenceState,
  type ResearchPreferenceTarget,
  type ResearchPreferenceTargetType,
  researchPreferenceItemSchema,
  researchPreferenceLevelSchema,
  researchPreferenceTargetSchema,
  researchPreferenceTargetTypeSchema,
} from "~/contracts/research-preference";

export const RESEARCH_PREFERENCE_CONTRACT_VERSION = "1.0";

export type ResearchPreferenceCommand =
  | {
      commandId: string;
      type: "ADD";
      item: ResearchPreferenceItem;
    }
  | {
      commandId: string;
      type: "IMPORT";
      items: ResearchPreferenceTarget[];
    }
  | {
      commandId: string;
      type: "SET_LEVEL";
      target: ResearchPreferenceTarget;
      level: ResearchPreferenceLevel;
    }
  | {
      commandId: string;
      type: "REMOVE";
      target: ResearchPreferenceTarget;
    }
  | {
      commandId: string;
      type: "RESTORE";
      target: ResearchPreferenceTarget;
    }
  | {
      commandId: string;
      type: "SET_ENABLED";
      enabled: boolean;
    }
  | {
      commandId: string;
      type: "SET_CHANNELS";
      channels: Partial<ResearchPreferenceChannels>;
    }
  | {
      commandId: string;
      type: "CLEAR";
    };

export type ResearchPreferenceSnapshotInput = Omit<
  ResearchPreferenceSnapshot,
  "id" | "userId" | "contentHash" | "frozenAt" | "personalDataDeletedAt"
>;

const targetTypeOrder: Record<ResearchPreferenceTargetType, number> = {
  COMPANY: 0,
  INDUSTRY: 1,
  THEME: 2,
  RESEARCH_EVENT: 3,
  RESEARCH_HYPOTHESIS: 4,
};

export function normalizeTarget(
  target: ResearchPreferenceTarget,
): ResearchPreferenceTarget {
  const parsed = researchPreferenceTargetSchema.parse(target);
  return {
    targetType: researchPreferenceTargetTypeSchema.parse(parsed.targetType),
    targetKey: parsed.targetKey.trim(),
  };
}

export function normalizeItem(
  item: ResearchPreferenceItem,
): ResearchPreferenceItem {
  const parsed = researchPreferenceItemSchema.parse(item);
  return {
    ...normalizeTarget(parsed),
    level: researchPreferenceLevelSchema.parse(parsed.level),
  };
}

export function sortItems(
  items: readonly ResearchPreferenceItem[],
): ResearchPreferenceItem[] {
  return items.map(normalizeItem).sort((left, right) => {
    const typeOrder =
      targetTypeOrder[left.targetType] - targetTypeOrder[right.targetType];
    if (typeOrder !== 0) return typeOrder;
    const keyOrder = left.targetKey.localeCompare(right.targetKey, "en");
    if (keyOrder !== 0) return keyOrder;
    return left.level.localeCompare(right.level, "en");
  });
}

export function deduplicateItems(
  items: readonly ResearchPreferenceItem[],
): ResearchPreferenceItem[] {
  const byTarget = new Map<string, ResearchPreferenceItem>();
  for (const item of items) {
    const normalized = normalizeItem(item);
    byTarget.set(
      `${normalized.targetType}:${normalized.targetKey}`,
      normalized,
    );
  }
  return sortItems([...byTarget.values()]);
}

export function targetIdentity(target: ResearchPreferenceTarget): string {
  const normalized = normalizeTarget(target);
  return `${normalized.targetType}:${normalized.targetKey}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashPreferenceContent(
  input: ResearchPreferenceSnapshotInput,
): string {
  const payload = {
    contractVersion: input.contractVersion,
    enabled: input.enabled,
    urgentAlertsEnabled: input.urgentAlertsEnabled,
    briefingsEnabled: input.briefingsEnabled,
    externalCopiesEnabled: input.externalCopiesEnabled,
    items: sortItems(input.items),
  };
  return `sha256:${createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex")}`;
}

export function buildSnapshotContent(
  state: ResearchPreferenceState,
): ResearchPreferenceSnapshotInput {
  return {
    contractVersion: RESEARCH_PREFERENCE_CONTRACT_VERSION,
    enabled: state.enabled,
    urgentAlertsEnabled: state.urgentAlertsEnabled,
    briefingsEnabled: state.briefingsEnabled,
    externalCopiesEnabled: state.externalCopiesEnabled,
    items: sortItems(state.items),
  };
}

export function hasDirectFocusMatch(
  matches: readonly ResearchPreferenceMatch[],
): boolean {
  return matches.some(
    (match) => match.relation === "DIRECT" && match.level === "FOCUS",
  );
}

export function resolvePreferenceMatches(
  items: readonly ResearchPreferenceItem[],
  candidates: readonly (
    | ResearchPreferenceMatchInput
    | {
        targetType: string;
        targetKey: string;
        relation: "DIRECT" | "WEAK";
        path?: string[];
      }
  )[],
): ResearchPreferenceMatch[] {
  const byTarget = new Map(
    sortItems(items).map((item) => [targetIdentity(item), item]),
  );
  const matches = new Map<string, ResearchPreferenceMatch>();

  for (const candidate of candidates) {
    const parsedCandidate = researchPreferenceTargetSchema.safeParse(candidate);
    if (!parsedCandidate.success) continue;
    const normalized = normalizeTarget(parsedCandidate.data);
    const item = byTarget.get(targetIdentity(normalized));
    if (!item) continue;
    const relation = candidate.relation;
    const match: ResearchPreferenceMatch = {
      ...item,
      relation,
      ...(candidate.path ? { path: [...candidate.path] } : {}),
      // 弱传播永远不能继承重点关注资格。
      level: relation === "WEAK" ? "REGULAR" : item.level,
    };
    const key = `${targetIdentity(match)}:${match.relation}`;
    matches.set(key, match);
  }

  return [...matches.values()].sort((left, right) => {
    const identityOrder = targetIdentity(left).localeCompare(
      targetIdentity(right),
      "en",
    );
    if (identityOrder !== 0) return identityOrder;
    return left.relation.localeCompare(right.relation, "en");
  });
}

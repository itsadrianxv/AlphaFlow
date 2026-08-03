import type { ResearchPreferenceSnapshot } from "~/contracts/research-preference";
import type { ResearchInboxService } from "~/server/application/research-inbox/research-inbox-service";
import type {
  ResearchInboxBody,
  ResearchInboxChannel,
  ResearchInboxEntryKind,
} from "~/server/domain/research-inbox/types";
import {
  CIRCUIT_RETRY_DELAYS_MS,
  DELIVERY_MAX_ATTEMPTS,
  DELIVERY_RETRY_BUDGET_MS,
  retryDelayMs,
} from "~/server/domain/scheduling/policies";
import { LeaseLostError } from "~/server/domain/scheduling/types";

export type DistributionScore = 0 | 1 | 2 | 3 | 4 | null;

export type DistributionCandidate = {
  distributionKey: string;
  userId: string;
  subject: {
    kind: "EVENT_REVISION" | "CANDIDATE";
    id: string;
  };
  revisionKind: "EVENT" | "PENDING_VERIFICATION" | "CORRECTION" | "RETRACTION";
  title: string;
  summary: string;
  body: ResearchInboxBody;
  scores: {
    importance: DistributionScore;
    confidence: DistributionScore;
    relevance: DistributionScore;
    informationNovelty: DistributionScore;
  };
  directPreferenceMatch: boolean;
  directFocusMatch: boolean;
  preferenceSnapshot: ResearchPreferenceSnapshot;
  sourceIdentityVerified: boolean;
  coreFactEvidenceQualified: boolean;
  anomalyOnly: boolean;
  globalAssessmentId?: string;
  relevanceAssessmentId?: string;
};

export type DistributionDecision = {
  highestChannel: ResearchInboxChannel;
  reasons: string[];
};

export type BriefingSlot = "PRE_MARKET" | "CLOSE" | "EVENING";

export type BriefingCandidate = {
  id: string;
  revisionKind: "EVENT" | "CORRECTION" | "RETRACTION";
  importance: DistributionScore;
  confidence: DistributionScore;
  informationNovelty: DistributionScore;
};

export type BriefingScope = {
  status: "READY" | "SKIPPED_NO_INCREMENT";
  slot: BriefingSlot;
  taskId: string;
  userId: string;
  includedIds: string[];
  mandatoryIds: string[];
};

export type BriefingDraft = {
  includedIds: string[];
  title: string;
  summary: string;
  body: ResearchInboxBody;
};

export type FeishuDeliveryPayload = {
  idempotencyKey: string;
  title: string;
  reason: string;
  status: string;
  inboxLink: string;
};

export interface FeishuDeliveryPort {
  send(payload: FeishuDeliveryPayload): Promise<void>;
}

export interface FeishuDeliveryGuard {
  run(copyId: string, operation: () => Promise<void>): Promise<void>;
}

export class FeishuDeliveryError extends Error {
  override name = "FeishuDeliveryError";

  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
  ) {
    super(code);
  }
}

export type FeishuCopyStatus =
  | "PENDING"
  | "RETRY_WAIT"
  | "DEFERRED_CIRCUIT"
  | "SENT"
  | "FAILED"
  | "CONFIG_BLOCKED";

export type FeishuCopy = {
  id: string;
  entryId: string;
  idempotencyKey: string;
  payload: FeishuDeliveryPayload;
  status: FeishuCopyStatus;
  attempts: number;
  firstAttemptAt: string | null;
  retryDeadline: string;
  nextAttemptAt: string | null;
  sentAt: string | null;
  lastErrorCode: string | null;
};

export type FeishuCircuit = {
  state: "CLOSED" | "OPEN" | "HALF_OPEN";
  consecutiveFailures: number;
  openCount: number;
  retryAfter: string | null;
};

export interface ResearchDistributionStore {
  createCopy(input: {
    entryId: string;
    payload: FeishuDeliveryPayload;
    now: Date;
  }): Promise<{ copy: FeishuCopy; created: boolean }>;
  getCopy(id: string): Promise<FeishuCopy | null>;
  getCopyByKey(idempotencyKey: string): Promise<FeishuCopy | null>;
  saveCopy(copy: FeishuCopy): Promise<FeishuCopy>;
  getCircuit(): Promise<FeishuCircuit>;
  saveCircuit(circuit: FeishuCircuit): Promise<FeishuCircuit>;
}

export class InMemoryResearchDistributionStore
  implements ResearchDistributionStore
{
  private readonly copies = new Map<string, FeishuCopy>();
  private readonly copyIdByKey = new Map<string, string>();
  private circuit: FeishuCircuit = {
    state: "CLOSED",
    consecutiveFailures: 0,
    openCount: 0,
    retryAfter: null,
  };
  private sequence = 0;

  async createCopy(input: {
    entryId: string;
    payload: FeishuDeliveryPayload;
    now: Date;
  }) {
    const existingId = this.copyIdByKey.get(input.payload.idempotencyKey);
    if (existingId) {
      const existing = this.copies.get(existingId);
      if (!existing) throw new Error("Feishu 副本幂等索引失效");
      return { copy: structuredClone(existing), created: false };
    }
    this.sequence += 1;
    const copy: FeishuCopy = {
      id: `feishu_copy_${this.sequence}`,
      entryId: input.entryId,
      idempotencyKey: input.payload.idempotencyKey,
      payload: structuredClone(input.payload),
      status: "PENDING",
      attempts: 0,
      firstAttemptAt: null,
      retryDeadline: new Date(
        input.now.getTime() + DELIVERY_RETRY_BUDGET_MS,
      ).toISOString(),
      nextAttemptAt: null,
      sentAt: null,
      lastErrorCode: null,
    };
    this.copies.set(copy.id, copy);
    this.copyIdByKey.set(copy.idempotencyKey, copy.id);
    return { copy: structuredClone(copy), created: true };
  }

  async getCopy(id: string) {
    const copy = this.copies.get(id);
    return copy ? structuredClone(copy) : null;
  }

  async getCopyByKey(idempotencyKey: string) {
    const id = this.copyIdByKey.get(idempotencyKey);
    return id ? await this.getCopy(id) : null;
  }

  async saveCopy(copy: FeishuCopy) {
    this.copies.set(copy.id, structuredClone(copy));
    return structuredClone(copy);
  }

  async getCircuit() {
    return structuredClone(this.circuit);
  }

  async saveCircuit(circuit: FeishuCircuit) {
    this.circuit = structuredClone(circuit);
    return this.getCircuit();
  }
}

export class ResearchDistributionService {
  constructor(
    private readonly inbox: ResearchInboxService,
    private readonly store: ResearchDistributionStore,
    private readonly dependencies: {
      clock: () => Date;
      feishu?: FeishuDeliveryPort;
      feishuGuard?: FeishuDeliveryGuard;
      inboxLink?: (entryId: string) => string;
    } = {
      clock: () => new Date(),
    },
  ) {}

  async distribute(candidate: DistributionCandidate) {
    validateCandidateSubject(candidate);
    const decision = decideDistribution(candidate);
    const entryKind = toEntryKind(candidate.revisionKind);
    const result = await this.inbox.recordDistribution({
      distributionKey: candidate.distributionKey,
      userId: candidate.userId,
      ...(candidate.subject.kind === "EVENT_REVISION"
        ? { eventRevisionId: candidate.subject.id }
        : { candidateId: candidate.subject.id }),
      globalAssessmentId: candidate.globalAssessmentId,
      relevanceAssessmentId: candidate.relevanceAssessmentId,
      preferenceSnapshotId: candidate.preferenceSnapshot.id,
      highestChannel: decision.highestChannel,
      entryKind,
      title: titleFor(candidate.revisionKind, candidate.title),
      summary: candidate.summary,
      body: candidate.body,
    });
    return {
      ...result,
      decision,
      externalCopy: shouldSendExternalCopy(candidate, decision)
        ? await this.ensureExternalCopy(result, decision)
        : null,
    };
  }

  async retryFeishuCopy(copyId: string) {
    const copy = await this.store.getCopy(copyId);
    if (!copy) throw new Error("Feishu 副本不存在");
    return this.attemptFeishuCopy(copy);
  }

  freezeBriefingScope(input: {
    slot: BriefingSlot;
    taskId: string;
    userId: string;
    capacity: number;
    candidates: BriefingCandidate[];
  }): BriefingScope {
    if (!Number.isInteger(input.capacity) || input.capacity < 0) {
      throw new Error("简报容量必须是非负整数");
    }
    const mandatory = input.candidates.filter(isMandatoryBriefingItem);
    const optional = input.candidates
      .filter(
        (candidate) =>
          !isMandatoryBriefingItem(candidate) &&
          [
            candidate.importance,
            candidate.confidence,
            candidate.informationNovelty,
          ].every((score) => atLeast(score, 2)),
      )
      .sort(
        (left, right) =>
          briefingPriority(right) - briefingPriority(left) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, input.capacity);
    const includedIds = [...mandatory, ...optional].map((item) => item.id);
    return {
      status:
        input.slot === "EVENING" && includedIds.length === 0
          ? "SKIPPED_NO_INCREMENT"
          : "READY",
      slot: input.slot,
      taskId: input.taskId,
      userId: input.userId,
      includedIds,
      mandatoryIds: mandatory.map((item) => item.id),
    };
  }

  validateBriefingDraft(
    scope: BriefingScope,
    draft: { includedIds: string[] },
  ) {
    const included = new Set(draft.includedIds);
    if (scope.mandatoryIds.some((id) => !included.has(id))) {
      throw new Error("简报草稿不能删除必显更正或撤回");
    }
    if (
      draft.includedIds.length !== scope.includedIds.length ||
      scope.includedIds.some((id) => !included.has(id))
    ) {
      throw new Error("简报草稿必须严格使用确定性冻结候选");
    }
    return scope;
  }

  async publishBriefing(input: {
    scope: BriefingScope;
    draft: BriefingDraft;
    preferenceSnapshot: ResearchPreferenceSnapshot;
  }) {
    if (input.scope.status === "SKIPPED_NO_INCREMENT") {
      return {
        status: "SKIPPED_NO_INCREMENT" as const,
        entry: null,
        externalCopy: null,
      };
    }
    validatePreferenceSnapshot(input.scope.userId, input.preferenceSnapshot);
    if (!input.preferenceSnapshot.briefingsEnabled) {
      return {
        status: "SKIPPED_CHANNEL_DISABLED" as const,
        entry: null,
        externalCopy: null,
      };
    }
    this.validateBriefingDraft(input.scope, input.draft);
    const decision: DistributionDecision = {
      highestChannel: "BRIEFING",
      reasons: ["定时简报按确定性冻结范围生成"],
    };
    const result = await this.inbox.recordDistribution({
      distributionKey: `briefing:${input.scope.userId}:${input.scope.taskId}`,
      userId: input.scope.userId,
      briefingTaskId: input.scope.taskId,
      preferenceSnapshotId: input.preferenceSnapshot.id,
      highestChannel: "BRIEFING",
      entryKind: "BRIEFING",
      title: input.draft.title,
      summary: input.draft.summary,
      body: input.draft.body,
    });
    return {
      status: "PUBLISHED" as const,
      ...result,
      decision,
      externalCopy: input.preferenceSnapshot.externalCopiesEnabled
        ? await this.ensureExternalCopy(result, decision)
        : null,
    };
  }

  private async ensureExternalCopy(
    result: Awaited<ReturnType<ResearchInboxService["recordDistribution"]>>,
    decision: DistributionDecision,
  ) {
    const idempotencyKey = `feishu:${result.entry.id}`;
    if (!result.created) {
      const existing = await this.store.getCopyByKey(idempotencyKey);
      if (existing) return existing;
    }
    const queued = await this.store.createCopy({
      entryId: result.entry.id,
      now: this.dependencies.clock(),
      payload: {
        idempotencyKey,
        title: result.entry.title,
        reason: decision.reasons.join("；"),
        status: result.entry.body.eventStatus,
        inboxLink:
          this.dependencies.inboxLink?.(result.entry.id) ??
          `/research/inbox/${result.entry.id}`,
      },
    });
    return this.attemptFeishuCopy(queued.copy);
  }

  private async attemptFeishuCopy(copy: FeishuCopy): Promise<FeishuCopy> {
    const now = this.dependencies.clock();
    if (copy.status === "SENT" || copy.status === "FAILED") return copy;
    const feishu = this.dependencies.feishu;
    const feishuGuard = this.dependencies.feishuGuard;
    if (!feishu || !feishuGuard) {
      return this.store.saveCopy({
        ...copy,
        status: "CONFIG_BLOCKED",
        lastErrorCode: !feishu
          ? "FEISHU_PORT_NOT_CONFIGURED"
          : "FEISHU_PERMIT_GUARD_NOT_CONFIGURED",
      });
    }
    const circuit = await this.store.getCircuit();
    if (circuit.state === "OPEN") {
      if (!circuit.retryAfter || new Date(circuit.retryAfter) > now) {
        return this.store.saveCopy({
          ...copy,
          status: "DEFERRED_CIRCUIT",
          nextAttemptAt: circuit.retryAfter,
        });
      }
      circuit.state = "HALF_OPEN";
      circuit.retryAfter = null;
      await this.store.saveCircuit(circuit);
    }
    if (copy.nextAttemptAt && new Date(copy.nextAttemptAt) > now) return copy;
    if (
      copy.attempts >= DELIVERY_MAX_ATTEMPTS ||
      new Date(copy.retryDeadline) <= now
    ) {
      return this.store.saveCopy({
        ...copy,
        status: "FAILED",
        nextAttemptAt: null,
        lastErrorCode: copy.lastErrorCode ?? "DELIVERY_BUDGET_EXHAUSTED",
      });
    }

    const attempted: FeishuCopy = {
      ...copy,
      attempts: copy.attempts + 1,
      firstAttemptAt: copy.firstAttemptAt ?? now.toISOString(),
      nextAttemptAt: null,
    };
    try {
      await feishuGuard.run(attempted.id, () => feishu.send(attempted.payload));
      await this.store.saveCircuit({
        state: "CLOSED",
        consecutiveFailures: 0,
        openCount: circuit.openCount,
        retryAfter: null,
      });
      return this.store.saveCopy({
        ...attempted,
        status: "SENT",
        sentAt: now.toISOString(),
        lastErrorCode: null,
      });
    } catch (error) {
      if (error instanceof LeaseLostError) throw error;
      const deliveryError =
        error instanceof FeishuDeliveryError
          ? error
          : new FeishuDeliveryError("FEISHU_UNKNOWN_ERROR", false);
      const failures = deliveryError.retryable
        ? circuit.consecutiveFailures + 1
        : 0;
      const nextCircuit = { ...circuit, consecutiveFailures: failures };
      if (deliveryError.retryable && failures >= 5) {
        nextCircuit.state = "OPEN";
        nextCircuit.openCount += 1;
        nextCircuit.retryAfter = new Date(
          now.getTime() + circuitDelayMs(nextCircuit.openCount),
        ).toISOString();
      }
      await this.store.saveCircuit(nextCircuit);
      const exhausted =
        !deliveryError.retryable || attempted.attempts >= DELIVERY_MAX_ATTEMPTS;
      const terminalStatus: FeishuCopyStatus =
        !deliveryError.retryable &&
        deliveryError.code.startsWith("FEISHU_BUSINESS_")
          ? "CONFIG_BLOCKED"
          : "FAILED";
      return this.store.saveCopy({
        ...attempted,
        status: exhausted ? terminalStatus : "RETRY_WAIT",
        nextAttemptAt: exhausted
          ? null
          : new Date(
              Math.max(
                now.getTime() + retryDelayMs(attempted.attempts),
                deliveryError.retryAfterMs
                  ? now.getTime() + deliveryError.retryAfterMs
                  : 0,
                nextCircuit.retryAfter
                  ? new Date(nextCircuit.retryAfter).getTime()
                  : 0,
              ),
            ).toISOString(),
        lastErrorCode: deliveryError.code,
      });
    }
  }
}

export function briefingScheduleForTradingDay(tradingDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) {
    throw new Error("交易日必须使用 YYYY-MM-DD");
  }
  const at = (time: string) => {
    const value = new Date(`${tradingDate}T${time}:00+08:00`);
    if (Number.isNaN(value.getTime())) throw new Error("交易日无效");
    return value.toISOString();
  };
  return {
    PRE_MARKET: at("08:50"),
    CLOSE: at("16:45"),
    EVENING: at("22:50"),
  } satisfies Record<BriefingSlot, string>;
}

export function decideDistribution(
  candidate: DistributionCandidate,
): DistributionDecision {
  if (qualifiesForUrgent(candidate)) {
    return {
      highestChannel: "URGENT_ALERT",
      reasons: ["满足紧急提醒的确定性门槛"],
    };
  }
  if (qualifiesForBriefing(candidate)) {
    return {
      highestChannel: "BRIEFING",
      reasons: ["满足定时简报的确定性门槛"],
    };
  }
  return {
    highestChannel: "IN_APP",
    reasons: ["有效内容仅进入站内权威记录"],
  };
}

function qualifiesForUrgent(candidate: DistributionCandidate) {
  if (
    !candidate.preferenceSnapshot.enabled ||
    !candidate.preferenceSnapshot.urgentAlertsEnabled ||
    !candidate.directPreferenceMatch ||
    !candidate.directFocusMatch
  ) {
    return false;
  }
  const { importance, confidence, relevance, informationNovelty } =
    candidate.scores;
  if (candidate.revisionKind === "PENDING_VERIFICATION") {
    return (
      candidate.sourceIdentityVerified &&
      candidate.coreFactEvidenceQualified &&
      !candidate.anomalyOnly &&
      atLeast(importance, 3) &&
      confidence !== null &&
      confidence >= 1 &&
      confidence <= 2 &&
      atLeast(relevance, 3) &&
      atLeast(informationNovelty, 3)
    );
  }
  return [importance, confidence, relevance, informationNovelty].every(
    (score) => atLeast(score, 3),
  );
}

function validateCandidateSubject(candidate: DistributionCandidate) {
  if (
    candidate.revisionKind === "PENDING_VERIFICATION" &&
    candidate.subject.kind !== "CANDIDATE"
  ) {
    throw new Error("暂缓候选必须引用候选主体");
  }
  if (
    candidate.revisionKind !== "PENDING_VERIFICATION" &&
    candidate.subject.kind !== "EVENT_REVISION"
  ) {
    throw new Error("事件通知必须引用事件修订");
  }
  validatePreferenceSnapshot(candidate.userId, candidate.preferenceSnapshot);
}

function validatePreferenceSnapshot(
  userId: string,
  snapshot: ResearchPreferenceSnapshot,
) {
  if (snapshot.userId !== userId) {
    throw new Error("研究偏好快照不属于分发用户");
  }
  if (snapshot.personalDataDeletedAt) {
    throw new Error("已删除个人数据的偏好快照不能用于分发");
  }
}

function shouldSendExternalCopy(
  candidate: DistributionCandidate,
  decision: DistributionDecision,
) {
  if (!candidate.preferenceSnapshot.externalCopiesEnabled) return false;
  return (
    decision.highestChannel === "URGENT_ALERT" ||
    decision.highestChannel === "BRIEFING" ||
    candidate.revisionKind === "CORRECTION" ||
    candidate.revisionKind === "RETRACTION"
  );
}

function qualifiesForBriefing(candidate: DistributionCandidate) {
  if (
    candidate.revisionKind === "PENDING_VERIFICATION" ||
    !candidate.preferenceSnapshot.briefingsEnabled
  ) {
    return false;
  }
  const { importance, confidence, informationNovelty } = candidate.scores;
  return [importance, confidence, informationNovelty].every((score) =>
    atLeast(score, 2),
  );
}

function atLeast(score: DistributionScore, threshold: number) {
  return score !== null && score >= threshold;
}

function isMandatoryBriefingItem(candidate: BriefingCandidate) {
  return (
    candidate.revisionKind === "CORRECTION" ||
    candidate.revisionKind === "RETRACTION"
  );
}

function briefingPriority(candidate: BriefingCandidate) {
  return (
    (candidate.importance ?? -1) * 100 +
    (candidate.informationNovelty ?? -1) * 10 +
    (candidate.confidence ?? -1)
  );
}

function circuitDelayMs(openCount: number) {
  const index = Math.min(
    CIRCUIT_RETRY_DELAYS_MS.length - 1,
    Math.max(0, openCount - 1),
  );
  return CIRCUIT_RETRY_DELAYS_MS[index] ?? 60_000;
}

function toEntryKind(
  revisionKind: DistributionCandidate["revisionKind"],
): ResearchInboxEntryKind {
  const kinds: Record<
    DistributionCandidate["revisionKind"],
    ResearchInboxEntryKind
  > = {
    EVENT: "EVENT",
    PENDING_VERIFICATION: "CANDIDATE_PENDING_VERIFICATION",
    CORRECTION: "CORRECTION",
    RETRACTION: "RETRACTION",
  };
  return kinds[revisionKind];
}

function titleFor(
  revisionKind: DistributionCandidate["revisionKind"],
  title: string,
) {
  const prefixes: Partial<
    Record<DistributionCandidate["revisionKind"], string>
  > = {
    PENDING_VERIFICATION: "待核实",
    CORRECTION: "更正",
    RETRACTION: "撤回",
  };
  const prefix = prefixes[revisionKind];
  return prefix && !title.includes(prefix) ? `【${prefix}】${title}` : title;
}

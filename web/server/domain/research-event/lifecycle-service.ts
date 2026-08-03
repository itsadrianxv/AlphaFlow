import { createHash } from "node:crypto";
import type {
  ResearchEventLifecycleStore,
  ResearchEventLifecycleStoreTransaction,
} from "./store";
import {
  type AdjudicateCandidateInput,
  type AdjudicateCandidateResult,
  type CandidateBackfillResult,
  type CandidateDecision,
  type CandidateEvidence,
  type CandidateMaterial,
  type CandidateMaterialConflict,
  type CandidateMaterialInput,
  type CandidateSeedInput,
  type CandidateStatus,
  type FactClaimCitation,
  type FactClaimInput,
  RESEARCH_EVENT_CANONICALIZATION_VERSION,
  RESEARCH_EVENT_CONTRACT_VERSION,
  type ResearchEvent,
  type ResearchEventCandidate,
  type ResearchEventRevisionKind,
  type ResearchValueInput,
  type ReviseResearchEventInput,
  type RevisionReadModel,
} from "./types";

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("结构化输入包含非法数字");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  throw new Error("结构化输入包含不支持的值");
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function parseTime(value: string, message: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw new Error(message);
  return timestamp;
}

function assertFuture(value: string, after: string, label: string) {
  if (
    parseTime(value, `${label}不是合法时间`) <=
    parseTime(after, "裁定时间不是合法时间")
  ) {
    throw new Error(`${label}必须晚于裁定时间`);
  }
}

function sameOptional(left: string | undefined, right: string | undefined) {
  return left !== undefined && right !== undefined && left === right;
}

function normalizeIdentityPart(value: string | undefined) {
  return value?.trim() || undefined;
}

function materialIdentityKey(input: CandidateMaterialInput) {
  return sha256(
    stableJson({
      sourceItemKey: normalizeIdentityPart(input.sourceItemKey),
      normalizedUrl: normalizeIdentityPart(input.normalizedUrl),
      contentHash: input.contentHash,
    }),
  );
}

function evidenceIdsHash(evidenceIds: string[]) {
  return sha256(stableJson(evidenceIds));
}

const allowedCandidateTransitions: Record<
  CandidateStatus,
  readonly CandidateStatus[]
> = {
  OPEN: ["DEFERRED", "TECHNICAL_HOLD", "REJECTED", "PROMOTED"],
  DEFERRED: ["DEFERRED", "TECHNICAL_HOLD", "REJECTED", "PROMOTED"],
  TECHNICAL_HOLD: ["TECHNICAL_HOLD", "DEFERRED", "REJECTED", "PROMOTED"],
  PROMOTED: [],
  REJECTED: [],
  DEFERRED_ENDED: [],
};

export class ResearchEventLifecycleService {
  private readonly store: ResearchEventLifecycleStore;
  private readonly now: () => string;

  constructor(
    store?: ResearchEventLifecycleStore,
    now: () => string = () => new Date().toISOString(),
  ) {
    if (!store) {
      throw new Error(
        "必须显式提供研究事件持久化 port；内存 store 只允许由测试注入",
      );
    }
    this.store = store;
    this.now = now;
  }

  getStore() {
    return this.store;
  }

  backfillCandidate(seed: CandidateSeedInput): CandidateBackfillResult {
    return this.store.runTransaction((tx) => {
      const candidateKey = this.candidateKeyFor(seed);
      let candidate = tx.getCandidate(candidateKey);
      if (candidate) {
        this.assertCandidateCanReceiveEvidence(candidate);
        this.assertCandidateIdentity(candidate, seed);
      } else {
        candidate = tx.addCandidate({
          id: tx.nextId("candidate"),
          candidateKey,
          clusterKey:
            seed.clusterKey ??
            (seed.aggregationCertainty === "EXACT"
              ? candidateKey
              : `uncertain:${seed.seedKey}`),
          canonicalizationVersion: RESEARCH_EVENT_CANONICALIZATION_VERSION,
          eventIdentityKey: seed.eventIdentityKey,
          subjectType: seed.subjectType,
          subjectKey: seed.subjectKey,
          status: "OPEN",
          createdAt: this.now(),
          evidenceIds: [],
          materialIds: [],
          decisionIds: [],
          relationIds: [],
        });
      }

      const duplicateMaterialKeys: string[] = [];
      const materialConflicts: CandidateMaterialConflict[] = [];
      const materialIds: string[] = [];
      const materialByInputKey = new Map<string, CandidateMaterial>();

      for (const materialInput of seed.materials) {
        const materialResult = this.resolveMaterial(
          tx,
          candidateKey,
          materialInput,
        );
        if (materialResult.duplicate) {
          duplicateMaterialKeys.push(materialInput.materialKey);
        }
        if (materialResult.conflict) {
          materialConflicts.push(materialResult.conflict);
        }
        materialByInputKey.set(
          materialInput.materialKey,
          materialResult.material,
        );
        materialIds.push(materialResult.material.id);
      }

      candidate.materialIds = unique([
        ...candidate.materialIds,
        ...materialIds,
      ]);

      const evidence: CandidateEvidence[] = [];
      for (const evidenceInput of seed.evidence) {
        const material = evidenceInput.materialKey
          ? (materialByInputKey.get(evidenceInput.materialKey) ??
            tx
              .listMaterials()
              .find(
                (item) =>
                  item.materialKey === evidenceInput.materialKey &&
                  item.candidateKeys.includes(candidateKey),
              ))
          : undefined;
        if (evidenceInput.materialKey && !material) {
          throw new Error(
            `候选证据引用的材料不存在或不属于当前候选: ${evidenceInput.materialKey}`,
          );
        }

        const sourceAssertionId =
          evidenceInput.sourceAssertionId ?? material?.sourceAssertionId;
        const observationRevisionId =
          evidenceInput.observationRevisionId ??
          material?.observationRevisionId;
        const evidenceId = sha256(
          stableJson({
            candidateKey,
            materialId: material?.id,
            sourceAssertionId,
            observationRevisionId,
            evidenceKind: evidenceInput.evidenceKind,
            evidenceRole: evidenceInput.evidenceRole,
            independenceKey: evidenceInput.independenceKey,
            citation: evidenceInput.citation,
          }),
        );
        const existing = tx.getEvidence(evidenceId);
        if (existing) {
          if (existing.candidateKey !== candidateKey) {
            throw new Error(`候选证据 ID 跨候选冲突: ${evidenceId}`);
          }
          evidence.push(existing);
          continue;
        }

        const item = tx.addEvidence({
          ...evidenceInput,
          sourceAssertionId,
          observationRevisionId,
          id: evidenceId,
          candidateKey,
          materialId: material?.id,
          ordinal: candidate.evidenceIds.length,
          qualityStatus: evidenceInput.qualityStatus ?? "NORMAL",
          frozenInDecisionIds: [],
        });
        candidate.evidenceIds.push(item.id);
        evidence.push(item);
      }

      return {
        candidates: [candidate],
        materials: materialIds
          .map((id) => tx.getMaterial(id))
          .filter((item): item is CandidateMaterial => Boolean(item)),
        evidence,
        duplicateMaterialKeys,
        materialConflicts,
      };
    });
  }

  adjudicateCandidate(
    input: AdjudicateCandidateInput,
  ): AdjudicateCandidateResult {
    return this.store.runTransaction((tx) => {
      const existingDecision = tx.findDecision(
        input.candidateKey,
        input.inputHash,
      );
      if (existingDecision) return this.resultForDecision(tx, existingDecision);

      const candidate = requireValue(
        tx.getCandidate(input.candidateKey),
        `研究事件候选不存在: ${input.candidateKey}`,
      );
      const targetStatus = this.targetStatusFor(input.outcome);
      this.assertCandidateTransition(candidate.status, targetStatus);
      this.assertDecisionTiming(input);

      const frozenEvidenceIds = [...candidate.evidenceIds];
      const frozenEvidence = frozenEvidenceIds.map((evidenceId) =>
        this.requireCandidateEvidence(tx, candidate, evidenceId),
      );
      const evidenceSetHash = evidenceIdsHash(frozenEvidenceIds);

      const normalizedClaims =
        input.outcome === "PROMOTE"
          ? this.assertPromotionEligible(
              tx,
              candidate,
              frozenEvidence,
              input.claims ?? [],
              input.researchValue,
            )
          : [];
      const normalizedResearchValue =
        input.outcome === "PROMOTE"
          ? requireValue(
              this.normalizeResearchValue(
                input.researchValue,
                normalizedClaims.length,
              ),
              "晋级研究事件必须包含研究价值",
            )
          : undefined;

      this.assertTechnicalRetry(input);
      this.validateRelations(tx, candidate, frozenEvidenceIds, input);

      const decision: CandidateDecision = tx.addDecision({
        id: tx.nextId("decision"),
        candidateKey: candidate.candidateKey,
        decisionNo: candidate.decisionIds.length + 1,
        inputHash: input.inputHash,
        outcome: input.outcome,
        decidedAt: input.decidedAt,
        evidenceFrozenAt: input.decidedAt,
        frozenEvidenceIds,
        evidenceSetHash,
        evidenceGap: [...(input.evidenceGap ?? [])],
        releaseConditions: [...(input.releaseConditions ?? [])],
        observationWindowEndsAt: input.observationWindowEndsAt,
        nextCheckAt: this.nextCheckAtFor(input),
        technicalRetry: input.technicalRetry
          ? clone(input.technicalRetry)
          : undefined,
        decision: {
          contractVersion: RESEARCH_EVENT_CONTRACT_VERSION,
          claims: normalizedClaims,
          researchValue: normalizedResearchValue,
          ...(input.splitInto ? { splitInto: clone(input.splitInto) } : {}),
          ...(input.mergeCandidateKeys
            ? { mergeCandidateKeys: [...input.mergeCandidateKeys] }
            : {}),
        },
      });

      candidate.decisionIds.push(decision.id);
      candidate.currentDecisionId = decision.id;
      candidate.evidenceFrozenAt = input.decidedAt;
      candidate.frozenEvidenceIds = [...frozenEvidenceIds];
      candidate.evidenceSetHash = evidenceSetHash;
      for (const evidence of frozenEvidence) {
        evidence.frozenInDecisionIds.push(decision.id);
      }

      const splitCandidates = this.applySplits(
        tx,
        candidate,
        input,
        decision.id,
      );
      const mergedCandidateKeys = this.applyMerges(
        tx,
        candidate,
        input,
        decision.id,
      );

      if (input.outcome === "TECHNICAL_HOLD") {
        candidate.status = "TECHNICAL_HOLD";
        candidate.nextCheckAt = this.nextCheckAtFor(input);
        return {
          decision,
          candidate,
          splitCandidates,
          mergedCandidateKeys,
        };
      }

      if (input.outcome === "DEFER") {
        candidate.status = "DEFERRED";
        candidate.observationWindowEndsAt = input.observationWindowEndsAt;
        candidate.nextCheckAt = input.nextCheckAt;
        return {
          decision,
          candidate,
          splitCandidates,
          mergedCandidateKeys,
        };
      }

      if (input.outcome === "REJECT") {
        candidate.status = "REJECTED";
        candidate.closedAt = input.decidedAt;
        candidate.observationWindowEndsAt = undefined;
        candidate.nextCheckAt = undefined;
        return {
          decision,
          candidate,
          splitCandidates,
          mergedCandidateKeys,
        };
      }

      candidate.status = "PROMOTED";
      candidate.closedAt = input.decidedAt;
      candidate.observationWindowEndsAt = undefined;
      candidate.nextCheckAt = undefined;

      const event = this.getOrCreateEvent(tx, candidate);
      const revision = this.createRevision(tx, event, {
        revisionDedupKey: sha256(
          stableJson({
            eventKey: event.eventKey,
            candidateKey: candidate.candidateKey,
            inputHash: input.inputHash,
          }),
        ),
        revisionKind:
          event.revisionIds.length === 0 ? "CONFIRMED" : "REVERIFIED",
        sourceCandidateKey: candidate.candidateKey,
        title: requireValue(input.title, "晋级事件必须有标题"),
        summary: requireValue(input.summary, "晋级事件必须有摘要"),
        narrative: input.narrative ?? {},
        uncertainty: input.uncertainty ?? {},
        counterEvidence: input.counterEvidence ?? {},
        occurredAt: requireValue(input.occurredAt, "晋级事件必须有发生时间"),
        knownAt: input.knownAt ?? input.decidedAt,
        claims: normalizedClaims,
        researchValue: requireValue(
          normalizedResearchValue,
          "晋级研究事件必须包含研究价值",
        ),
      });
      event.currentRevisionId = revision.id;
      decision.linkedEventKey = event.eventKey;

      return {
        decision,
        candidate,
        event,
        revision,
        splitCandidates,
        mergedCandidateKeys,
      };
    });
  }

  reviseEvent(input: ReviseResearchEventInput) {
    return this.store.runTransaction((tx) => {
      const existingRevision = tx.findRevision(
        input.eventKey,
        input.revisionDedupKey,
      );
      if (existingRevision) return existingRevision;

      const event = requireValue(
        tx.getEvent(input.eventKey),
        `研究事件不存在: ${input.eventKey}`,
      );
      if (event.status === "RETRACTED") {
        throw new Error("撤回后的研究事件修订链已经终止");
      }

      const previousRevision = requireValue(
        event.currentRevisionId
          ? tx.getRevision(event.currentRevisionId)
          : undefined,
        "研究事件没有可替代的当前修订",
      );
      const candidate = previousRevision.sourceCandidateKey
        ? requireValue(
            tx.getCandidate(previousRevision.sourceCandidateKey),
            "事件来源候选不存在，无法闭合修订引用",
          )
        : undefined;
      const frozenEvidence = candidate
        ? (candidate.frozenEvidenceIds ?? candidate.evidenceIds).map((id) =>
            this.requireCandidateEvidence(tx, candidate, id),
          )
        : [];
      const claims = candidate
        ? this.assertPromotionEligible(
            tx,
            candidate,
            frozenEvidence,
            input.claims,
            input.researchValue,
          )
        : this.assertClaimsHaveQualifiedEvidence(
            tx,
            undefined,
            frozenEvidence,
            input.claims,
          );
      const researchValue = requireValue(
        this.normalizeResearchValue(input.researchValue, claims.length),
        "事件修订必须包含研究价值",
      );

      const revision = this.createRevision(tx, event, {
        ...input,
        claims,
        researchValue,
        supersedesRevisionId: previousRevision.id,
      });
      event.currentRevisionId = revision.id;
      if (revision.revisionKind === "RETRACTED") {
        event.status = "RETRACTED";
      }
      return revision;
    });
  }

  readRevision(revisionId: string): RevisionReadModel {
    const snapshot = this.store.snapshot();
    const revision = requireValue(
      snapshot.revisions.find((item) => item.id === revisionId),
      `事件修订不存在: ${revisionId}`,
    );
    const event = requireValue(
      snapshot.events.find((item) => item.eventKey === revision.eventKey),
      `研究事件不存在: ${revision.eventKey}`,
    );
    const isCurrent = event.currentRevisionId === revision.id;
    return {
      ...revision,
      eventStatus: event.status,
      isCurrent,
      statusNotice: isCurrent
        ? undefined
        : `该历史修订已被当前修订 ${event.currentRevisionId} 替代，原内容保留用于审计。`,
    };
  }

  endObservation(candidateKey: string, endedAt: string) {
    return this.store.runTransaction((tx) => {
      const candidate = requireValue(
        tx.getCandidate(candidateKey),
        `研究事件候选不存在: ${candidateKey}`,
      );
      if (
        candidate.status !== "DEFERRED" &&
        candidate.status !== "TECHNICAL_HOLD"
      ) {
        throw new Error("只有暂缓或技术暂挂候选可以终结观察");
      }
      if (
        candidate.observationWindowEndsAt &&
        parseTime(endedAt, "观察终结时间不是合法时间") <
          parseTime(candidate.observationWindowEndsAt, "观察窗口不是合法时间")
      ) {
        throw new Error("观察窗口尚未结束");
      }
      candidate.status = "DEFERRED_ENDED";
      candidate.closedAt = endedAt;
      candidate.nextCheckAt = undefined;
      return candidate;
    });
  }

  private candidateKeyFor(seed: CandidateSeedInput) {
    if (seed.aggregationCertainty === "EXACT" && seed.eventIdentityKey) {
      return `candidate:${sha256(
        stableJson({
          canonicalizationVersion: RESEARCH_EVENT_CANONICALIZATION_VERSION,
          subjectType: seed.subjectType,
          subjectKey: seed.subjectKey,
          eventIdentityKey: seed.eventIdentityKey,
        }),
      )}`;
    }
    return `candidate:${sha256(stableJson({ seedKey: seed.seedKey }))}`;
  }

  private eventKeyFor(candidate: ResearchEventCandidate) {
    return `event:${sha256(
      stableJson({
        canonicalizationVersion: candidate.canonicalizationVersion,
        subjectType: candidate.subjectType,
        subjectKey: candidate.subjectKey,
        eventIdentityKey: candidate.eventIdentityKey,
      }),
    )}`;
  }

  private assertCandidateCanReceiveEvidence(candidate: ResearchEventCandidate) {
    if (
      candidate.status === "PROMOTED" ||
      candidate.status === "REJECTED" ||
      candidate.status === "DEFERRED_ENDED"
    ) {
      throw new Error(
        `候选 ${candidate.candidateKey} 已处于终结状态 ${candidate.status}，不能继续回灌`,
      );
    }
  }

  private assertCandidateIdentity(
    candidate: ResearchEventCandidate,
    seed: CandidateSeedInput,
  ) {
    if (
      candidate.eventIdentityKey !== seed.eventIdentityKey ||
      candidate.subjectType !== seed.subjectType ||
      candidate.subjectKey !== seed.subjectKey
    ) {
      throw new Error(`候选 ${candidate.candidateKey} 的稳定 identity 冲突`);
    }
  }

  private resolveMaterial(
    tx: ResearchEventLifecycleStoreTransaction,
    candidateKey: string,
    input: CandidateMaterialInput,
  ) {
    const sourceItemKey = normalizeIdentityPart(input.sourceItemKey);
    const normalizedUrl = normalizeIdentityPart(input.normalizedUrl);
    const existing = tx.listMaterials().find((material) => {
      const sameSourceAndContent =
        sameOptional(material.sourceItemKey, sourceItemKey) &&
        material.contentHash === input.contentHash;
      const sameUrlAndContent =
        sameOptional(material.normalizedUrl, normalizedUrl) &&
        material.contentHash === input.contentHash;
      const sameHashWithoutOtherIdentity =
        material.contentHash === input.contentHash &&
        !material.sourceItemKey &&
        !sourceItemKey &&
        !material.normalizedUrl &&
        !normalizedUrl;
      const sameMaterialKeyAndContent =
        material.materialKey === input.materialKey &&
        material.contentHash === input.contentHash;
      return (
        sameSourceAndContent ||
        sameUrlAndContent ||
        sameHashWithoutOtherIdentity ||
        sameMaterialKeyAndContent
      );
    });

    if (existing) {
      existing.candidateKeys = unique([
        ...existing.candidateKeys,
        candidateKey,
      ]);
      return { material: existing, duplicate: true };
    }

    const collision = tx.listMaterials().find((material) => {
      return (
        material.materialKey === input.materialKey ||
        sameOptional(material.sourceItemKey, sourceItemKey) ||
        sameOptional(material.normalizedUrl, normalizedUrl)
      );
    });
    const material = tx.addMaterial({
      ...input,
      sourceItemKey,
      normalizedUrl,
      id: tx.nextId("material"),
      materialIdentityKey: materialIdentityKey({
        ...input,
        sourceItemKey,
        normalizedUrl,
      }),
      candidateKeys: [candidateKey],
      conflictIds: [],
    });
    if (!collision) return { material, duplicate: false };

    const conflictFields: CandidateMaterialConflict["conflictFields"] = [];
    if (collision.materialKey === input.materialKey) {
      conflictFields.push("materialKey");
    }
    if (sameOptional(collision.sourceItemKey, sourceItemKey)) {
      conflictFields.push("sourceItemKey");
    }
    if (sameOptional(collision.normalizedUrl, normalizedUrl)) {
      conflictFields.push("normalizedUrl");
    }
    if (collision.contentHash !== input.contentHash) {
      conflictFields.push("contentHash");
    }
    const conflict = tx.addMaterialConflict({
      id: tx.nextId("material-conflict"),
      existingMaterialId: collision.id,
      incomingMaterialId: material.id,
      materialKey: input.materialKey,
      conflictFields: unique(conflictFields),
      detectedAt: this.now(),
      reason:
        collision.materialKey === input.materialKey
          ? "MATERIAL_KEY_REUSED"
          : "IDENTITY_CONTENT_MISMATCH",
    });
    collision.conflictIds.push(conflict.id);
    material.conflictIds.push(conflict.id);
    return { material, duplicate: false, conflict };
  }

  private targetStatusFor(
    outcome: AdjudicateCandidateInput["outcome"],
  ): CandidateStatus {
    switch (outcome) {
      case "PROMOTE":
        return "PROMOTED";
      case "DEFER":
        return "DEFERRED";
      case "REJECT":
        return "REJECTED";
      case "TECHNICAL_HOLD":
        return "TECHNICAL_HOLD";
    }
  }

  private assertCandidateTransition(
    from: CandidateStatus,
    to: CandidateStatus,
  ) {
    if (!allowedCandidateTransitions[from].includes(to)) {
      throw new Error(`非法候选状态转移: ${from} -> ${to}`);
    }
  }

  private assertDecisionTiming(input: AdjudicateCandidateInput) {
    parseTime(input.decidedAt, "裁定时间不是合法时间");
    if (input.outcome === "DEFER") {
      const observationWindowEndsAt = requireValue(
        input.observationWindowEndsAt,
        "暂缓裁定必须记录观察窗口结束时间",
      );
      const nextCheckAt = requireValue(
        input.nextCheckAt,
        "暂缓裁定必须记录未来 nextCheckAt",
      );
      assertFuture(observationWindowEndsAt, input.decidedAt, "观察窗口");
      assertFuture(nextCheckAt, input.decidedAt, "nextCheckAt");
      if (
        parseTime(nextCheckAt, "nextCheckAt不是合法时间") >
        parseTime(observationWindowEndsAt, "观察窗口不是合法时间")
      ) {
        throw new Error("nextCheckAt不能晚于观察窗口结束时间");
      }
    }
  }

  private assertTechnicalRetry(input: AdjudicateCandidateInput) {
    if (input.outcome !== "TECHNICAL_HOLD") return;
    const retry = requireValue(
      input.technicalRetry,
      "技术暂挂必须记录有界重试预算",
    );
    if (
      !Number.isInteger(retry.attempt) ||
      !Number.isInteger(retry.maxAttempts) ||
      retry.attempt < 1 ||
      retry.maxAttempts < 1 ||
      retry.attempt > retry.maxAttempts
    ) {
      throw new Error("技术暂挂已耗尽重试预算");
    }
    assertFuture(retry.nextRetryAt, input.decidedAt, "技术重试时间");
  }

  private nextCheckAtFor(input: AdjudicateCandidateInput) {
    if (input.outcome === "TECHNICAL_HOLD") {
      return input.technicalRetry?.nextRetryAt;
    }
    return input.nextCheckAt;
  }

  private validateRelations(
    tx: ResearchEventLifecycleStoreTransaction,
    candidate: ResearchEventCandidate,
    frozenEvidenceIds: string[],
    input: AdjudicateCandidateInput,
  ) {
    const splitKeys = input.splitInto?.map((item) => item.candidateKey) ?? [];
    if (new Set(splitKeys).size !== splitKeys.length) {
      throw new Error("拆分候选键不能重复");
    }
    for (const split of input.splitInto ?? []) {
      if (split.candidateKey === candidate.candidateKey) {
        throw new Error("拆分候选不能引用父候选自身");
      }
      if (!split.eventIdentityKey.trim()) {
        throw new Error("拆分候选必须有稳定 event identity");
      }
      if (tx.getCandidate(split.candidateKey)) {
        throw new Error(`拆分候选已存在: ${split.candidateKey}`);
      }
      for (const evidenceId of split.evidenceIds) {
        if (!frozenEvidenceIds.includes(evidenceId)) {
          throw new Error("拆分证据必须属于父候选当前冻结集合");
        }
      }
    }

    const mergeKeys = input.mergeCandidateKeys ?? [];
    if (new Set(mergeKeys).size !== mergeKeys.length) {
      throw new Error("合并候选键不能重复");
    }
    for (const mergeKey of mergeKeys) {
      if (mergeKey === candidate.candidateKey) {
        throw new Error("候选不能与自身合并");
      }
      const merged = requireValue(
        tx.getCandidate(mergeKey),
        `合并候选不存在: ${mergeKey}`,
      );
      if (
        merged.status === "PROMOTED" ||
        merged.status === "REJECTED" ||
        merged.status === "DEFERRED_ENDED"
      ) {
        throw new Error(`不能合并已终结候选: ${mergeKey}`);
      }
    }
  }

  private applySplits(
    tx: ResearchEventLifecycleStoreTransaction,
    candidate: ResearchEventCandidate,
    input: AdjudicateCandidateInput,
    decisionId: string,
  ) {
    const splitCandidates: ResearchEventCandidate[] = [];
    for (const split of input.splitInto ?? []) {
      const childEvidenceIds: string[] = [];
      const child = tx.addCandidate({
        id: tx.nextId("candidate"),
        candidateKey: split.candidateKey,
        clusterKey: `split:${candidate.candidateKey}:${split.eventIdentityKey}`,
        canonicalizationVersion: candidate.canonicalizationVersion,
        eventIdentityKey: split.eventIdentityKey,
        subjectType: split.subjectType,
        subjectKey: split.subjectKey,
        parentCandidateKey: candidate.candidateKey,
        status: "OPEN",
        createdAt: this.now(),
        evidenceIds: [],
        materialIds: [],
        decisionIds: [],
        relationIds: [],
      });

      for (const parentEvidenceId of split.evidenceIds) {
        const parentEvidence = requireValue(
          tx.getEvidence(parentEvidenceId),
          `拆分证据不存在: ${parentEvidenceId}`,
        );
        const childEvidence = tx.addEvidence({
          ...clone(parentEvidence),
          id: sha256(
            stableJson({
              childCandidateKey: child.candidateKey,
              parentEvidenceId,
            }),
          ),
          candidateKey: child.candidateKey,
          ordinal: child.evidenceIds.length,
          frozenInDecisionIds: [],
        });
        child.evidenceIds.push(childEvidence.id);
        childEvidenceIds.push(childEvidence.id);
        if (childEvidence.materialId) {
          child.materialIds.push(childEvidence.materialId);
          const material = tx.getMaterial(childEvidence.materialId);
          material?.candidateKeys.push(child.candidateKey);
          if (material) material.candidateKeys = unique(material.candidateKeys);
        }
      }

      const relation = tx.addCandidateRelation({
        id: tx.nextId("candidate-relation"),
        relationKind: "SPLIT_FROM",
        fromCandidateKey: candidate.candidateKey,
        toCandidateKey: child.candidateKey,
        reason: split.reason,
        evidenceIds: [...split.evidenceIds],
        decisionId,
        createdAt: this.now(),
      });
      candidate.relationIds.push(relation.id);
      child.relationIds.push(relation.id);
      splitCandidates.push(child);
    }
    return splitCandidates;
  }

  private applyMerges(
    tx: ResearchEventLifecycleStoreTransaction,
    candidate: ResearchEventCandidate,
    input: AdjudicateCandidateInput,
    decisionId: string,
  ) {
    const mergedCandidateKeys: string[] = [];
    for (const mergeKey of input.mergeCandidateKeys ?? []) {
      const merged = requireValue(
        tx.getCandidate(mergeKey),
        `合并候选不存在: ${mergeKey}`,
      );
      const relation = tx.addCandidateRelation({
        id: tx.nextId("candidate-relation"),
        relationKind: "MERGED_INTO",
        fromCandidateKey: merged.candidateKey,
        toCandidateKey: candidate.candidateKey,
        evidenceIds: [...merged.evidenceIds],
        decisionId,
        createdAt: this.now(),
      });
      merged.status = "REJECTED";
      merged.closedAt = input.decidedAt;
      merged.relationIds.push(relation.id);
      candidate.relationIds.push(relation.id);
      mergedCandidateKeys.push(merged.candidateKey);
    }
    return mergedCandidateKeys;
  }

  private requireCandidateEvidence(
    tx: ResearchEventLifecycleStoreTransaction,
    candidate: ResearchEventCandidate,
    evidenceId: string,
  ) {
    const evidence = requireValue(
      tx.getEvidence(evidenceId),
      `候选证据不存在: ${evidenceId}`,
    );
    if (evidence.candidateKey !== candidate.candidateKey) {
      throw new Error(`候选证据不属于当前候选: ${evidenceId}`);
    }
    return evidence;
  }

  private assertPromotionEligible(
    tx: ResearchEventLifecycleStoreTransaction,
    candidate: ResearchEventCandidate,
    frozenEvidence: CandidateEvidence[],
    claims: FactClaimInput[],
    researchValue: ResearchValueInput | undefined,
  ) {
    if (claims.length === 0) {
      throw new Error("晋级研究事件必须包含逐项事实主张");
    }
    const normalizedClaims = this.assertClaimsHaveQualifiedEvidence(
      tx,
      candidate,
      frozenEvidence,
      claims,
    );
    if (
      frozenEvidence.length > 0 &&
      frozenEvidence.every((item) => item.evidenceKind === "DATA_ANOMALY")
    ) {
      throw new Error("异常数据不能独立晋级为权威研究事件");
    }
    this.normalizeResearchValue(researchValue, normalizedClaims.length);
    return normalizedClaims;
  }

  private assertClaimsHaveQualifiedEvidence(
    tx: ResearchEventLifecycleStoreTransaction,
    candidate: ResearchEventCandidate | undefined,
    frozenEvidence: CandidateEvidence[],
    claims: FactClaimInput[],
  ) {
    return claims.map((claim, claimIndex) => {
      if (claim.citations.length === 0) {
        throw new Error(`事实主张 ${claimIndex + 1} 缺少证据引用`);
      }
      const normalizedCitations = claim.citations.map((citation) =>
        this.resolveCitation(tx, candidate, frozenEvidence, citation),
      );
      const supportingEvidence = normalizedCitations
        .filter((citation) => citation.relation === "SUPPORTS")
        .map((citation) =>
          frozenEvidence.find(
            (evidence) => evidence.id === citation.candidateEvidenceId,
          ),
        )
        .filter((evidence): evidence is CandidateEvidence => Boolean(evidence));
      if (supportingEvidence.length === 0) {
        throw new Error(`事实主张 ${claimIndex + 1} 必须有 SUPPORTS 引用`);
      }
      const verifiedQualified = supportingEvidence.some(
        (evidence) =>
          evidence.sourceIdentityStatus === "VERIFIED" &&
          evidence.proofQualification === "QUALIFIED" &&
          evidence.evidenceRole === "CORE_FACT" &&
          this.evidenceQualityAllowsPromotion(evidence),
      );
      const independentCorroboration = new Set(
        supportingEvidence
          .filter(
            (evidence) =>
              evidence.sourceIdentityStatus === "VERIFIED" &&
              evidence.proofQualification === "CORROBORATING_ONLY" &&
              evidence.evidenceRole === "CORE_FACT" &&
              this.evidenceQualityAllowsPromotion(evidence),
          )
          .map((evidence) => evidence.independenceKey),
      ).size;
      if (!verifiedQualified && independentCorroboration < 2) {
        throw new Error(`事实主张 ${claimIndex + 1} 没有关联合格证据`);
      }
      return {
        ...claim,
        citations: normalizedCitations,
      };
    });
  }

  private evidenceQualityAllowsPromotion(evidence: CandidateEvidence) {
    return (
      evidence.evidenceKind !== "DATA_OBSERVATION" ||
      evidence.qualityStatus === "NORMAL"
    );
  }

  private resolveCitation(
    tx: ResearchEventLifecycleStoreTransaction,
    candidate: ResearchEventCandidate | undefined,
    frozenEvidence: CandidateEvidence[],
    citation: FactClaimCitation,
  ): FactClaimCitation {
    const pointers = [
      citation.candidateEvidenceId
        ? `candidateEvidenceId:${citation.candidateEvidenceId}`
        : undefined,
      citation.sourceAssertionId
        ? `sourceAssertionId:${citation.sourceAssertionId}`
        : undefined,
      citation.observationRevisionId
        ? `observationRevisionId:${citation.observationRevisionId}`
        : undefined,
    ].filter((value): value is string => Boolean(value));
    if (pointers.length !== 1) {
      throw new Error("事实主张引用必须包含且只包含一个可解析指针");
    }

    let evidence: CandidateEvidence | undefined;
    if (citation.candidateEvidenceId) {
      evidence = tx.getEvidence(citation.candidateEvidenceId);
      if (!evidence) {
        throw new Error(
          `事实主张引用的候选证据不存在: ${citation.candidateEvidenceId}`,
        );
      }
      if (candidate && evidence.candidateKey !== candidate.candidateKey) {
        throw new Error(
          `事实主张引用的候据不属于当前候选: ${citation.candidateEvidenceId}`,
        );
      }
      if (!frozenEvidence.some((item) => item.id === evidence?.id)) {
        throw new Error("事实主张引用不属于当前冻结证据集合");
      }
    } else {
      evidence = frozenEvidence.find((item) => {
        if (
          citation.sourceAssertionId &&
          item.sourceAssertionId === citation.sourceAssertionId
        ) {
          return true;
        }
        return Boolean(
          citation.observationRevisionId &&
            item.observationRevisionId === citation.observationRevisionId,
        );
      });
      if (!evidence) {
        throw new Error("事实主张引用的来源指针未闭合到当前候选冻结证据");
      }
    }

    if (!evidence) {
      throw new Error("事实主张引用未解析");
    }
    if (
      citation.sourceAssertionId &&
      citation.sourceAssertionId !== evidence.sourceAssertionId
    ) {
      throw new Error("事实主张引用的来源断言与候选证据不一致");
    }
    if (
      citation.observationRevisionId &&
      citation.observationRevisionId !== evidence.observationRevisionId
    ) {
      throw new Error("事实主张引用的数据观测修订与候选证据不一致");
    }

    return {
      candidateEvidenceId: evidence.id,
      sourceAssertionId: evidence.sourceAssertionId,
      observationRevisionId: evidence.observationRevisionId,
      relation: citation.relation,
      sourceIdentityStatus: evidence.sourceIdentityStatus,
      proofQualification: evidence.proofQualification,
      citation: clone(citation.citation),
    };
  }

  private normalizeResearchValue(
    researchValue: ResearchValueInput | undefined,
    claimCount: number,
  ) {
    if (!researchValue || !researchValue.meaning.trim()) {
      throw new Error("晋级研究事件必须包含研究价值含义");
    }
    if (researchValue.impactObjects.length === 0) {
      throw new Error("晋级研究事件必须包含影响对象");
    }
    this.assertClaimIndexes(researchValue.claimIndexes, claimCount, "研究含义");
    const impactObjects = researchValue.impactObjects.map((impact, index) => {
      if (!impact.subjectType.trim() || !impact.subjectKey.trim()) {
        throw new Error(`影响对象 ${index + 1} 缺少结构化主体`);
      }
      this.assertClaimIndexes(
        impact.claimIndexes,
        claimCount,
        `影响对象 ${index + 1}`,
      );
      return clone(impact);
    });
    return {
      meaning: researchValue.meaning.trim(),
      claimIndexes: unique(researchValue.claimIndexes),
      impactObjects,
    };
  }

  private assertClaimIndexes(
    indexes: number[],
    claimCount: number,
    label: string,
  ) {
    if (
      indexes.length === 0 ||
      indexes.some(
        (index) => !Number.isInteger(index) || index < 0 || index >= claimCount,
      )
    ) {
      throw new Error(`${label}必须逐项引用有效事实主张`);
    }
  }

  private getOrCreateEvent(
    tx: ResearchEventLifecycleStoreTransaction,
    candidate: ResearchEventCandidate,
  ) {
    const subjectType = requireValue(
      candidate.subjectType,
      "晋级事件必须有事件主体类型",
    );
    const subjectKey = requireValue(
      candidate.subjectKey,
      "晋级事件必须有事件主体",
    );
    const eventIdentityKey = requireValue(
      candidate.eventIdentityKey,
      "晋级事件必须有稳定 event identity",
    );
    const eventKey = this.eventKeyFor(candidate);
    const existing = tx.getEvent(eventKey);
    if (existing) {
      if (existing.status === "RETRACTED") {
        throw new Error("稳定 identity 对应的研究事件已经撤回");
      }
      return existing;
    }
    return tx.addEvent({
      id: tx.nextId("event"),
      eventKey,
      canonicalizationVersion: candidate.canonicalizationVersion,
      eventIdentityKey,
      subjectType,
      subjectKey,
      status: "ACTIVE",
      createdAt: this.now(),
      revisionIds: [],
    });
  }

  private createRevision(
    tx: ResearchEventLifecycleStoreTransaction,
    event: ResearchEvent,
    input: {
      revisionDedupKey: string;
      revisionKind: ResearchEventRevisionKind;
      supersedesRevisionId?: string;
      title: string;
      summary: string;
      narrative: Record<string, unknown>;
      uncertainty: Record<string, unknown>;
      counterEvidence: Record<string, unknown>;
      occurredAt: string;
      knownAt: string;
      sourceCandidateKey?: string;
      claims: FactClaimInput[];
      researchValue: ResearchValueInput;
    },
  ) {
    const existing = tx.findRevision(event.eventKey, input.revisionDedupKey);
    if (existing) return existing;
    if (
      input.supersedesRevisionId &&
      !event.revisionIds.includes(input.supersedesRevisionId)
    ) {
      throw new Error("事件修订前序必须属于同一研究事件");
    }
    const revision = tx.addRevision({
      id: tx.nextId("revision"),
      eventKey: event.eventKey,
      revisionNo: event.revisionIds.length + 1,
      revisionDedupKey: input.revisionDedupKey,
      revisionKind: input.revisionKind,
      supersedesRevisionId: input.supersedesRevisionId,
      title: input.title,
      summary: input.summary,
      narrative: clone(input.narrative),
      uncertainty: clone(input.uncertainty),
      counterEvidence: clone(input.counterEvidence),
      occurredAt: input.occurredAt,
      knownAt: input.knownAt,
      sourceCandidateKey: input.sourceCandidateKey,
      claims: clone(input.claims),
      researchValue: clone(input.researchValue),
      createdAt: this.now(),
    });
    event.revisionIds.push(revision.id);
    return revision;
  }

  private resultForDecision(
    tx: ResearchEventLifecycleStoreTransaction,
    decision: CandidateDecision,
  ): AdjudicateCandidateResult {
    const candidate = requireValue(
      tx.getCandidate(decision.candidateKey),
      `研究事件候选不存在: ${decision.candidateKey}`,
    );
    const event = decision.linkedEventKey
      ? tx.getEvent(decision.linkedEventKey)
      : undefined;
    const revision = event?.currentRevisionId
      ? tx.getRevision(event.currentRevisionId)
      : undefined;
    const relations = tx
      .listCandidateRelations()
      .filter((relation) => relation.decisionId === decision.id);
    return {
      decision,
      candidate,
      event,
      revision,
      splitCandidates: relations
        .filter((relation) => relation.relationKind === "SPLIT_FROM")
        .map((relation) =>
          requireValue(
            tx.getCandidate(relation.toCandidateKey),
            `拆分候选不存在: ${relation.toCandidateKey}`,
          ),
        ),
      mergedCandidateKeys: relations
        .filter((relation) => relation.relationKind === "MERGED_INTO")
        .map((relation) => relation.fromCandidateKey),
    };
  }
}

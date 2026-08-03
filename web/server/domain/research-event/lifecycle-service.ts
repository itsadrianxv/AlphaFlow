import { createHash } from "node:crypto";
import { InMemoryResearchEventLifecycleStore } from "./store";
import {
  type AdjudicateCandidateInput,
  type AdjudicateCandidateResult,
  type CandidateBackfillResult,
  type CandidateDecision,
  type CandidateEvidence,
  type CandidateSeedInput,
  type FactClaimInput,
  RESEARCH_EVENT_CONTRACT_VERSION,
  type ResearchEvent,
  type ResearchEventCandidate,
  type ResearchEventRevision,
  type ReviseResearchEventInput,
  type RevisionReadModel,
} from "./types";

function sha256(value: string) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

export class ResearchEventLifecycleService {
  constructor(
    private readonly store = new InMemoryResearchEventLifecycleStore(),
    private readonly now = () => new Date().toISOString(),
  ) {}

  getStore() {
    return this.store;
  }

  backfillCandidate(seed: CandidateSeedInput): CandidateBackfillResult {
    const candidateKey = this.candidateKeyFor(seed);
    const clusterKey =
      seed.clusterKey ??
      (seed.aggregationCertainty === "EXACT"
        ? candidateKey
        : `uncertain:${seed.seedKey}`);
    const duplicateMaterialKeys: string[] = [];
    const materialIds: string[] = [];

    for (const materialInput of seed.materials) {
      const existing = this.store.materials.get(materialInput.materialKey);
      if (existing) {
        duplicateMaterialKeys.push(materialInput.materialKey);
        existing.candidateKeys = unique([
          ...existing.candidateKeys,
          candidateKey,
        ]);
        materialIds.push(existing.id);
        continue;
      }
      const material = this.store.addMaterial({
        ...materialInput,
        id: this.store.nextId("material"),
        candidateKeys: [candidateKey],
      });
      materialIds.push(material.id);
    }

    let candidate = this.store.candidates.get(candidateKey);
    if (!candidate) {
      candidate = this.store.addCandidate({
        id: this.store.nextId("candidate"),
        candidateKey,
        clusterKey,
        subjectType: seed.subjectType,
        subjectKey: seed.subjectKey,
        status: "OPEN",
        createdAt: this.now(),
        evidenceIds: [],
        materialIds: unique(materialIds),
        decisionIds: [],
      });
    } else {
      candidate.materialIds = unique([
        ...candidate.materialIds,
        ...materialIds,
      ]);
    }

    const evidence: CandidateEvidence[] = [];
    for (const evidenceInput of seed.evidence) {
      const materialId = evidenceInput.materialKey
        ? this.store.materials.get(evidenceInput.materialKey)?.id
        : undefined;
      const evidenceKey = sha256(
        stableJson({
          candidateKey,
          materialId,
          sourceAssertionId: evidenceInput.sourceAssertionId,
          observationRevisionId: evidenceInput.observationRevisionId,
          citation: evidenceInput.citation,
        }),
      );
      const existing = this.store.evidence.get(evidenceKey);
      if (existing) {
        evidence.push(existing);
        continue;
      }
      const item = this.store.addEvidence({
        ...evidenceInput,
        id: evidenceKey,
        candidateKey,
        materialId,
        ordinal: candidate.evidenceIds.length,
      });
      candidate.evidenceIds.push(item.id);
      evidence.push(item);
    }

    return {
      candidates: [candidate],
      materials: materialIds
        .map((id) =>
          [...this.store.materials.values()].find((item) => item.id === id),
        )
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
      evidence,
      duplicateMaterialKeys,
    };
  }

  adjudicateCandidate(
    input: AdjudicateCandidateInput,
  ): AdjudicateCandidateResult {
    const existingDecision = this.store.findDecisionByInputHash(
      input.inputHash,
    );
    if (existingDecision) return this.resultForDecision(existingDecision);

    const candidate = requireValue(
      this.store.candidates.get(input.candidateKey),
      `研究事件候选不存在: ${input.candidateKey}`,
    );
    const evidenceFrozenAt = input.decidedAt;
    const decision: CandidateDecision = this.store.addDecision({
      id: this.store.nextId("decision"),
      candidateKey: candidate.candidateKey,
      decisionNo: candidate.decisionIds.length + 1,
      inputHash: input.inputHash,
      outcome: input.outcome,
      decidedAt: input.decidedAt,
      evidenceGap: input.evidenceGap ?? [],
      releaseConditions: input.releaseConditions ?? [],
      decision: {
        contractVersion: RESEARCH_EVENT_CONTRACT_VERSION,
        ...(input.title ? { title: input.title } : {}),
        ...(input.splitInto ? { splitInto: input.splitInto } : {}),
        ...(input.mergeCandidateKeys
          ? { mergeCandidateKeys: input.mergeCandidateKeys }
          : {}),
      },
    });
    candidate.decisionIds.push(decision.id);
    candidate.currentDecisionId = decision.id;
    candidate.evidenceFrozenAt = evidenceFrozenAt;

    const splitCandidates = this.applySplits(candidate, input);
    const mergedCandidateKeys = this.applyMerges(candidate, input);

    if (input.outcome === "TECHNICAL_HOLD") {
      candidate.status = "TECHNICAL_HOLD";
      candidate.nextCheckAt = input.releaseConditions?.length
        ? input.decidedAt
        : undefined;
      return { decision, candidate, splitCandidates, mergedCandidateKeys };
    }

    if (input.outcome === "DEFER") {
      candidate.status = "DEFERRED";
      candidate.nextCheckAt = input.releaseConditions?.length
        ? input.decidedAt
        : undefined;
      return { decision, candidate, splitCandidates, mergedCandidateKeys };
    }

    if (input.outcome === "REJECT") {
      candidate.status = "REJECTED";
      candidate.closedAt = input.decidedAt;
      return { decision, candidate, splitCandidates, mergedCandidateKeys };
    }

    this.assertPromotionEligible(candidate, input.claims ?? []);
    candidate.status = "PROMOTED";
    candidate.closedAt = input.decidedAt;
    const eventKey = this.eventKeyFor(candidate, input);
    let event = this.store.events.get(eventKey);
    if (!event) {
      event = this.store.addEvent({
        id: this.store.nextId("event"),
        eventKey,
        canonicalizationVersion: "v1",
        subjectType: requireValue(
          candidate.subjectType,
          "晋级事件必须有事件主体类型",
        ),
        subjectKey: requireValue(
          candidate.subjectKey,
          "晋级事件必须有事件主体",
        ),
        status: "ACTIVE",
        createdAt: this.now(),
        revisionIds: [],
      });
    }
    const revision = this.createRevision(event, {
      revisionDedupKey: sha256(
        stableJson({
          eventKey,
          candidateKey: candidate.candidateKey,
          inputHash: input.inputHash,
        }),
      ),
      revisionKind: "CONFIRMED",
      sourceCandidateKey: candidate.candidateKey,
      title: requireValue(input.title, "晋级事件必须有标题"),
      summary: requireValue(input.summary, "晋级事件必须有摘要"),
      narrative: input.narrative ?? {},
      uncertainty: input.uncertainty ?? {},
      counterEvidence: input.counterEvidence ?? {},
      occurredAt: requireValue(input.occurredAt, "晋级事件必须有发生时间"),
      knownAt: input.knownAt ?? input.decidedAt,
      claims: input.claims ?? [],
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
  }

  reviseEvent(input: ReviseResearchEventInput) {
    const existingRevision = this.store.findRevisionByDedupKey(
      input.revisionDedupKey,
    );
    if (existingRevision) return existingRevision;
    const event = requireValue(
      this.store.events.get(input.eventKey),
      `研究事件不存在: ${input.eventKey}`,
    );
    const previousRevision = requireValue(
      event.currentRevisionId
        ? this.store.revisions.get(event.currentRevisionId)
        : undefined,
      "研究事件没有可替代的当前修订",
    );
    this.assertClaimsHaveQualifiedEvidence(input.claims);
    const revision = this.createRevision(event, {
      ...input,
      supersedesRevisionId: previousRevision.id,
    });
    event.currentRevisionId = revision.id;
    if (revision.revisionKind === "RETRACTED") {
      event.status = "RETRACTED";
    }
    return revision;
  }

  readRevision(revisionId: string): RevisionReadModel {
    const revision = requireValue(
      this.store.revisions.get(revisionId),
      `事件修订不存在: ${revisionId}`,
    );
    const event = requireValue(
      this.store.events.get(revision.eventKey),
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
    const candidate = requireValue(
      this.store.candidates.get(candidateKey),
      `研究事件候选不存在: ${candidateKey}`,
    );
    if (
      candidate.status !== "DEFERRED" &&
      candidate.status !== "TECHNICAL_HOLD"
    ) {
      throw new Error("只有暂缓或技术暂挂候选可以终结观察");
    }
    candidate.status = "DEFERRED_ENDED";
    candidate.closedAt = endedAt;
    return candidate;
  }

  private candidateKeyFor(seed: CandidateSeedInput) {
    if (seed.aggregationCertainty === "EXACT" && seed.eventIdentityKey) {
      return `candidate:${sha256(
        stableJson({
          subjectType: seed.subjectType,
          subjectKey: seed.subjectKey,
          eventIdentityKey: seed.eventIdentityKey,
        }),
      )}`;
    }
    return `candidate:${sha256(stableJson({ seedKey: seed.seedKey }))}`;
  }

  private eventKeyFor(
    candidate: ResearchEventCandidate,
    input: AdjudicateCandidateInput,
  ) {
    return `event:${sha256(
      stableJson({
        subjectType: candidate.subjectType,
        subjectKey: candidate.subjectKey,
        title: input.title,
        occurredAt: input.occurredAt,
      }),
    )}`;
  }

  private applySplits(
    candidate: ResearchEventCandidate,
    input: AdjudicateCandidateInput,
  ) {
    const splitCandidates: ResearchEventCandidate[] = [];
    for (const split of input.splitInto ?? []) {
      const existing = this.store.candidates.get(split.candidateKey);
      if (existing) {
        splitCandidates.push(existing);
        continue;
      }
      splitCandidates.push(
        this.store.addCandidate({
          id: this.store.nextId("candidate"),
          candidateKey: split.candidateKey,
          clusterKey: `split:${candidate.candidateKey}:${split.eventIdentityKey}`,
          subjectType: split.subjectType,
          subjectKey: split.subjectKey,
          status: "OPEN",
          createdAt: this.now(),
          evidenceIds: split.evidenceIds,
          materialIds: candidate.materialIds,
          decisionIds: [],
        }),
      );
    }
    return splitCandidates;
  }

  private applyMerges(
    candidate: ResearchEventCandidate,
    input: AdjudicateCandidateInput,
  ) {
    const mergedCandidateKeys: string[] = [];
    for (const mergeKey of input.mergeCandidateKeys ?? []) {
      const merged = this.store.candidates.get(mergeKey);
      if (!merged || merged.candidateKey === candidate.candidateKey) continue;
      candidate.evidenceIds = unique([
        ...candidate.evidenceIds,
        ...merged.evidenceIds,
      ]);
      candidate.materialIds = unique([
        ...candidate.materialIds,
        ...merged.materialIds,
      ]);
      merged.status = "REJECTED";
      merged.closedAt = input.decidedAt;
      mergedCandidateKeys.push(merged.candidateKey);
    }
    return mergedCandidateKeys;
  }

  private assertPromotionEligible(
    candidate: ResearchEventCandidate,
    claims: FactClaimInput[],
  ) {
    if (claims.length === 0) {
      throw new Error("晋级研究事件必须包含逐项事实主张");
    }
    this.assertClaimsHaveQualifiedEvidence(claims);
    const evidence = candidate.evidenceIds.map((id) =>
      requireValue(this.store.evidence.get(id), `候选证据不存在: ${id}`),
    );
    if (
      evidence.length > 0 &&
      evidence.every((item) => item.evidenceKind === "DATA_ANOMALY")
    ) {
      throw new Error("异常数据不能独立晋级为权威研究事件");
    }
  }

  private assertClaimsHaveQualifiedEvidence(claims: FactClaimInput[]) {
    for (const [index, claim] of claims.entries()) {
      if (claim.citations.length === 0) {
        throw new Error(`事实主张 ${index + 1} 缺少证据引用`);
      }
      const verifiedQualified = claim.citations.some(
        (citation) =>
          citation.sourceIdentityStatus === "VERIFIED" &&
          citation.proofQualification === "QUALIFIED",
      );
      const independentCorroboration = new Set(
        claim.citations
          .filter(
            (citation) =>
              citation.sourceIdentityStatus === "VERIFIED" &&
              citation.proofQualification === "CORROBORATING_ONLY",
          )
          .map(
            (citation) =>
              (citation.candidateEvidenceId
                ? this.store.evidence.get(citation.candidateEvidenceId)
                    ?.independenceKey
                : undefined) ??
              citation.sourceAssertionId ??
              citation.observationRevisionId,
          )
          .filter(Boolean),
      ).size;
      if (!verifiedQualified && independentCorroboration < 2) {
        throw new Error(`事实主张 ${index + 1} 没有关联合格证据`);
      }
    }
  }

  private createRevision(
    event: ResearchEvent,
    input: Omit<ReviseResearchEventInput, "eventKey" | "revisionKind"> & {
      revisionKind: ResearchEventRevision["revisionKind"];
      sourceCandidateKey?: string;
      supersedesRevisionId?: string;
    },
  ) {
    const existing = this.store.findRevisionByDedupKey(input.revisionDedupKey);
    if (existing) return existing;
    const revision: ResearchEventRevision = this.store.addRevision({
      id: this.store.nextId("revision"),
      eventKey: event.eventKey,
      revisionNo: event.revisionIds.length + 1,
      revisionDedupKey: input.revisionDedupKey,
      revisionKind: input.revisionKind,
      supersedesRevisionId: input.supersedesRevisionId,
      title: input.title,
      summary: input.summary,
      narrative: input.narrative,
      uncertainty: input.uncertainty,
      counterEvidence: input.counterEvidence,
      occurredAt: input.occurredAt,
      knownAt: input.knownAt,
      sourceCandidateKey: input.sourceCandidateKey,
      claims: input.claims,
      createdAt: this.now(),
    });
    event.revisionIds.push(revision.id);
    return revision;
  }

  private resultForDecision(
    decision: CandidateDecision,
  ): AdjudicateCandidateResult {
    const candidate = requireValue(
      this.store.candidates.get(decision.candidateKey),
      `研究事件候选不存在: ${decision.candidateKey}`,
    );
    const event = decision.linkedEventKey
      ? this.store.events.get(decision.linkedEventKey)
      : undefined;
    const revision = event?.currentRevisionId
      ? this.store.revisions.get(event.currentRevisionId)
      : undefined;
    return {
      decision,
      candidate,
      event,
      revision,
      splitCandidates: [],
      mergedCandidateKeys: [],
    };
  }
}

import type {
  CandidateDecision,
  CandidateEvidence,
  CandidateMaterial,
  CandidateMaterialConflict,
  CandidateRelation,
  ResearchEvent,
  ResearchEventCandidate,
  ResearchEventRevision,
} from "./types";

export type ResearchEventLifecycleSnapshot = {
  materials: CandidateMaterial[];
  materialConflicts: CandidateMaterialConflict[];
  candidates: ResearchEventCandidate[];
  evidence: CandidateEvidence[];
  decisions: CandidateDecision[];
  candidateRelations: CandidateRelation[];
  events: ResearchEvent[];
  revisions: ResearchEventRevision[];
};

export interface ResearchEventLifecycleStoreTransaction {
  nextId(prefix: string): string;

  listMaterials(): CandidateMaterial[];
  getMaterial(materialId: string): CandidateMaterial | undefined;
  addMaterial(material: CandidateMaterial): CandidateMaterial;

  listMaterialConflicts(): CandidateMaterialConflict[];
  addMaterialConflict(
    conflict: CandidateMaterialConflict,
  ): CandidateMaterialConflict;

  listCandidates(): ResearchEventCandidate[];
  getCandidate(candidateKey: string): ResearchEventCandidate | undefined;
  addCandidate(candidate: ResearchEventCandidate): ResearchEventCandidate;

  listEvidence(): CandidateEvidence[];
  getEvidence(evidenceId: string): CandidateEvidence | undefined;
  addEvidence(evidence: CandidateEvidence): CandidateEvidence;

  listDecisions(): CandidateDecision[];
  getDecision(decisionId: string): CandidateDecision | undefined;
  addDecision(decision: CandidateDecision): CandidateDecision;
  findDecision(
    candidateKey: string,
    inputHash: string,
  ): CandidateDecision | undefined;

  listCandidateRelations(): CandidateRelation[];
  addCandidateRelation(relation: CandidateRelation): CandidateRelation;

  listEvents(): ResearchEvent[];
  getEvent(eventKey: string): ResearchEvent | undefined;
  addEvent(event: ResearchEvent): ResearchEvent;

  listRevisions(): ResearchEventRevision[];
  getRevision(revisionId: string): ResearchEventRevision | undefined;
  addRevision(revision: ResearchEventRevision): ResearchEventRevision;
  findRevision(
    eventKey: string,
    revisionDedupKey: string,
  ): ResearchEventRevision | undefined;
}

export interface ResearchEventLifecycleStore {
  runTransaction<T>(
    work: (transaction: ResearchEventLifecycleStoreTransaction) => T,
  ): T;
  snapshot(): ResearchEventLifecycleSnapshot;
}

type LifecycleState = {
  materials: Map<string, CandidateMaterial>;
  materialConflicts: Map<string, CandidateMaterialConflict>;
  candidates: Map<string, ResearchEventCandidate>;
  evidence: Map<string, CandidateEvidence>;
  decisions: Map<string, CandidateDecision>;
  candidateRelations: Map<string, CandidateRelation>;
  events: Map<string, ResearchEvent>;
  revisions: Map<string, ResearchEventRevision>;
  sequence: number;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function emptyState(): LifecycleState {
  return {
    materials: new Map(),
    materialConflicts: new Map(),
    candidates: new Map(),
    evidence: new Map(),
    decisions: new Map(),
    candidateRelations: new Map(),
    events: new Map(),
    revisions: new Map(),
    sequence: 0,
  };
}

function cloneState(state: LifecycleState): LifecycleState {
  return {
    materials: new Map(
      [...state.materials.entries()].map(([key, value]) => [key, clone(value)]),
    ),
    materialConflicts: new Map(
      [...state.materialConflicts.entries()].map(([key, value]) => [
        key,
        clone(value),
      ]),
    ),
    candidates: new Map(
      [...state.candidates.entries()].map(([key, value]) => [
        key,
        clone(value),
      ]),
    ),
    evidence: new Map(
      [...state.evidence.entries()].map(([key, value]) => [key, clone(value)]),
    ),
    decisions: new Map(
      [...state.decisions.entries()].map(([key, value]) => [key, clone(value)]),
    ),
    candidateRelations: new Map(
      [...state.candidateRelations.entries()].map(([key, value]) => [
        key,
        clone(value),
      ]),
    ),
    events: new Map(
      [...state.events.entries()].map(([key, value]) => [key, clone(value)]),
    ),
    revisions: new Map(
      [...state.revisions.entries()].map(([key, value]) => [key, clone(value)]),
    ),
    sequence: state.sequence,
  };
}

function snapshotFromState(
  state: LifecycleState,
): ResearchEventLifecycleSnapshot {
  return clone({
    materials: [...state.materials.values()],
    materialConflicts: [...state.materialConflicts.values()],
    candidates: [...state.candidates.values()],
    evidence: [...state.evidence.values()],
    decisions: [...state.decisions.values()],
    candidateRelations: [...state.candidateRelations.values()],
    events: [...state.events.values()],
    revisions: [...state.revisions.values()],
  });
}

class InMemoryResearchEventLifecycleTransaction
  implements ResearchEventLifecycleStoreTransaction
{
  constructor(private readonly state: LifecycleState) {}

  nextId(prefix: string) {
    this.state.sequence += 1;
    return `${prefix}_${this.state.sequence}`;
  }

  listMaterials() {
    return [...this.state.materials.values()];
  }

  getMaterial(materialId: string) {
    return this.state.materials.get(materialId);
  }

  addMaterial(material: CandidateMaterial) {
    if (this.state.materials.has(material.id)) {
      throw new Error(`材料 ID 已存在: ${material.id}`);
    }
    this.state.materials.set(material.id, material);
    return material;
  }

  listMaterialConflicts() {
    return [...this.state.materialConflicts.values()];
  }

  addMaterialConflict(conflict: CandidateMaterialConflict) {
    if (this.state.materialConflicts.has(conflict.id)) {
      throw new Error(`材料冲突 ID 已存在: ${conflict.id}`);
    }
    this.state.materialConflicts.set(conflict.id, conflict);
    return conflict;
  }

  listCandidates() {
    return [...this.state.candidates.values()];
  }

  getCandidate(candidateKey: string) {
    return this.state.candidates.get(candidateKey);
  }

  addCandidate(candidate: ResearchEventCandidate) {
    if (this.state.candidates.has(candidate.candidateKey)) {
      throw new Error(`研究事件候选已存在: ${candidate.candidateKey}`);
    }
    this.state.candidates.set(candidate.candidateKey, candidate);
    return candidate;
  }

  listEvidence() {
    return [...this.state.evidence.values()];
  }

  getEvidence(evidenceId: string) {
    return this.state.evidence.get(evidenceId);
  }

  addEvidence(evidence: CandidateEvidence) {
    if (this.state.evidence.has(evidence.id)) {
      throw new Error(`候选证据 ID 已存在: ${evidence.id}`);
    }
    this.state.evidence.set(evidence.id, evidence);
    return evidence;
  }

  listDecisions() {
    return [...this.state.decisions.values()];
  }

  getDecision(decisionId: string) {
    return this.state.decisions.get(decisionId);
  }

  addDecision(decision: CandidateDecision) {
    if (this.state.decisions.has(decision.id)) {
      throw new Error(`候选裁定 ID 已存在: ${decision.id}`);
    }
    this.state.decisions.set(decision.id, decision);
    return decision;
  }

  findDecision(candidateKey: string, inputHash: string) {
    return this.listDecisions().find(
      (decision) =>
        decision.candidateKey === candidateKey &&
        decision.inputHash === inputHash,
    );
  }

  listCandidateRelations() {
    return [...this.state.candidateRelations.values()];
  }

  addCandidateRelation(relation: CandidateRelation) {
    if (this.state.candidateRelations.has(relation.id)) {
      throw new Error(`候选关系 ID 已存在: ${relation.id}`);
    }
    this.state.candidateRelations.set(relation.id, relation);
    return relation;
  }

  listEvents() {
    return [...this.state.events.values()];
  }

  getEvent(eventKey: string) {
    return this.state.events.get(eventKey);
  }

  addEvent(event: ResearchEvent) {
    if (this.state.events.has(event.eventKey)) {
      throw new Error(`研究事件已存在: ${event.eventKey}`);
    }
    this.state.events.set(event.eventKey, event);
    return event;
  }

  listRevisions() {
    return [...this.state.revisions.values()];
  }

  getRevision(revisionId: string) {
    return this.state.revisions.get(revisionId);
  }

  addRevision(revision: ResearchEventRevision) {
    if (this.state.revisions.has(revision.id)) {
      throw new Error(`事件修订 ID 已存在: ${revision.id}`);
    }
    this.state.revisions.set(revision.id, revision);
    return revision;
  }

  findRevision(eventKey: string, revisionDedupKey: string) {
    return this.listRevisions().find(
      (revision) =>
        revision.eventKey === eventKey &&
        revision.revisionDedupKey === revisionDedupKey,
    );
  }
}

/**
 * 仅作为 contract test 的内存替身；生产代码必须注入实现了同一 port 的 PostgreSQL store。
 */
export class InMemoryResearchEventLifecycleStore
  implements ResearchEventLifecycleStore
{
  private state = emptyState();

  runTransaction<T>(
    work: (transaction: ResearchEventLifecycleStoreTransaction) => T,
  ): T {
    const workingState = cloneState(this.state);
    const transaction = new InMemoryResearchEventLifecycleTransaction(
      workingState,
    );
    const result = work(transaction);
    this.state = workingState;
    return clone(result);
  }

  snapshot() {
    return snapshotFromState(this.state);
  }
}

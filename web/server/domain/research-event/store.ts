import type {
  CandidateDecision,
  CandidateEvidence,
  CandidateMaterial,
  ResearchEvent,
  ResearchEventCandidate,
  ResearchEventRevision,
} from "./types";

export type ResearchEventLifecycleSnapshot = {
  materials: CandidateMaterial[];
  candidates: ResearchEventCandidate[];
  evidence: CandidateEvidence[];
  decisions: CandidateDecision[];
  events: ResearchEvent[];
  revisions: ResearchEventRevision[];
};

export class InMemoryResearchEventLifecycleStore {
  readonly materials = new Map<string, CandidateMaterial>();
  readonly candidates = new Map<string, ResearchEventCandidate>();
  readonly evidence = new Map<string, CandidateEvidence>();
  readonly decisions = new Map<string, CandidateDecision>();
  readonly events = new Map<string, ResearchEvent>();
  readonly revisions = new Map<string, ResearchEventRevision>();

  private sequence = 0;

  nextId(prefix: string) {
    this.sequence += 1;
    return `${prefix}_${this.sequence}`;
  }

  addMaterial(material: CandidateMaterial) {
    this.materials.set(material.materialKey, material);
    return material;
  }

  addCandidate(candidate: ResearchEventCandidate) {
    this.candidates.set(candidate.candidateKey, candidate);
    return candidate;
  }

  addEvidence(evidence: CandidateEvidence) {
    this.evidence.set(evidence.id, evidence);
    return evidence;
  }

  addDecision(decision: CandidateDecision) {
    this.decisions.set(decision.id, decision);
    return decision;
  }

  addEvent(event: ResearchEvent) {
    this.events.set(event.eventKey, event);
    return event;
  }

  addRevision(revision: ResearchEventRevision) {
    this.revisions.set(revision.id, revision);
    return revision;
  }

  findDecisionByInputHash(inputHash: string) {
    return [...this.decisions.values()].find(
      (decision) => decision.inputHash === inputHash,
    );
  }

  findRevisionByDedupKey(revisionDedupKey: string) {
    return [...this.revisions.values()].find(
      (revision) => revision.revisionDedupKey === revisionDedupKey,
    );
  }

  snapshot(): ResearchEventLifecycleSnapshot {
    return {
      materials: [...this.materials.values()],
      candidates: [...this.candidates.values()],
      evidence: [...this.evidence.values()],
      decisions: [...this.decisions.values()],
      events: [...this.events.values()],
      revisions: [...this.revisions.values()],
    };
  }
}

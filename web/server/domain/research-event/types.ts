export const RESEARCH_EVENT_CONTRACT_VERSION =
  "research-event.lifecycle.v1" as const;

export type ResearchEventEvidenceKind =
  | "NEWS"
  | "ANNOUNCEMENT"
  | "POLICY"
  | "DATA_OBSERVATION"
  | "DATA_ANOMALY";

export type SourceIdentityStatus = "VERIFIED" | "UNVERIFIED" | "UNKNOWN";
export type ProofQualification =
  | "QUALIFIED"
  | "CORROBORATING_ONLY"
  | "NOT_QUALIFIED";
export type CandidateStatus =
  | "OPEN"
  | "DEFERRED"
  | "PROMOTED"
  | "REJECTED"
  | "DEFERRED_ENDED"
  | "TECHNICAL_HOLD";
export type CandidateDecisionOutcome =
  | "PROMOTE"
  | "DEFER"
  | "REJECT"
  | "TECHNICAL_HOLD";
export type ResearchEventStatus = "ACTIVE" | "RETRACTED";
export type ResearchEventRevisionKind =
  | "CONFIRMED"
  | "CORRECTED"
  | "REVERIFIED"
  | "RETRACTED";

export type CandidateMaterialInput = {
  materialKey: string;
  contentHash: string;
  kind: ResearchEventEvidenceKind;
  rawContent: Record<string, unknown>;
  sourceItemKey?: string;
  normalizedUrl?: string;
  sourceAssertionId?: string;
  observationRevisionId?: string;
  publishedAt?: string;
  fetchedAt: string;
};

export type CandidateEvidenceInput = {
  materialKey?: string;
  sourceAssertionId?: string;
  observationRevisionId?: string;
  evidenceKind: ResearchEventEvidenceKind;
  evidenceRole: "CORE_FACT" | "CONTEXT" | "COUNTER_EVIDENCE";
  sourceIdentityStatus: SourceIdentityStatus;
  proofQualification: ProofQualification;
  independenceKey: string;
  citation: Record<string, unknown>;
};

export type CandidateSeedInput = {
  seedKey: string;
  subjectType?: string;
  subjectKey?: string;
  clusterKey?: string;
  eventIdentityKey?: string;
  aggregationCertainty: "EXACT" | "UNCERTAIN";
  materials: CandidateMaterialInput[];
  evidence: CandidateEvidenceInput[];
};

export type CandidateMaterial = CandidateMaterialInput & {
  id: string;
  candidateKeys: string[];
};

export type CandidateEvidence = CandidateEvidenceInput & {
  id: string;
  candidateKey: string;
  materialId?: string;
  ordinal: number;
};

export type CandidateDecision = {
  id: string;
  candidateKey: string;
  decisionNo: number;
  inputHash: string;
  outcome: CandidateDecisionOutcome;
  decidedAt: string;
  evidenceGap: string[];
  releaseConditions: string[];
  linkedEventKey?: string;
  decision: Record<string, unknown>;
};

export type ResearchEventCandidate = {
  id: string;
  candidateKey: string;
  clusterKey: string;
  subjectType?: string;
  subjectKey?: string;
  status: CandidateStatus;
  currentDecisionId?: string;
  evidenceFrozenAt?: string;
  observationWindowEndsAt?: string;
  nextCheckAt?: string;
  closedAt?: string;
  createdAt: string;
  evidenceIds: string[];
  materialIds: string[];
  decisionIds: string[];
};

export type FactClaimInput = {
  claimType: string;
  claimText: string;
  isInference?: boolean;
  citations: Array<{
    candidateEvidenceId?: string;
    sourceAssertionId?: string;
    observationRevisionId?: string;
    relation: "SUPPORTS" | "CONTRADICTS" | "CONTEXT";
    sourceIdentityStatus: SourceIdentityStatus;
    proofQualification: ProofQualification;
    citation: Record<string, unknown>;
  }>;
};

export type ResearchEventRevision = {
  id: string;
  eventKey: string;
  revisionNo: number;
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
  createdAt: string;
};

export type ResearchEvent = {
  id: string;
  eventKey: string;
  canonicalizationVersion: string;
  subjectType: string;
  subjectKey: string;
  status: ResearchEventStatus;
  currentRevisionId?: string;
  createdAt: string;
  revisionIds: string[];
};

export type CandidateBackfillResult = {
  candidates: ResearchEventCandidate[];
  materials: CandidateMaterial[];
  evidence: CandidateEvidence[];
  duplicateMaterialKeys: string[];
};

export type AdjudicateCandidateInput = {
  candidateKey: string;
  inputHash: string;
  outcome: CandidateDecisionOutcome;
  decidedAt: string;
  title?: string;
  summary?: string;
  narrative?: Record<string, unknown>;
  uncertainty?: Record<string, unknown>;
  counterEvidence?: Record<string, unknown>;
  occurredAt?: string;
  knownAt?: string;
  evidenceGap?: string[];
  releaseConditions?: string[];
  claims?: FactClaimInput[];
  splitInto?: Array<{
    candidateKey: string;
    subjectType: string;
    subjectKey: string;
    eventIdentityKey: string;
    evidenceIds: string[];
  }>;
  mergeCandidateKeys?: string[];
};

export type AdjudicateCandidateResult = {
  decision: CandidateDecision;
  candidate: ResearchEventCandidate;
  event?: ResearchEvent;
  revision?: ResearchEventRevision;
  splitCandidates: ResearchEventCandidate[];
  mergedCandidateKeys: string[];
};

export type ReviseResearchEventInput = {
  eventKey: string;
  revisionDedupKey: string;
  revisionKind: Exclude<ResearchEventRevisionKind, "CONFIRMED">;
  title: string;
  summary: string;
  narrative: Record<string, unknown>;
  uncertainty: Record<string, unknown>;
  counterEvidence: Record<string, unknown>;
  occurredAt: string;
  knownAt: string;
  claims: FactClaimInput[];
};

export type RevisionReadModel = ResearchEventRevision & {
  eventStatus: ResearchEventStatus;
  isCurrent: boolean;
  statusNotice?: string;
};

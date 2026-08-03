export const RESEARCH_EVENT_CONTRACT_VERSION =
  "research-event.lifecycle.v2" as const;
export const RESEARCH_EVENT_CANONICALIZATION_VERSION = "v1" as const;

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

export type CandidateMaterial = CandidateMaterialInput & {
  id: string;
  materialIdentityKey: string;
  candidateKeys: string[];
  conflictIds: string[];
};

export type MaterialConflictField =
  | "materialKey"
  | "sourceItemKey"
  | "normalizedUrl"
  | "contentHash";

export type CandidateMaterialConflict = {
  id: string;
  existingMaterialId: string;
  incomingMaterialId: string;
  materialKey: string;
  conflictFields: MaterialConflictField[];
  detectedAt: string;
  reason: "IDENTITY_CONTENT_MISMATCH" | "MATERIAL_KEY_REUSED";
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
  qualityStatus?: "NORMAL" | "DEGRADED" | "ISOLATED" | "EXPIRED" | "UNKNOWN";
};

export type CandidateEvidence = CandidateEvidenceInput & {
  id: string;
  candidateKey: string;
  materialId?: string;
  ordinal: number;
  frozenInDecisionIds: string[];
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

export type CandidateDecisionEvidence = {
  evidenceId: string;
  sourceIdentityStatus: SourceIdentityStatus;
  proofQualification: ProofQualification;
  independenceKey: string;
};

export type TechnicalRetry = {
  attempt: number;
  maxAttempts: number;
  nextRetryAt: string;
};

export type CandidateDecision = {
  id: string;
  candidateKey: string;
  decisionNo: number;
  inputHash: string;
  outcome: CandidateDecisionOutcome;
  decidedAt: string;
  evidenceFrozenAt: string;
  frozenEvidenceIds: string[];
  evidenceSetHash: string;
  evidenceGap: string[];
  releaseConditions: string[];
  observationWindowEndsAt?: string;
  nextCheckAt?: string;
  technicalRetry?: TechnicalRetry;
  linkedEventKey?: string;
  decision: Record<string, unknown>;
};

export type CandidateRelationKind = "SPLIT_FROM" | "MERGED_INTO";

export type CandidateRelation = {
  id: string;
  relationKind: CandidateRelationKind;
  fromCandidateKey: string;
  toCandidateKey: string;
  reason?: string;
  evidenceIds: string[];
  decisionId: string;
  createdAt: string;
};

export type ResearchEventCandidate = {
  id: string;
  candidateKey: string;
  clusterKey: string;
  canonicalizationVersion: string;
  eventIdentityKey?: string;
  subjectType?: string;
  subjectKey?: string;
  parentCandidateKey?: string;
  status: CandidateStatus;
  currentDecisionId?: string;
  evidenceFrozenAt?: string;
  frozenEvidenceIds?: string[];
  evidenceSetHash?: string;
  observationWindowEndsAt?: string;
  nextCheckAt?: string;
  closedAt?: string;
  createdAt: string;
  evidenceIds: string[];
  materialIds: string[];
  decisionIds: string[];
  relationIds: string[];
};

export type FactClaimCitation = {
  candidateEvidenceId?: string;
  sourceAssertionId?: string;
  observationRevisionId?: string;
  relation: "SUPPORTS" | "CONTRADICTS" | "CONTEXT";
  sourceIdentityStatus: SourceIdentityStatus;
  proofQualification: ProofQualification;
  citation: Record<string, unknown>;
};

export type FactClaimInput = {
  claimType: string;
  claimText: string;
  isInference?: boolean;
  citations: FactClaimCitation[];
};

export type ResearchImpactInput = {
  subjectType: string;
  subjectKey: string;
  impactType: "BENEFIT" | "HARM" | "ATTENTION";
  materiality: "HIGH" | "MEDIUM" | "LOW";
  claimIndexes: number[];
  path?: Record<string, unknown>;
};

export type ResearchValueInput = {
  meaning: string;
  claimIndexes: number[];
  impactObjects: ResearchImpactInput[];
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
  researchValue: ResearchValueInput;
  createdAt: string;
};

export type ResearchEvent = {
  id: string;
  eventKey: string;
  canonicalizationVersion: string;
  eventIdentityKey: string;
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
  materialConflicts: CandidateMaterialConflict[];
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
  observationWindowEndsAt?: string;
  nextCheckAt?: string;
  technicalRetry?: TechnicalRetry;
  claims?: FactClaimInput[];
  researchValue?: ResearchValueInput;
  splitInto?: Array<{
    candidateKey: string;
    subjectType: string;
    subjectKey: string;
    eventIdentityKey: string;
    evidenceIds: string[];
    reason?: string;
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
  researchValue: ResearchValueInput;
};

export type RevisionReadModel = ResearchEventRevision & {
  eventStatus: ResearchEventStatus;
  isCurrent: boolean;
  statusNotice?: string;
};

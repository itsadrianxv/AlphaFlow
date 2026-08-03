export type ResearchInboxState = "UNREAD" | "READ" | "LATER" | "ARCHIVED";
export type ResearchInboxFilter = "PENDING" | "UNREAD" | "LATER" | "ARCHIVED";
export type ResearchInboxFeedbackValue = "USEFUL" | "NOISE";
export type ResearchInboxChannel = "IN_APP" | "BRIEFING" | "URGENT_ALERT";
export type ResearchInboxEntryKind =
  | "EVENT"
  | "CANDIDATE_PENDING_VERIFICATION"
  | "CORRECTION"
  | "RETRACTION"
  | "BRIEFING";

export type ResearchInboxAssessment = {
  level: string;
  reason: string;
};

export type ResearchInboxBody = {
  subject: { type: string; key: string; label: string };
  eventStatus: string;
  occurredAt: string;
  facts: string[];
  impact: string;
  reasons: string[];
  nextChecks: string[];
  risks: string[];
  assessments: {
    importance: ResearchInboxAssessment;
    confidence: ResearchInboxAssessment;
    relevance: ResearchInboxAssessment;
    informationNovelty: ResearchInboxAssessment;
  };
  evidence: Array<{
    id: string;
    source: string;
    excerpt: string;
    qualification: string;
    href?: string;
  }>;
  revisions: Array<{
    id: string;
    kind: string;
    label: string;
    summary: string;
    createdAt: string;
  }>;
  aiDisclosure: string;
  externalCopyStatus: string;
};

export type ResearchInboxReferences = {
  eventRevisionId: string | null;
  candidateId: string | null;
  briefingTaskId: string | null;
  globalAssessmentId: string | null;
  relevanceAssessmentId: string | null;
  preferenceSnapshotId: string | null;
};

export type ResearchInboxHistoryItem = {
  id: string;
  sequence: number;
  fromState: ResearchInboxState | null;
  toState: ResearchInboxState;
  action: string;
  commandId: string;
  occurredAt: string;
};

export type ResearchInboxEntry = {
  id: string;
  distributionKey: string;
  userId: string;
  highestChannel: ResearchInboxChannel;
  entryKind: ResearchInboxEntryKind;
  title: string;
  summary: string;
  body: ResearchInboxBody;
  references: ResearchInboxReferences;
  state: ResearchInboxState;
  feedback: ResearchInboxFeedbackValue | null;
  openedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  history: ResearchInboxHistoryItem[];
};

export type CreateResearchInboxEntryInput = {
  distributionKey: string;
  userId: string;
  eventRevisionId?: string;
  candidateId?: string;
  briefingTaskId?: string;
  globalAssessmentId?: string;
  relevanceAssessmentId?: string;
  preferenceSnapshotId?: string;
  highestChannel: ResearchInboxChannel;
  entryKind: ResearchInboxEntryKind;
  title: string;
  summary: string;
  body: ResearchInboxBody;
};

export type ChangeResearchInboxStateInput = {
  entryId: string;
  state: ResearchInboxState;
  commandId: string;
};

export type SetResearchInboxFeedbackInput = {
  entryId: string;
  value: ResearchInboxFeedbackValue;
  commandId: string;
};

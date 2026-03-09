import type {
  MarketRegimeAnalysis,
  MarketRegimeSnapshot,
  PortfolioRiskPlan,
  PortfolioSnapshotRecord,
  TechnicalAssessment,
  TimingAnalysisCardRecord,
  TimingCardDraft,
  TimingRecommendationDraft,
  TimingRecommendationRecord,
  TimingSignalBatchError,
  TimingSignalData,
  TimingSignalSnapshotRecord,
} from "~/server/domain/timing/types";

export const QUICK_RESEARCH_TEMPLATE_CODE = "quick_industry_research";
export const COMPANY_RESEARCH_TEMPLATE_CODE = "company_research_center";
export const SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE =
  "screening_insight_pipeline_v1";
export const TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE = "timing_signal_pipeline_v1";
export const WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE =
  "watchlist_timing_cards_pipeline_v1";
export const WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE =
  "watchlist_timing_pipeline_v1";

export const QUICK_RESEARCH_NODE_KEYS = [
  "agent1_industry_overview",
  "agent2_market_heat",
  "agent3_candidate_screening",
  "agent4_credibility_batch",
  "agent5_competition_summary",
] as const;

export const COMPANY_RESEARCH_NODE_KEYS = [
  "agent1_company_briefing",
  "agent2_concept_mapping",
  "agent3_question_design",
  "agent4_evidence_collection",
  "agent5_investment_synthesis",
] as const;

export const SCREENING_INSIGHT_PIPELINE_NODE_KEYS = [
  "load_run_context",
  "screen_candidates",
  "collect_evidence_batch",
  "synthesize_insights",
  "validate_insights",
  "archive_insights",
  "schedule_review_reminders",
  "archive_empty_result",
  "notify_user",
] as const;

export const TIMING_SIGNAL_PIPELINE_NODE_KEYS = [
  "load_targets",
  "fetch_signal_snapshots",
  "technical_signal_agent",
  "timing_synthesis_agent",
  "persist_cards",
] as const;

export const WATCHLIST_TIMING_CARDS_PIPELINE_NODE_KEYS = [
  "load_watchlist_context",
  "fetch_signal_snapshots_batch",
  "technical_signal_agent",
  "timing_synthesis_agent",
  "persist_cards",
] as const;

export const WATCHLIST_TIMING_PIPELINE_NODE_KEYS = [
  "load_watchlist_context",
  "fetch_signal_snapshots_batch",
  "technical_signal_agent",
  "timing_synthesis_agent",
  "market_regime_agent",
  "watchlist_risk_manager",
  "watchlist_portfolio_manager",
  "persist_recommendations",
] as const;

export type QuickResearchNodeKey = (typeof QUICK_RESEARCH_NODE_KEYS)[number];
export type CompanyResearchNodeKey =
  (typeof COMPANY_RESEARCH_NODE_KEYS)[number];
export type ScreeningInsightPipelineNodeKey =
  (typeof SCREENING_INSIGHT_PIPELINE_NODE_KEYS)[number];
export type TimingSignalPipelineNodeKey =
  (typeof TIMING_SIGNAL_PIPELINE_NODE_KEYS)[number];
export type WatchlistTimingCardsPipelineNodeKey =
  (typeof WATCHLIST_TIMING_CARDS_PIPELINE_NODE_KEYS)[number];
export type WatchlistTimingPipelineNodeKey =
  (typeof WATCHLIST_TIMING_PIPELINE_NODE_KEYS)[number];
export type WorkflowNodeKey =
  | QuickResearchNodeKey
  | CompanyResearchNodeKey
  | ScreeningInsightPipelineNodeKey
  | TimingSignalPipelineNodeKey
  | WatchlistTimingCardsPipelineNodeKey
  | WatchlistTimingPipelineNodeKey
  | string;

export type WorkflowTemplateCode =
  | typeof QUICK_RESEARCH_TEMPLATE_CODE
  | typeof COMPANY_RESEARCH_TEMPLATE_CODE
  | typeof SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE
  | typeof TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE
  | typeof WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE
  | typeof WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE;

export type WorkflowEventStreamType =
  | "RUN_STARTED"
  | "NODE_STARTED"
  | "NODE_PROGRESS"
  | "NODE_SUCCEEDED"
  | "NODE_FAILED"
  | "RUN_SUCCEEDED"
  | "RUN_FAILED"
  | "RUN_CANCELLED";

export type WorkflowGraphState = Record<string, unknown> & {
  runId: string;
  userId: string;
  query: string;
  progressPercent: number;
  currentNodeKey?: WorkflowNodeKey;
  lastCompletedNodeKey?: WorkflowNodeKey;
  errors: string[];
};

export type QuickResearchInput = {
  query: string;
};

export type QuickResearchCandidate = {
  stockCode: string;
  stockName: string;
  reason: string;
  score: number;
};

export type QuickResearchCredibility = {
  stockCode: string;
  credibilityScore: number;
  highlights: string[];
  risks: string[];
};

export type QuickResearchTopPick = {
  stockCode: string;
  stockName: string;
  reason: string;
};

export type QuickResearchResultDto = {
  overview: string;
  heatScore: number;
  heatConclusion: string;
  candidates: QuickResearchCandidate[];
  credibility: QuickResearchCredibility[];
  topPicks: QuickResearchTopPick[];
  competitionSummary: string;
  generatedAt: string;
};

export type WorkflowStreamEvent = {
  runId: string;
  sequence: number;
  type: WorkflowEventStreamType;
  nodeKey?: WorkflowNodeKey;
  progressPercent: number;
  timestamp: string;
  payload: Record<string, unknown>;
};

export type QuickResearchGraphState = WorkflowGraphState & {
  currentNodeKey?: QuickResearchNodeKey;
  intent?: string;
  industryOverview?: string;
  heatAnalysis?: {
    heatScore: number;
    heatConclusion: string;
  };
  candidates?: QuickResearchCandidate[];
  credibility?: QuickResearchCredibility[];
  competition?: string;
  finalReport?: QuickResearchResultDto;
};

export type CompanyResearchInput = {
  companyName: string;
  stockCode?: string;
  officialWebsite?: string;
  focusConcepts?: string[];
  keyQuestion?: string;
  supplementalUrls?: string[];
};

export type CompanyResearchBrief = {
  companyName: string;
  stockCode?: string;
  officialWebsite?: string;
  researchGoal: string;
  focusConcepts: string[];
  keyQuestions: string[];
};

export type CompanyConceptInsight = {
  concept: string;
  whyItMatters: string;
  companyFit: string;
  monetizationPath: string;
  maturity: "核心成熟" | "成长加速" | "验证阶段";
};

export type CompanyResearchQuestion = {
  question: string;
  whyImportant: string;
  targetMetric: string;
  dataHint: string;
};

export type CompanyEvidenceNote = {
  title: string;
  url: string;
  sourceType: "official" | "news" | "industry";
  snippet: string;
  extractedFact: string;
  relevance: string;
};

export type CompanyQuestionFinding = {
  question: string;
  answer: string;
  confidence: "high" | "medium" | "low";
  evidenceUrls: string[];
  gaps: string[];
};

export type CompanyResearchVerdict = {
  stance: "优先研究" | "继续跟踪" | "暂不优先";
  summary: string;
  bullPoints: string[];
  bearPoints: string[];
  nextChecks: string[];
};

export type CompanyResearchResultDto = {
  brief: CompanyResearchBrief;
  conceptInsights: CompanyConceptInsight[];
  deepQuestions: CompanyResearchQuestion[];
  findings: CompanyQuestionFinding[];
  evidence: CompanyEvidenceNote[];
  verdict: CompanyResearchVerdict;
  crawler: {
    provider: "firecrawl";
    configured: boolean;
    queries: string[];
    notes: string[];
  };
  generatedAt: string;
};

export type CompanyResearchGraphState = WorkflowGraphState & {
  currentNodeKey?: CompanyResearchNodeKey;
  researchInput: CompanyResearchInput;
  brief?: CompanyResearchBrief;
  conceptInsights?: CompanyConceptInsight[];
  deepQuestions?: CompanyResearchQuestion[];
  evidence?: CompanyEvidenceNote[];
  findings?: CompanyQuestionFinding[];
  crawlerSummary?: CompanyResearchResultDto["crawler"];
  finalReport?: CompanyResearchResultDto;
};

export type ScreeningInsightPipelineInput = {
  screeningSessionId: string;
  maxInsightsPerSession?: number;
};

export type TimingSignalPipelineInput = {
  stockCode: string;
  asOfDate?: string;
};

export type WatchlistTimingCardsPipelineInput = {
  watchListId: string;
  asOfDate?: string;
};

export type WatchlistTimingPipelineInput = {
  watchListId: string;
  portfolioSnapshotId: string;
  asOfDate?: string;
};

export type TimingPipelineTarget = {
  stockCode: string;
  stockName?: string;
};

export type TimingWatchlistContext = {
  id: string;
  name: string;
  stockCount: number;
};

export type ScreeningInsightPipelineSessionSnapshot = {
  id: string;
  strategyId: string | null;
  strategyName: string;
  executedAt: string;
  completedAt?: string;
  totalScanned: number;
  matchedCount: number;
  executionTimeMs: number;
};

export type ScreeningInsightPipelineCandidate = {
  stockCode: string;
  stockName: string;
  score: number;
  scorePercent: number;
  matchedConditionCount: number;
  scoreExplanations: string[];
};

export type ScreeningInsightPipelineEvidenceBundle = {
  stockCode: string;
  stockName: string;
  score: number;
  factsBundle: Record<string, unknown>;
  evidenceRefs: Record<string, unknown>[];
  evidence: Record<string, unknown> | null;
};

export type ScreeningInsightPipelineInsightCard = {
  insightId?: string;
  latestVersionId?: string;
  watchListId?: string;
  stockCode: string;
  stockName: string;
  score: number;
  summary: string;
  status: "ACTIVE" | "NEEDS_REVIEW" | "ARCHIVED";
  qualityFlags: string[];
  nextReviewAt: string;
  thesis: Record<string, unknown>;
  risks: Record<string, unknown>[];
  catalysts: Record<string, unknown>[];
  reviewPlan: Record<string, unknown>;
  evidenceRefs: Record<string, unknown>[];
  existingInsightId?: string;
  existingVersion?: number;
  existingLatestVersionId?: string;
  existingCreatedAt?: string;
};

export type WorkflowArchiveArtifacts = {
  insightIds: string[];
  versionIds: string[];
  emptyResultArchived: boolean;
};

export type ScreeningInsightPipelineNotificationPayload = {
  screeningSessionId: string;
  strategyName: string;
  candidateCount: number;
  insightCount: number;
  needsReviewCount: number;
  reminderCount: number;
  emptyResult: boolean;
  title: string;
  summary: string;
};

export type ScreeningInsightPipelineGraphState = WorkflowGraphState & {
  currentNodeKey?: ScreeningInsightPipelineNodeKey;
  lastCompletedNodeKey?: ScreeningInsightPipelineNodeKey;
  screeningInput: ScreeningInsightPipelineInput;
  screeningSession?: ScreeningInsightPipelineSessionSnapshot;
  candidateUniverse: ScreeningInsightPipelineCandidate[];
  evidenceBundle: ScreeningInsightPipelineEvidenceBundle[];
  insightCards: ScreeningInsightPipelineInsightCard[];
  archiveArtifacts: WorkflowArchiveArtifacts;
  scheduledReminderIds: string[];
  notificationPayload?: ScreeningInsightPipelineNotificationPayload;
};

export type TimingSignalPipelineGraphState = WorkflowGraphState & {
  currentNodeKey?: TimingSignalPipelineNodeKey;
  lastCompletedNodeKey?: TimingSignalPipelineNodeKey;
  timingInput: TimingSignalPipelineInput;
  targets: TimingPipelineTarget[];
  signalSnapshots: TimingSignalData[];
  technicalAssessments: TechnicalAssessment[];
  cards: TimingCardDraft[];
  persistedSignalSnapshots: TimingSignalSnapshotRecord[];
  persistedCards: TimingAnalysisCardRecord[];
  batchErrors: TimingSignalBatchError[];
};

export type WatchlistTimingCardsPipelineGraphState = WorkflowGraphState & {
  currentNodeKey?: WatchlistTimingCardsPipelineNodeKey;
  lastCompletedNodeKey?: WatchlistTimingCardsPipelineNodeKey;
  timingInput: WatchlistTimingCardsPipelineInput;
  watchlist?: TimingWatchlistContext;
  targets: TimingPipelineTarget[];
  signalSnapshots: TimingSignalData[];
  technicalAssessments: TechnicalAssessment[];
  cards: TimingCardDraft[];
  persistedSignalSnapshots: TimingSignalSnapshotRecord[];
  persistedCards: TimingAnalysisCardRecord[];
  batchErrors: TimingSignalBatchError[];
};

export type WatchlistTimingPipelineGraphState = WorkflowGraphState & {
  currentNodeKey?: WatchlistTimingPipelineNodeKey;
  lastCompletedNodeKey?: WatchlistTimingPipelineNodeKey;
  timingInput: WatchlistTimingPipelineInput;
  watchlist?: TimingWatchlistContext;
  portfolioSnapshot?: PortfolioSnapshotRecord;
  targets: TimingPipelineTarget[];
  signalSnapshots: TimingSignalData[];
  technicalAssessments: TechnicalAssessment[];
  cards: TimingCardDraft[];
  marketRegimeSnapshot?: MarketRegimeSnapshot;
  marketRegimeAnalysis?: MarketRegimeAnalysis;
  riskPlan?: PortfolioRiskPlan;
  recommendations: TimingRecommendationDraft[];
  persistedRecommendations: TimingRecommendationRecord[];
  batchErrors: TimingSignalBatchError[];
};

export function getWorkflowNodeKeysFromGraphConfig(
  graphConfig: unknown,
): string[] {
  if (
    !graphConfig ||
    typeof graphConfig !== "object" ||
    Array.isArray(graphConfig)
  ) {
    return [];
  }

  const nodes = (graphConfig as { nodes?: unknown }).nodes;

  if (!Array.isArray(nodes)) {
    return [];
  }

  return nodes.filter((node): node is string => typeof node === "string");
}

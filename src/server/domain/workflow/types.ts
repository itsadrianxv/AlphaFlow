import type { ConfidenceAnalysis } from "~/server/domain/intelligence/confidence";
import type {
  CompanyEvidence,
  CompanyResearchPack,
  ThemeNewsItem,
} from "~/server/domain/intelligence/types";
import type {
  CompressedFindings,
  ResearchBriefV2,
  ResearchClarificationRequest,
  ResearchGapAnalysis,
  ResearchNote,
  ResearchPreferenceInput,
  ResearchRuntimeConfig,
  ResearchUnitPlan,
  ResearchUnitRun,
} from "~/server/domain/workflow/research";
import {
  getWorkflowNodeKeysFromParsedGraphConfig,
  resolveResearchRuntimeConfig,
} from "~/server/domain/workflow/research";
import type {
  MarketRegimeAnalysis,
  MarketRegimeSnapshot,
  PortfolioRiskPlan,
  PortfolioSnapshotRecord,
  TechnicalAssessment,
  TimingAnalysisCardRecord,
  TimingCardDraft,
  TimingPresetConfig,
  TimingPresetRecord,
  TimingRecommendationDraft,
  TimingRecommendationRecord,
  TimingReviewCompletionDraft,
  TimingReviewRecord,
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
export const SCREENING_TO_TIMING_TEMPLATE_CODE = "screening_to_timing_v1";
export const TIMING_REVIEW_LOOP_TEMPLATE_CODE = "timing_review_loop_v1";

export const QUICK_RESEARCH_NODE_KEYS = [
  "agent1_industry_overview",
  "agent2_market_heat",
  "agent3_candidate_screening",
  "agent4_credibility_batch",
  "agent5_competition_summary",
] as const;

export const QUICK_RESEARCH_V2_NODE_KEYS = [
  "agent0_clarify_scope",
  "agent1_write_research_brief",
  "agent2_plan_research_units",
  "agent3_execute_research_units",
  "agent4_gap_analysis",
  "agent5_compress_findings",
  "agent6_finalize_report",
] as const;

export const COMPANY_RESEARCH_V1_NODE_KEYS = [
  "agent1_company_briefing",
  "agent2_concept_mapping",
  "agent3_question_design",
  "agent4_evidence_collection",
  "agent5_investment_synthesis",
] as const;

export const COMPANY_RESEARCH_NODE_KEYS = [
  "agent1_company_briefing",
  "agent2_concept_mapping",
  "agent3_question_design",
  "agent4_source_grounding",
  "collector_official_sources",
  "collector_financial_sources",
  "collector_news_sources",
  "collector_industry_sources",
  "agent9_evidence_curation",
  "agent10_reference_enrichment",
  "agent11_investment_synthesis",
] as const;

export const COMPANY_RESEARCH_V3_NODE_KEYS = [
  "agent0_clarify_scope",
  "agent1_write_research_brief",
  "agent2_plan_research_units",
  "agent3_execute_research_units",
  "agent4_evidence_curation",
  "agent5_gap_analysis",
  "agent6_compress_findings",
  "agent7_reference_enrichment",
  "agent8_investment_synthesis",
] as const;

export const SCREENING_INSIGHT_PIPELINE_NODE_KEYS = [
  "load_run_context",
  "screen_candidates",
  "collect_evidence_batch",
  "synthesize_insights",
  "validate_insights",
  "review_gate",
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

export const SCREENING_TO_TIMING_NODE_KEYS = [
  "load_screening_results",
  "select_top_candidates",
  "run_timing_pipeline",
  "archive_results",
] as const;

export const TIMING_REVIEW_LOOP_NODE_KEYS = [
  "load_due_reviews",
  "evaluate_outcomes",
  "review_agent",
  "persist_reviews",
  "schedule_next_review",
] as const;

export type QuickResearchNodeKey = (typeof QUICK_RESEARCH_NODE_KEYS)[number];
export type CompanyResearchNodeKey =
  | (typeof COMPANY_RESEARCH_V1_NODE_KEYS)[number]
  | (typeof COMPANY_RESEARCH_NODE_KEYS)[number]
  | (typeof COMPANY_RESEARCH_V3_NODE_KEYS)[number];
export type QuickResearchV2NodeKey =
  (typeof QUICK_RESEARCH_V2_NODE_KEYS)[number];
export type ScreeningInsightPipelineNodeKey =
  (typeof SCREENING_INSIGHT_PIPELINE_NODE_KEYS)[number];
export type TimingSignalPipelineNodeKey =
  (typeof TIMING_SIGNAL_PIPELINE_NODE_KEYS)[number];
export type WatchlistTimingCardsPipelineNodeKey =
  (typeof WATCHLIST_TIMING_CARDS_PIPELINE_NODE_KEYS)[number];
export type WatchlistTimingPipelineNodeKey =
  (typeof WATCHLIST_TIMING_PIPELINE_NODE_KEYS)[number];
export type ScreeningToTimingNodeKey =
  (typeof SCREENING_TO_TIMING_NODE_KEYS)[number];
export type TimingReviewLoopNodeKey =
  (typeof TIMING_REVIEW_LOOP_NODE_KEYS)[number];
export type WorkflowNodeKey =
  | QuickResearchNodeKey
  | QuickResearchV2NodeKey
  | CompanyResearchNodeKey
  | ScreeningInsightPipelineNodeKey
  | TimingSignalPipelineNodeKey
  | WatchlistTimingCardsPipelineNodeKey
  | WatchlistTimingPipelineNodeKey
  | ScreeningToTimingNodeKey
  | TimingReviewLoopNodeKey
  | string;

export type WorkflowTemplateCode =
  | typeof QUICK_RESEARCH_TEMPLATE_CODE
  | typeof COMPANY_RESEARCH_TEMPLATE_CODE
  | typeof SCREENING_INSIGHT_PIPELINE_TEMPLATE_CODE
  | typeof TIMING_SIGNAL_PIPELINE_TEMPLATE_CODE
  | typeof WATCHLIST_TIMING_CARDS_PIPELINE_TEMPLATE_CODE
  | typeof WATCHLIST_TIMING_PIPELINE_TEMPLATE_CODE
  | typeof SCREENING_TO_TIMING_TEMPLATE_CODE
  | typeof TIMING_REVIEW_LOOP_TEMPLATE_CODE;

export type WorkflowEventStreamType =
  | "RUN_STARTED"
  | "RUN_PAUSED"
  | "RUN_RESUMED"
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
  resumeFromNodeKey?: WorkflowNodeKey;
  errors: string[];
  clarificationRequest?: ResearchClarificationRequest;
  researchRuntimeConfig?: ResearchRuntimeConfig;
  researchBrief?: ResearchBriefV2;
  researchUnits?: ResearchUnitPlan[];
  researchUnitRuns?: ResearchUnitRun[];
  researchNotes?: ResearchNote[];
  compressedFindings?: CompressedFindings;
  gapAnalysis?: ResearchGapAnalysis;
};

export type QuickResearchInput = {
  query: string;
  researchPreferences?: ResearchPreferenceInput;
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
  confidenceAnalysis?: ConfidenceAnalysis;
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
  confidenceAnalysis?: ConfidenceAnalysis;
  brief?: ResearchBriefV2;
  researchPlan?: ResearchUnitPlan[];
  researchNotes?: ResearchNote[];
  compressedFindings?: CompressedFindings;
  gapAnalysis?: ResearchGapAnalysis;
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
  currentNodeKey?: QuickResearchNodeKey | QuickResearchV2NodeKey;
  researchInput?: QuickResearchInput;
  intent?: string;
  industryOverview?: string;
  news?: ThemeNewsItem[];
  heatAnalysis?: {
    heatScore: number;
    heatConclusion: string;
  };
  candidates?: QuickResearchCandidate[];
  credibility?: QuickResearchCredibility[];
  evidenceList?: CompanyEvidence[];
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
  researchPreferences?: ResearchPreferenceInput;
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

export type CompanyResearchCollectorKey =
  | "official_sources"
  | "financial_sources"
  | "news_sources"
  | "industry_sources";

export type CompanyResearchSourceType =
  | "official"
  | "financial"
  | "news"
  | "industry";

export type CompanyResearchSourceTier = "first_party" | "third_party";

export type CompanyEvidenceNote = {
  referenceId: string;
  title: string;
  sourceName: string;
  url?: string;
  sourceType: CompanyResearchSourceType;
  sourceTier: CompanyResearchSourceTier;
  collectorKey: CompanyResearchCollectorKey;
  isFirstParty: boolean;
  snippet: string;
  extractedFact: string;
  relevance: string;
  publishedAt?: string;
};

export type CompanyQuestionFinding = {
  question: string;
  answer: string;
  confidence: "high" | "medium" | "low";
  evidenceUrls: string[];
  referenceIds: string[];
  gaps: string[];
};

export type CompanyResearchReferenceItem = {
  id: string;
  title: string;
  sourceName: string;
  snippet: string;
  extractedFact: string;
  url?: string;
  publishedAt?: string;
  credibilityScore?: number;
  sourceType: CompanyResearchSourceType | string;
  sourceTier: CompanyResearchSourceTier;
  collectorKey: CompanyResearchCollectorKey;
  isFirstParty: boolean;
};

export type CompanyResearchGroundedSource = {
  url: string;
  title: string;
  sourceType: CompanyResearchSourceType;
  sourceTier: CompanyResearchSourceTier;
  collectorKey: CompanyResearchCollectorKey;
  isFirstParty: boolean;
  reason: string;
};

export type CompanyResearchCollectorSummary = {
  collectorKey: CompanyResearchCollectorKey;
  label: string;
  rawCount: number;
  curatedCount: number;
  referenceCount: number;
  firstPartyCount: number;
  configured: boolean;
  notes: string[];
};

export type CompanyResearchCollectorRunInfo = {
  collectorKey: CompanyResearchCollectorKey;
  configured: boolean;
  queries: string[];
  notes: string[];
};

export type CompanyResearchCollectionSummary = {
  collectors: CompanyResearchCollectorSummary[];
  totalRawCount: number;
  totalCuratedCount: number;
  totalReferenceCount: number;
  totalFirstPartyCount: number;
  notes: string[];
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
  references: CompanyResearchReferenceItem[];
  verdict: CompanyResearchVerdict;
  collectionSummary: CompanyResearchCollectionSummary;
  crawler: {
    provider: "firecrawl";
    configured: boolean;
    queries: string[];
    notes: string[];
  };
  confidenceAnalysis?: ConfidenceAnalysis;
  researchPlan?: ResearchUnitPlan[];
  researchNotes?: ResearchNote[];
  compressedFindings?: CompressedFindings;
  gapAnalysis?: ResearchGapAnalysis;
  runtimeConfigSummary?: Pick<
    ResearchRuntimeConfig,
    | "allowClarification"
    | "maxConcurrentResearchUnits"
    | "maxGapIterations"
    | "maxUnitsPerPlan"
    | "maxEvidencePerUnit"
  >;
  generatedAt: string;
};

export type CompanyResearchGraphState = WorkflowGraphState & {
  currentNodeKey?: CompanyResearchNodeKey;
  researchInput: CompanyResearchInput;
  brief?: CompanyResearchBrief;
  conceptInsights?: CompanyConceptInsight[];
  deepQuestions?: CompanyResearchQuestion[];
  groundedSources?: CompanyResearchGroundedSource[];
  collectedEvidenceByCollector?: Partial<
    Record<CompanyResearchCollectorKey, CompanyEvidenceNote[]>
  >;
  collectorPacks?: Partial<
    Record<CompanyResearchCollectorKey, CompanyResearchPack | undefined>
  >;
  collectorRunInfo?: Partial<
    Record<CompanyResearchCollectorKey, CompanyResearchCollectorRunInfo>
  >;
  collectionNotes?: string[];
  evidence?: CompanyEvidenceNote[];
  references?: CompanyResearchReferenceItem[];
  findings?: CompanyQuestionFinding[];
  collectionSummary?: CompanyResearchCollectionSummary;
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
  presetId?: string;
};

export type WatchlistTimingCardsPipelineInput = {
  watchListId: string;
  asOfDate?: string;
  presetId?: string;
};

export type WatchlistTimingPipelineInput = {
  watchListId: string;
  portfolioSnapshotId: string;
  asOfDate?: string;
  presetId?: string;
};

export type ScreeningToTimingPipelineInput = {
  screeningSessionId: string;
  candidateLimit?: number;
  asOfDate?: string;
  presetId?: string;
};

export type TimingReviewLoopInput = {
  date?: string;
  limit?: number;
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
  confidenceAnalysis?: ConfidenceAnalysis;
  confidenceScore?: number | null;
  confidenceLevel?: ConfidenceAnalysis["level"];
  confidenceStatus?: ConfidenceAnalysis["status"];
  supportedClaimCount?: number;
  insufficientClaimCount?: number;
  contradictedClaimCount?: number;
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
  reviewApproved: boolean;
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
  preset?: TimingPresetRecord;
  presetConfig?: TimingPresetConfig;
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
  preset?: TimingPresetRecord;
  presetConfig?: TimingPresetConfig;
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
  preset?: TimingPresetRecord;
  presetConfig?: TimingPresetConfig;
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
  reviewRecords: TimingReviewRecord[];
  scheduledReminderIds: string[];
  batchErrors: TimingSignalBatchError[];
};

export type ScreeningToTimingSessionSnapshot = {
  id: string;
  strategyName: string;
  executedAt: string;
  completedAt?: string;
  matchedCount: number;
};

export type ScreeningToTimingGraphState = WorkflowGraphState & {
  currentNodeKey?: ScreeningToTimingNodeKey;
  lastCompletedNodeKey?: ScreeningToTimingNodeKey;
  timingInput: ScreeningToTimingPipelineInput;
  screeningSession?: ScreeningToTimingSessionSnapshot;
  preset?: TimingPresetRecord;
  presetConfig?: TimingPresetConfig;
  targets: TimingPipelineTarget[];
  selectedTargets: TimingPipelineTarget[];
  signalSnapshots: TimingSignalData[];
  technicalAssessments: TechnicalAssessment[];
  cards: TimingCardDraft[];
  persistedSignalSnapshots: TimingSignalSnapshotRecord[];
  persistedCards: TimingAnalysisCardRecord[];
  reviewRecords: TimingReviewRecord[];
  scheduledReminderIds: string[];
  batchErrors: TimingSignalBatchError[];
};

export type TimingReviewOutcome = TimingReviewCompletionDraft & {
  stockCode: string;
  reviewHorizon: TimingReviewRecord["reviewHorizon"];
  expectedAction: TimingReviewRecord["expectedAction"];
};

export type TimingReviewLoopGraphState = WorkflowGraphState & {
  currentNodeKey?: TimingReviewLoopNodeKey;
  lastCompletedNodeKey?: TimingReviewLoopNodeKey;
  timingInput: TimingReviewLoopInput;
  dueReviews: TimingReviewRecord[];
  evaluatedReviews: TimingReviewOutcome[];
  persistedReviews: TimingReviewRecord[];
  consumedReminderIds: string[];
};

export function getWorkflowNodeKeysFromGraphConfig(
  graphConfig: unknown,
): string[] {
  return getWorkflowNodeKeysFromParsedGraphConfig(graphConfig);
}

export { resolveResearchRuntimeConfig };

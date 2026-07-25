import type { EvidenceCitation } from "~/server/domain/evidence-context/types";

export const TIMING_SOURCE_TYPES = [
  "single",
  "watchlist",
  "screening",
] as const;

export const TIMING_ACTIONS = [
  "WATCH",
  "PROBE",
  "ENTER",
  "ADD",
  "HOLD",
  "TRIM",
  "EXIT",
] as const;

export const STAGE_ONE_TIMING_ACTIONS = ["WATCH", "PROBE", "ENTER"] as const;

export const TIMING_SETUP_TYPES = [
  "TREND_CONTINUATION",
  "BREAKOUT",
  "PULLBACK",
  "OVERSOLD_REVERSAL",
] as const;

export const TIMING_HORIZON_TEMPLATES = [
  "SHORT_SWING",
  "SWING",
  "MEDIUM_TERM",
] as const;

export const TIMING_RULE_ROLES = ["PRIMARY", "CONFIRMATION", "VETO"] as const;

export const TIMING_DECISION_STATUSES = [
  "DATA_INCOMPLETE",
  "NOT_READY",
  "FORMING",
  "TRIGGERED",
  "INVALIDATED",
] as const;

export const TIMING_RISK_FLAGS = [
  "HIGH_VOLATILITY",
  "OVERBOUGHT",
  "OVERSOLD",
  "TREND_WEAKENING",
  "HIGH_CORRELATION",
  "CROWDING_RISK",
  "EVENT_UNCERTAINTY",
  "WEAK_RELATIVE_STRENGTH",
  "THIN_LIQUIDITY",
  "FAILED_BREAKOUT",
  "NEAR_INVALIDATION",
] as const;

export const TIMING_MARKET_STATES = ["RISK_ON", "NEUTRAL", "RISK_OFF"] as const;

export const TIMING_MARKET_TRANSITIONS = [
  "IMPROVING",
  "STABLE",
  "DETERIORATING",
  "PIVOT_UP",
  "PIVOT_DOWN",
] as const;

export const TIMING_MARKET_BREADTH_TRENDS = [
  "EXPANDING",
  "STALLING",
  "CONTRACTING",
] as const;

export const TIMING_MARKET_VOLATILITY_TRENDS = [
  "RISING",
  "STABLE",
  "FALLING",
] as const;

export const TIMING_SIGNAL_ENGINE_KEYS = [
  "multiTimeframeAlignment",
  "relativeStrength",
  "volatilityPercentile",
  "liquidityStructure",
  "breakoutFailure",
  "gapVolumeQuality",
  "kronosForecast",
] as const;

export const TIMING_COST_ZONES = [
  "BELOW_COST",
  "NEAR_COST",
  "ABOVE_COST",
  "EXTENDED_FROM_COST",
] as const;

export const TIMING_PNL_ZONES = [
  "LOSS",
  "SMALL_GAIN",
  "MATURE_GAIN",
  "OVEREXTENDED_GAIN",
] as const;

export const TIMING_HOLDING_STAGES = [
  "EARLY",
  "MATURE",
  "LATE",
  "UNSPECIFIED",
] as const;

export const TIMING_INVALIDATION_RISKS = [
  "AT_RISK",
  "TIGHT",
  "SAFE",
  "UNKNOWN",
] as const;

export const TIMING_PRESET_ADJUSTMENT_STATUSES = [
  "PENDING",
  "APPLIED",
  "DISMISSED",
] as const;

export const TIMING_PRESET_ADJUSTMENT_KINDS = [
  "SIGNAL_ENGINE_WEIGHT",
  "CONTEXT_WEIGHT",
  "ACTION_THRESHOLD",
] as const;

export type TimingSourceType = (typeof TIMING_SOURCE_TYPES)[number];
export type TimingAction = (typeof TIMING_ACTIONS)[number];
export type StageOneTimingAction = (typeof STAGE_ONE_TIMING_ACTIONS)[number];
export type TimingSetupType = (typeof TIMING_SETUP_TYPES)[number];
export type TimingHorizonTemplate = (typeof TIMING_HORIZON_TEMPLATES)[number];
export type TimingRuleRole = (typeof TIMING_RULE_ROLES)[number];
export type TimingDecisionStatus = (typeof TIMING_DECISION_STATUSES)[number];
export type TimingRiskFlag = (typeof TIMING_RISK_FLAGS)[number];
export type TimingMarketState = (typeof TIMING_MARKET_STATES)[number];
export type TimingMarketTransition = (typeof TIMING_MARKET_TRANSITIONS)[number];
export type TimingMarketBreadthTrend =
  (typeof TIMING_MARKET_BREADTH_TRENDS)[number];
export type TimingMarketVolatilityTrend =
  (typeof TIMING_MARKET_VOLATILITY_TRENDS)[number];
export type TimingSignalEngineKey = (typeof TIMING_SIGNAL_ENGINE_KEYS)[number];
export type TimingDirection = "bullish" | "neutral" | "bearish";
export type TimingTimeframe =
  | "DAILY"
  | "WEEKLY"
  | "MONTHLY"
  | "MINUTE_60"
  | "MINUTE_30"
  | "MINUTE_15"
  | "MINUTE_1";
export type TimingFactorStatus = "positive" | "neutral" | "negative";
export type TimingReviewHorizon = "T5" | "T10" | "T20";
export type TimingReviewVerdict = "SUCCESS" | "MIXED" | "FAILURE";
export type TimingCostZone = (typeof TIMING_COST_ZONES)[number];
export type TimingPnlZone = (typeof TIMING_PNL_ZONES)[number];
export type TimingHoldingStage = (typeof TIMING_HOLDING_STAGES)[number];
export type TimingInvalidationRisk = (typeof TIMING_INVALIDATION_RISKS)[number];
export type TimingPresetAdjustmentSuggestionStatus =
  (typeof TIMING_PRESET_ADJUSTMENT_STATUSES)[number];
export type TimingPresetAdjustmentSuggestionKind =
  (typeof TIMING_PRESET_ADJUSTMENT_KINDS)[number];
export type TimingSignalMetricValue = string | number | boolean | null;
export type TimingSignalMetrics = Record<string, TimingSignalMetricValue>;

export type TimingPresetConfig = {
  contextWeights?: Partial<
    Record<
      "signalContext" | "marketContext" | "positionContext" | "feedbackContext",
      number
    >
  >;
  signalEngineWeights?: Partial<Record<TimingSignalEngineKey, number>>;
  positionWeights?: {
    invalidationRiskPenalty?: number;
    matureGainTrimBoost?: number;
    lossNearInvalidationPenalty?: number;
    earlyEntryBonus?: number;
  };
  feedbackPolicy?: {
    lookbackDays?: number;
    minimumSamples?: number;
    weightStep?: number;
    actionThresholdStep?: number;
    successRateDeltaThreshold?: number;
    averageReturnDeltaThreshold?: number;
  };
  confidenceThresholds?: {
    signalStrengthWeight?: number;
    alignmentWeight?: number;
    riskPenaltyPerFlag?: number;
    neutralPenalty?: number;
    minConfidence?: number;
    maxConfidence?: number;
  };
  actionThresholds?: {
    addConfidence?: number;
    addSignalStrength?: number;
    probeConfidence?: number;
    probeSignalStrength?: number;
    holdConfidence?: number;
    trimConfidence?: number;
    exitConfidence?: number;
  };
  reviewSchedule?: {
    horizons?: TimingReviewHorizon[];
  };
};

export type TimingRuleOperator =
  | ">="
  | ">"
  | "<="
  | "<"
  | "=="
  | "crosses_above"
  | "crosses_below";

export type TimingRuleDefinition = {
  id: string;
  name: string;
  indicatorId: string;
  role: TimingRuleRole;
  timeframe: TimingTimeframe;
  operator: TimingRuleOperator;
  threshold: number | string | boolean;
  confirmationBars: number;
  required: boolean;
  vetoSeverity?: "WARNING" | "CRITICAL";
  explanation: string;
  enabled: boolean;
};

export type TimingRuleGroupConfig = {
  role: TimingRuleRole;
  minSatisfied: number;
  rules: TimingRuleDefinition[];
};

export type TimingTimeframePlan = {
  template: TimingHorizonTemplate;
  contextTimeframes: TimingTimeframe[];
  decisionTimeframe: TimingTimeframe;
  executionTimeframe: TimingTimeframe;
  fallbackExecutionTimeframe?: TimingTimeframe;
};

export type TimingPresetConfigV2 = {
  schemaVersion: 2;
  setup: TimingSetupType;
  riskProfile: "STEADY" | "BALANCED" | "AGGRESSIVE";
  timeframePlan: TimingTimeframePlan;
  ruleGroups: TimingRuleGroupConfig[];
  marketGate: {
    neutralEntryAction: "WATCH" | "PROBE" | "ENTER";
    neutralAddAction: "HOLD" | "ADD";
    riskOffBlockedActions: Array<"PROBE" | "ENTER" | "ADD">;
  };
  dataPolicy: {
    asOfMode: "LATEST_COMPLETE" | "CURRENT_PARTIAL";
    primaryMissing: "NO_DECISION";
    confirmationMissing: "KEEP_FORMING";
    vetoMissing: "BLOCK_NEW_EXPOSURE";
    unfinishedHigherTimeframe: "OBSERVATION_ONLY";
  };
  reviewTradingDays: number[];
  backtestPolicy: {
    minimumMonths: number;
    minimumStocks: number;
    minimumTriggeredEvents: number;
    minimumPrimaryCompletenessPct: number;
    slippageBps: number;
    commissionBps: number;
    sellTaxBps: number;
  };
};

export type TimingFeatureEvidence = {
  indicatorId: string;
  timeframe: TimingTimeframe;
  value: number | string | boolean | null;
  previousValue?: number | string | boolean | null;
  consecutiveBars?: number;
  asOfDate: string;
  source: string;
  status: "AVAILABLE" | "MISSING" | "STALE" | "OBSERVATION_ONLY";
  rawValue?: number | string | boolean | null;
  normalizedValue?: number | string | boolean | null;
  inputValues?: Record<string, unknown>;
  warnings?: string[];
};

export type TimingDataManifestItem = {
  dataset: string;
  source: string;
  timeframe?: TimingTimeframe | null;
  dataDate?: string | null;
  fetchedAt: string;
  completeness: "COMPLETE" | "PARTIAL" | "MISSING" | "OBSERVATION_ONLY";
  degradationReason?: string | null;
  contentHash: string;
  rowCount: number;
};

export type TimingEvidenceData = {
  stockCode: string;
  stockName: string;
  asOfDate: string;
  featureVersion: string;
  templateVersion?: number | null;
  validationSource?: "SYSTEM_TEMPLATE" | "HISTORICAL_BACKTEST" | null;
  features: TimingFeatureEvidence[];
  barsByTimeframe: TimingBarsByTimeframe;
  sourceRows: Record<string, Array<Record<string, unknown>>>;
  dataManifest: TimingDataManifestItem[];
  warnings: string[];
  inputHash: string;
};

export type TimingEvidenceBatchData = {
  items: TimingEvidenceData[];
  errors: TimingSignalBatchError[];
};

export type TimingEvidenceHistoryData = {
  items: Array<{
    stockCode: string;
    stockName: string;
    timeline: TimingEvidenceData[];
    bars: TimingBar[];
    marketStates: Record<string, TimingMarketState>;
  }>;
  errors: TimingSignalBatchError[];
};

export type TimingRuleEvaluation = {
  ruleId: string;
  ruleName: string;
  role: TimingRuleRole;
  indicatorId: string;
  timeframe: TimingTimeframe;
  operator: TimingRuleOperator;
  threshold: TimingRuleDefinition["threshold"];
  actual: TimingFeatureEvidence["value"];
  asOfDate?: string;
  source?: string;
  status: "PASSED" | "FAILED" | "MISSING" | "STALE" | "OBSERVATION_ONLY";
  required: boolean;
  vetoSeverity?: TimingRuleDefinition["vetoSeverity"];
  explanation: string;
};

export type TimingDecisionAudit = {
  schemaVersion: 2;
  strategyRevisionId?: string;
  configHash?: string;
  engineVersion: string;
  featureVersion: string;
  setup: TimingSetupType;
  status: TimingDecisionStatus;
  ruleEvaluations: TimingRuleEvaluation[];
  groupResults: Array<{
    role: TimingRuleRole;
    passed: number;
    required: number;
    minSatisfied: number;
    satisfied: boolean;
    missing: number;
  }>;
  riskUnresolved: boolean;
  potentialAction: TimingAction | null;
  finalAction: TimingAction | null;
  gateTrace: string[];
};

export type TimingPresetRevisionStatus =
  | "DRAFT"
  | "VALIDATING"
  | "PUBLISHED"
  | "ARCHIVED";

export type TimingPresetRevisionRecord = {
  id: string;
  presetId: string;
  userId: string;
  revisionNumber: number;
  status: TimingPresetRevisionStatus;
  config: TimingPresetConfigV2;
  configHash: string;
  engineVersion: string;
  featureVersion: string;
  templateVersion?: number | null;
  validationSource?: "SYSTEM_BASELINE" | "HISTORICAL_BACKTEST" | null;
  publishedAt?: Date | null;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TimingStrategyRecord = {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  origin?: "SYSTEM_TEMPLATE" | "USER";
  templateKey?: string | null;
  activeRevisionId?: string | null;
  activeRevision?: TimingPresetRevisionRecord | null;
  revisions: TimingPresetRevisionRecord[];
  createdAt: Date;
  updatedAt: Date;
};

export type TimingBacktestQualityMetrics = {
  coveredMonths: number;
  stockCount: number;
  triggeredEvents: number;
  primaryCompletenessPct: number;
  noLookaheadPassed: boolean;
  gatePassed: boolean;
  failures: string[];
};

export type TimingBacktestPerformanceMetrics = {
  completedTrades: number;
  hitRatePct: number;
  averageReturnPct: number;
  averageExcessReturnPct: number;
  maxFavorableExcursionPct: number;
  maxAdverseExcursionPct: number;
};

export type TimingExecutionRecordDecision = "ACCEPTED" | "REJECTED" | "SKIPPED";

export type TimingBar = {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount?: number | null;
  turnoverRate?: number | null;
};

export type TimingKronosForecastSummary = {
  expectedReturnPct: number;
  maxDrawdownPct: number;
  upsidePct: number;
  volatilityProxy: number;
  direction: TimingDirection;
  confidence: number;
};

export type TimingKronosForecastPoint = {
  tradeDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
  amount?: number | null;
};

export type TimingKronosForecast = {
  stockCode: string;
  timeframe: TimingTimeframe;
  asOfDate: string;
  modelName: string;
  modelVersion: string;
  lookbackDays?: number;
  lookbackBars: number;
  predictionLength: number;
  device: string;
  points: TimingKronosForecastPoint[];
  summary: TimingKronosForecastSummary;
  warnings: string[];
};

export type TimingMacd = {
  dif: number;
  dea: number;
  histogram: number;
};

export type TimingRsi = {
  value: number;
};

export type TimingBollinger = {
  upper: number;
  middle: number;
  lower: number;
  closePosition: number;
};

export type TimingObv = {
  value: number;
  slope: number;
};

export type TimingIndicators = {
  close: number;
  macd: TimingMacd;
  rsi: TimingRsi;
  bollinger: TimingBollinger;
  obv: TimingObv;
  ema5: number;
  ema20: number;
  ema60: number;
  ema120: number;
  atr14: number;
  volumeRatio20: number;
  realizedVol20: number;
  realizedVol120: number;
  amount?: number | null;
  turnoverRate?: number | null;
};

export type TimingSignalEngineResult = {
  key: TimingSignalEngineKey;
  label: string;
  direction: TimingDirection;
  score: number;
  confidence: number;
  weight: number;
  detail: string;
  metrics: TimingSignalMetrics;
  warnings: string[];
};

export type TimingSignalComposite = {
  score: number;
  confidence: number;
  direction: TimingDirection;
  signalStrength: number;
  participatingEngines: number;
};

export type TimingSignalContext = {
  engines: TimingSignalEngineResult[];
  composite: TimingSignalComposite;
};

export type TimingBarsData = {
  stockCode: string;
  stockName: string;
  timeframe: TimingTimeframe;
  adjust: string;
  bars: TimingBar[];
};

export type TimingBarsByTimeframe = Partial<
  Record<TimingTimeframe, TimingBar[]>
>;

export type TimingChartLinePoint = {
  tradeDate: string;
  value: number;
};

export type TimingChartLevels = {
  ema5: TimingChartLinePoint[];
  ema20: TimingChartLinePoint[];
  ema60: TimingChartLinePoint[];
  ema120: TimingChartLinePoint[];
  recentHigh60d: number;
  recentLow20d: number;
  avgVolume20: number;
  volumeSpikeDates: string[];
};

export type TimingSignalData = {
  stockCode: string;
  stockName: string;
  asOfDate: string;
  barsCount: number;
  bars?: TimingBar[];
  barsByTimeframe?: TimingBarsByTimeframe;
  indicators: TimingIndicators;
  signalContext: TimingSignalContext;
};

export type TimingSignalBatchError = {
  stockCode: string;
  code: string;
  message: string;
};

export type TimingSignalBatchData = {
  items: TimingSignalData[];
  errors: TimingSignalBatchError[];
};

export type TimingEngineBreakdownItem = {
  key: TimingSignalEngineKey;
  label: string;
  status: TimingFactorStatus;
  score: number;
  confidence: number;
  weight: number;
  detail: string;
};

export type TimingFactorBreakdownItem = TimingEngineBreakdownItem;

export type TimingExecutionCondition = {
  id: string;
  kind: "TRIGGER" | "INVALIDATION";
  category:
    | "TREND"
    | "RELATIVE_STRENGTH"
    | "LIQUIDITY"
    | "BREAKOUT"
    | "VOLATILITY"
    | "PRICE_LEVEL"
    | "FORECAST";
  label: string;
  metric: string;
  operator: ">=" | ">" | "<=" | "<" | "==" | "crosses_above" | "crosses_below";
  threshold: number | string;
  actual?: number | string | null;
  unit?: string;
  lookbackDays?: number;
  status: "TRIGGERED" | "NEAR" | "PENDING" | "INVALIDATED";
  severity: "INFO" | "WARNING" | "CRITICAL";
  explanation: string;
};

export type TimingSignalReasoningContext = {
  direction: TimingDirection;
  compositeScore: number;
  signalStrength: number;
  confidence: number;
  engineBreakdown: TimingEngineBreakdownItem[];
  triggerNotes: string[];
  invalidationNotes: string[];
  triggerConditions?: TimingExecutionCondition[];
  invalidationConditions?: TimingExecutionCondition[];
  riskFlags: TimingRiskFlag[];
  explanation: string;
  summary: string;
};

export type TechnicalAssessment = {
  stockCode: string;
  stockName: string;
  asOfDate: string;
  direction: TimingDirection;
  compositeScore: number;
  signalStrength: number;
  confidence: number;
  engineBreakdown: TimingEngineBreakdownItem[];
  triggerNotes: string[];
  invalidationNotes: string[];
  triggerConditions?: TimingExecutionCondition[];
  invalidationConditions?: TimingExecutionCondition[];
  riskFlags: TimingRiskFlag[];
  explanation: string;
  signalContext: TimingSignalReasoningContext;
};

export type TimingCardReasoning = {
  signalContext: TimingSignalReasoningContext;
  actionRationale: string;
  indicators: TimingIndicators;
  decisionAudit?: TimingDecisionAudit;
  dataManifest?: TimingDataManifestItem[];
  featureEvidence?: TimingFeatureEvidence[];
  inputHash?: string;
  kronosForecast?: TimingKronosForecastSummary;
  kronosForecasts?: Partial<
    Record<TimingTimeframe, TimingKronosForecastSummary>
  >;
  kronosWarnings?: string[];
  evidenceCitations?: EvidenceCitation[];
};

export type TimingSignalSnapshotRecord = {
  id: string;
  userId: string;
  workflowRunId?: string | null;
  stockCode: string;
  stockName: string;
  asOfDate: string;
  sourceType: TimingSourceType;
  sourceId: string;
  timeframe: TimingTimeframe;
  barsCount: number;
  bars?: TimingBar[];
  barsByTimeframe?: TimingBarsByTimeframe;
  indicators: TimingIndicators;
  signalContext: TimingSignalContext;
  presetRevisionId?: string | null;
  featureEvidence?: TimingFeatureEvidence[];
  dataManifest?: TimingDataManifestItem[];
  featureVersion?: string | null;
  inputHash?: string | null;
  createdAt: Date;
};

export type TimingAnalysisCardRecord = {
  id: string;
  userId: string;
  workflowRunId?: string | null;
  watchListId?: string | null;
  presetId?: string | null;
  presetRevisionId?: string | null;
  stockCode: string;
  stockName: string;
  asOfDate?: string;
  sourceType: TimingSourceType;
  sourceId: string;
  signalSnapshotId: string;
  actionBias: TimingAction;
  confidence: number;
  marketState?: TimingMarketState | null;
  marketTransition?: TimingMarketTransition | null;
  summary: string;
  triggerNotes: string[];
  invalidationNotes: string[];
  riskFlags: TimingRiskFlag[];
  reasoning: TimingCardReasoning;
  decisionStatus?: TimingDecisionStatus | null;
  decisionAudit?: TimingDecisionAudit | null;
  createdAt: Date;
  updatedAt: Date;
  signalSnapshot?: TimingSignalSnapshotRecord;
};

export type TimingCardDraft = {
  userId: string;
  workflowRunId?: string;
  watchListId?: string;
  presetId?: string;
  presetRevisionId?: string;
  stockCode: string;
  stockName: string;
  asOfDate: string;
  sourceType: TimingSourceType;
  sourceId: string;
  actionBias: TimingAction;
  confidence: number;
  marketState?: TimingMarketState;
  marketTransition?: TimingMarketTransition;
  summary: string;
  triggerNotes: string[];
  invalidationNotes: string[];
  riskFlags: TimingRiskFlag[];
  reasoning: TimingCardReasoning;
  decisionStatus?: TimingDecisionStatus;
  decisionAudit?: TimingDecisionAudit;
};

export type PortfolioPosition = {
  stockCode: string;
  stockName: string;
  quantity: number;
  costBasis: number;
  currentWeightPct: number;
  sector?: string;
  themes?: string[];
  openedAt?: string;
  lastAddedAt?: string;
  invalidationPrice?: number;
  plannedHoldingDays?: number;
};

export type PortfolioRiskPreferences = {
  maxSingleNamePct: number;
  maxThemeExposurePct: number;
  defaultProbePct: number;
  maxPortfolioRiskBudgetPct: number;
};

export type PortfolioSnapshotRecord = {
  id: string;
  userId: string;
  name: string;
  baseCurrency: string;
  cash: number;
  totalCapital: number;
  positions: PortfolioPosition[];
  riskPreferences: PortfolioRiskPreferences;
  source?: "SAVED" | "RUN_INPUT";
  workflowRunId?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PortfolioSnapshotDraft = {
  userId: string;
  name: string;
  baseCurrency: string;
  cash: number;
  totalCapital: number;
  positions: PortfolioPosition[];
  riskPreferences: PortfolioRiskPreferences;
};

export type MarketIndexSnapshot = {
  code: string;
  name: string;
  close: number;
  changePct: number;
  return5d: number;
  return10d: number;
  ema20: number;
  ema60: number;
  aboveEma20: boolean;
  aboveEma60: boolean;
  atrRatio: number;
  signalDirection: TimingDirection;
};

export type MarketBreadthPoint = {
  asOfDate: string;
  totalCount: number;
  advancingCount: number;
  decliningCount: number;
  flatCount: number;
  positiveRatio: number;
  aboveThreePctRatio: number;
  belowThreePctRatio: number;
  medianChangePct: number;
  averageTurnoverRate?: number | null;
};

export type MarketVolatilityPoint = {
  asOfDate: string;
  highVolatilityCount: number;
  highVolatilityRatio: number;
  limitDownLikeCount: number;
  indexAtrRatio: number;
};

export type MarketLeadershipPoint = {
  asOfDate: string;
  leaderCode: string;
  leaderName: string;
  ranking5d: string[];
  ranking10d: string[];
  switched: boolean;
  previousLeaderCode?: string | null;
};

export type MarketContextFeatureSnapshot = {
  benchmarkStrength: number;
  breadthScore: number;
  riskScore: number;
  stateScore: number;
  northboundFlowScore?: number | null;
  activityScore?: number | null;
};

export type MarketContextAvailability = {
  daily: boolean;
  dailyBasic: boolean;
  indexDaily: boolean;
  stockLimit?: boolean;
  indexDailyBasic?: boolean;
  hsgtFlow?: boolean;
  warnings?: string[];
};

export type MarketContextSnapshot = {
  asOfDate: string;
  indexes: MarketIndexSnapshot[];
  latestBreadth: MarketBreadthPoint;
  latestVolatility: MarketVolatilityPoint;
  latestLeadership: MarketLeadershipPoint;
  breadthSeries: MarketBreadthPoint[];
  volatilitySeries: MarketVolatilityPoint[];
  leadershipSeries: MarketLeadershipPoint[];
  features: MarketContextFeatureSnapshot;
  source?: string;
  availability?: MarketContextAvailability;
};

export type MarketContextAnalysis = {
  state: TimingMarketState;
  transition: TimingMarketTransition;
  regimeConfidence: number;
  persistenceDays: number;
  summary: string;
  constraints: string[];
  breadthTrend: TimingMarketBreadthTrend;
  volatilityTrend: TimingMarketVolatilityTrend;
  leadership: {
    leaderCode: string;
    leaderName: string;
    switched: boolean;
    previousLeaderCode?: string | null;
  };
  snapshot: MarketContextSnapshot;
  stateScore: number;
};

export type MarketContextSnapshotRecord = {
  id: string;
  asOfDate: string;
  state: TimingMarketState;
  transition: TimingMarketTransition;
  persistenceDays: number;
  snapshot: MarketContextSnapshot;
  analysis: MarketContextAnalysis;
  createdAt: Date;
  updatedAt: Date;
};

export type PortfolioRiskPlan = {
  portfolioRiskBudgetPct: number;
  maxSingleNamePct: number;
  defaultProbePct: number;
  blockedActions: TimingAction[];
  correlationWarnings: string[];
  notes: string[];
};

export type TimingPositionContext = {
  held: boolean;
  currentWeightPct: number;
  targetDeltaPct: number;
  availableCashPct: number;
  costBasis?: number | null;
  currentPrice?: number | null;
  daysHeld?: number | null;
  unrealizedPnlPct?: number | null;
  costZone: TimingCostZone;
  pnlZone: TimingPnlZone;
  holdingStage: TimingHoldingStage;
  distanceToInvalidationPct?: number | null;
  invalidationRisk: TimingInvalidationRisk;
};

export type TimingFeedbackContext = {
  presetId?: string | null;
  learningSummary: string;
  pendingSuggestionCount: number;
  adoptedSuggestionCount: number;
  highlights: string[];
};

export type TimingRecommendationReasoning = {
  signalContext: TimingSignalReasoningContext;
  marketContext: {
    state: TimingMarketState;
    transition: TimingMarketTransition;
    summary: string;
    constraints: string[];
    breadthTrend: TimingMarketBreadthTrend;
    volatilityTrend: TimingMarketVolatilityTrend;
    persistenceDays: number;
    leadership: MarketContextAnalysis["leadership"];
  };
  positionContext: TimingPositionContext;
  feedbackContext: TimingFeedbackContext;
  riskPlan: PortfolioRiskPlan;
  actionRationale: string;
  decisionAudit?: TimingDecisionAudit;
  dataManifest?: TimingDataManifestItem[];
  featureEvidence?: TimingFeatureEvidence[];
  inputHash?: string;
  kronosForecast?: TimingKronosForecastSummary;
  kronosWarnings?: string[];
  triggerConditions?: TimingExecutionCondition[];
  invalidationConditions?: TimingExecutionCondition[];
  evidenceCitations?: EvidenceCitation[];
};

export type TimingRecommendationRecord = {
  id: string;
  userId: string;
  workflowRunId?: string | null;
  portfolioSnapshotId: string;
  watchListId?: string | null;
  presetId?: string | null;
  presetRevisionId?: string | null;
  stockCode: string;
  stockName: string;
  action: TimingAction;
  priority: number;
  confidence: number;
  suggestedMinPct: number;
  suggestedMaxPct: number;
  riskBudgetPct: number;
  marketState: TimingMarketState;
  marketTransition: TimingMarketTransition;
  riskFlags: TimingRiskFlag[];
  decisionStatus?: TimingDecisionStatus | null;
  decisionAudit?: TimingDecisionAudit | null;
  reasoning: TimingRecommendationReasoning;
  createdAt: Date;
  updatedAt: Date;
};

export type TimingRecommendationDraft = {
  userId: string;
  workflowRunId?: string;
  portfolioSnapshotId: string;
  watchListId?: string | null;
  presetId?: string;
  presetRevisionId?: string;
  stockCode: string;
  stockName: string;
  action: TimingAction;
  priority: number;
  confidence: number;
  suggestedMinPct: number;
  suggestedMaxPct: number;
  riskBudgetPct: number;
  marketState: TimingMarketState;
  marketTransition: TimingMarketTransition;
  riskFlags: TimingRiskFlag[];
  decisionStatus?: TimingDecisionStatus;
  decisionAudit?: TimingDecisionAudit;
  reasoning: TimingRecommendationReasoning;
};

export type TimingExecutionDecision = {
  rawAction: TimingAction;
  finalAction: TimingAction;
  allowed: boolean;
  downgradeReasons: string[];
  requiredConfirmations: string[];
};

export type TimingExecutionBudget = {
  currentWeightPct: number | null;
  suggestedMinPct: number | null;
  suggestedMaxPct: number | null;
  targetDeltaPct: number | null;
  availableCashPct: number | null;
  maxSingleNamePct: number | null;
  portfolioRiskBudgetPct: number | null;
  dataStatus: "COMPLETE" | "FALLBACK";
};

export type TimingExecutionOrderPlan = {
  referencePrice: number | null;
  entryZoneLow: number | null;
  entryZoneHigh: number | null;
  chaseLimitPrice: number | null;
  stopPrice: number | null;
  splitPlan: string[];
  notes: string[];
};

export type TimingExecutionConstraints = {
  marketState: TimingMarketState;
  marketTransition: TimingMarketTransition;
  blockedActions: TimingAction[];
  portfolioWarnings: string[];
  riskFlags: TimingRiskFlag[];
  dataStatus: "COMPLETE" | "FALLBACK";
  missingContext: string[];
};

export type TimingExecutionPlan = {
  decision: TimingExecutionDecision;
  budget: TimingExecutionBudget;
  orderPlan: TimingExecutionOrderPlan;
  constraints: TimingExecutionConstraints;
};

export type TimingReviewRecord = {
  id: string;
  userId: string;
  analysisCardId?: string | null;
  recommendationId?: string | null;
  stockCode: string;
  stockName: string;
  sourceAsOfDate: string;
  reviewHorizon: TimingReviewHorizon;
  reviewTradingDays: number;
  scheduledAt: Date;
  completedAt?: Date | null;
  expectedAction: TimingAction;
  actualReturnPct?: number | null;
  maxFavorableExcursionPct?: number | null;
  maxAdverseExcursionPct?: number | null;
  verdict?: TimingReviewVerdict | null;
  reviewSummary?: string | null;
  createdAt: Date;
  updatedAt: Date;
  analysisCard?: TimingAnalysisCardRecord;
  recommendation?: TimingRecommendationRecord;
};

export type TimingReviewDraft = {
  userId: string;
  analysisCardId?: string;
  recommendationId?: string;
  stockCode: string;
  stockName: string;
  sourceAsOfDate: string;
  reviewHorizon: TimingReviewHorizon;
  reviewTradingDays: number;
  scheduledAt: Date;
  expectedAction: TimingAction;
};

export type TimingReviewCompletionDraft = {
  id: string;
  actualReturnPct: number;
  maxFavorableExcursionPct: number;
  maxAdverseExcursionPct: number;
  verdict: TimingReviewVerdict;
  reviewSummary: string;
  completedAt?: Date;
};

export type TimingFeedbackObservationRecord = {
  id: string;
  userId: string;
  reviewRecordId: string;
  recommendationId?: string | null;
  presetId?: string | null;
  stockCode: string;
  stockName: string;
  observedAt: Date;
  sourceAsOfDate: string;
  reviewHorizon: TimingReviewHorizon;
  expectedAction: TimingAction;
  signalContext: TimingSignalReasoningContext;
  marketContext?: TimingRecommendationReasoning["marketContext"] | null;
  positionContext?: TimingPositionContext | null;
  actualReturnPct: number;
  maxFavorableExcursionPct: number;
  maxAdverseExcursionPct: number;
  verdict: TimingReviewVerdict;
  createdAt: Date;
  updatedAt: Date;
};

export type TimingFeedbackObservationDraft = Omit<
  TimingFeedbackObservationRecord,
  "id" | "createdAt" | "updatedAt"
>;

export type TimingPresetAdjustmentPatch = {
  signalEngineWeights?: Partial<Record<TimingSignalEngineKey, number>>;
  contextWeights?: Partial<
    Record<
      "signalContext" | "marketContext" | "positionContext" | "feedbackContext",
      number
    >
  >;
  actionThresholds?: Partial<
    NonNullable<TimingPresetConfig["actionThresholds"]>
  >;
};

export type TimingPresetAdjustmentSuggestionRecord = {
  id: string;
  userId: string;
  presetId?: string | null;
  kind: TimingPresetAdjustmentSuggestionKind;
  status: TimingPresetAdjustmentSuggestionStatus;
  title: string;
  summary: string;
  patch: TimingPresetAdjustmentPatch;
  metrics: Record<string, number | string | null>;
  createdAt: Date;
  updatedAt: Date;
  appliedAt?: Date | null;
  dismissedAt?: Date | null;
};

export type TimingPresetAdjustmentSuggestionDraft = Omit<
  TimingPresetAdjustmentSuggestionRecord,
  "id" | "createdAt" | "updatedAt"
>;

export type TimingPresetRecord = {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  config: TimingPresetConfig;
  createdAt: Date;
  updatedAt: Date;
};

export type TimingPresetDraft = {
  userId: string;
  name: string;
  description?: string;
  config: TimingPresetConfig;
};

export type TimingReportEvidence = Record<
  TimingSignalEngineKey,
  TimingSignalEngineResult
>;

export type TimingReportPayload = {
  card: TimingAnalysisCardRecord;
  bars: TimingBar[];
  chartLevels: TimingChartLevels;
  evidence: TimingReportEvidence;
  marketContext: MarketContextAnalysis;
  recommendation?: TimingRecommendationRecord | null;
  executionPlan: TimingExecutionPlan;
  reviewTimeline: TimingReviewRecord[];
  kronosForecast?: TimingKronosForecast;
};

export type TimingReportSeriesPayload = {
  stockCode: string;
  stockName: string;
  timeframe: TimingTimeframe;
  adjust: string;
  bars: TimingBar[];
  chartLevels: TimingChartLevels;
  kronosForecast?: TimingKronosForecast;
  warnings: string[];
};

export type TimingMarketRegime = TimingMarketState;
export type MarketRegimeSnapshot = MarketContextSnapshot;
export type MarketRegimeAnalysis = MarketContextAnalysis;

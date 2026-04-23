export const TIMING_SOURCE_TYPES = [
  "single",
  "watchlist",
  "screening",
] as const;

export const TIMING_ACTIONS = [
  "WATCH",
  "PROBE",
  "ADD",
  "HOLD",
  "TRIM",
  "EXIT",
] as const;

export const STAGE_ONE_TIMING_ACTIONS = ["WATCH", "PROBE", "ADD"] as const;

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
export type TimingRiskFlag = (typeof TIMING_RISK_FLAGS)[number];
export type TimingMarketState = (typeof TIMING_MARKET_STATES)[number];
export type TimingMarketTransition = (typeof TIMING_MARKET_TRANSITIONS)[number];
export type TimingMarketBreadthTrend =
  (typeof TIMING_MARKET_BREADTH_TRENDS)[number];
export type TimingMarketVolatilityTrend =
  (typeof TIMING_MARKET_VOLATILITY_TRENDS)[number];
export type TimingSignalEngineKey = (typeof TIMING_SIGNAL_ENGINE_KEYS)[number];
export type TimingDirection = "bullish" | "neutral" | "bearish";
export type TimingTimeframe = "DAILY";
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

export type TimingSignalReasoningContext = {
  direction: TimingDirection;
  compositeScore: number;
  signalStrength: number;
  confidence: number;
  engineBreakdown: TimingEngineBreakdownItem[];
  triggerNotes: string[];
  invalidationNotes: string[];
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
  riskFlags: TimingRiskFlag[];
  explanation: string;
  signalContext: TimingSignalReasoningContext;
};

export type TimingCardReasoning = {
  signalContext: TimingSignalReasoningContext;
  actionRationale: string;
  indicators: TimingIndicators;
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
  indicators: TimingIndicators;
  signalContext: TimingSignalContext;
  createdAt: Date;
};

export type TimingAnalysisCardRecord = {
  id: string;
  userId: string;
  workflowRunId?: string | null;
  watchListId?: string | null;
  presetId?: string | null;
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
  createdAt: Date;
  updatedAt: Date;
  signalSnapshot?: TimingSignalSnapshotRecord;
};

export type TimingCardDraft = {
  userId: string;
  workflowRunId?: string;
  watchListId?: string;
  presetId?: string;
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
};

export type TimingRecommendationRecord = {
  id: string;
  userId: string;
  workflowRunId?: string | null;
  portfolioSnapshotId: string;
  watchListId: string;
  presetId?: string | null;
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
  reasoning: TimingRecommendationReasoning;
  createdAt: Date;
  updatedAt: Date;
};

export type TimingRecommendationDraft = {
  userId: string;
  workflowRunId?: string;
  portfolioSnapshotId: string;
  watchListId: string;
  presetId?: string;
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
  reasoning: TimingRecommendationReasoning;
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
  reviewTimeline: TimingReviewRecord[];
};

export type TimingMarketRegime = TimingMarketState;
export type MarketRegimeSnapshot = MarketContextSnapshot;
export type MarketRegimeAnalysis = MarketContextAnalysis;

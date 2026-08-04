import type { EvidenceCitation } from "~/server/domain/evidence-context/types";

export const TIMING_SOURCE_TYPES = ["single", "watchlist", "screening"] as const;
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
export const TIMING_RULE_ROLES = [
  "CORE",
  "CONFIRMATION",
  "RISK_OBSERVATION",
] as const;
export const TIMING_RESEARCH_STATES = [
  "DATA_INCOMPLETE",
  "NO_SETUP",
  "FORMING",
  "CONFIRMED",
  "INVALIDATED",
] as const;
export const TIMING_TREND_STATES = [
  "UP_TREND",
  "RANGE",
  "DOWN_TREND",
  "TRANSITION",
] as const;
export const TIMING_DIMENSION_STATUSES = [
  "POSITIVE",
  "MIXED",
  "NEGATIVE",
  "UNAVAILABLE",
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
export const TIMING_DIMENSION_KEYS = [
  "multiTimeframe",
  "momentumTrend",
  "priceVolume",
  "relativeStrength",
  "volatility",
  "liquidity",
  "modelForecast",
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
  "NEAR_STRUCTURE_CHANGE",
] as const;

export type TimingSourceType = (typeof TIMING_SOURCE_TYPES)[number];
export type TimingSetupType = (typeof TIMING_SETUP_TYPES)[number];
export type TimingHorizonTemplate = (typeof TIMING_HORIZON_TEMPLATES)[number];
export type TimingRuleRole = (typeof TIMING_RULE_ROLES)[number];
export type TimingResearchState = (typeof TIMING_RESEARCH_STATES)[number];
export type TimingTrendState = (typeof TIMING_TREND_STATES)[number];
export type TimingDimensionStatus = (typeof TIMING_DIMENSION_STATUSES)[number];
export type TimingDimensionKey = (typeof TIMING_DIMENSION_KEYS)[number];
export type TimingRiskFlag = (typeof TIMING_RISK_FLAGS)[number];
export type TimingMarketState = (typeof TIMING_MARKET_STATES)[number];
export type TimingMarketTransition = (typeof TIMING_MARKET_TRANSITIONS)[number];
export type TimingMarketBreadthTrend = (typeof TIMING_MARKET_BREADTH_TRENDS)[number];
export type TimingMarketVolatilityTrend = (typeof TIMING_MARKET_VOLATILITY_TRENDS)[number];
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
export type TimingSignalMetricValue = string | number | boolean | null;
export type TimingSignalMetrics = Record<string, TimingSignalMetricValue>;

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
  severity?: "INFO" | "WARNING" | "CRITICAL";
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
  primaryTimeframe: TimingTimeframe;
};

export type TimingResearchRuleConfig = {
  schemaVersion: 3;
  setup: TimingSetupType;
  timeframePlan: TimingTimeframePlan;
  ruleGroups: TimingRuleGroupConfig[];
  signalEngineWeights: Partial<Record<TimingSignalEngineKey, number>>;
  dataPolicy: {
    asOfMode: "LATEST_COMPLETE" | "CURRENT_PARTIAL";
    requiredMissing: "DATA_INCOMPLETE";
    unfinishedHigherTimeframe: "OBSERVATION_ONLY";
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
  rawValue?: TimingSignalMetricValue;
  normalizedValue?: TimingSignalMetricValue;
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
export type TimingBarsByTimeframe = Partial<Record<TimingTimeframe, TimingBar[]>>;

export type TimingEvidenceData = {
  stockCode: string;
  stockName: string;
  asOfDate: string;
  featureVersion: string;
  templateVersion?: number | null;
  validationSource?: "SYSTEM_TEMPLATE" | "RULE_COVERAGE_VALIDATION" | null;
  features: TimingFeatureEvidence[];
  barsByTimeframe: TimingBarsByTimeframe;
  sourceRows: Record<string, Array<Record<string, unknown>>>;
  dataManifest: TimingDataManifestItem[];
  warnings: string[];
  inputHash: string;
};
export type TimingSignalBatchError = { stockCode: string; code: string; message: string };
export type TimingEvidenceBatchData = { items: TimingEvidenceData[]; errors: TimingSignalBatchError[] };

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
  severity?: TimingRuleDefinition["severity"];
  explanation: string;
};

export type TimingRuleAudit = {
  schemaVersion: 3;
  strategyRevisionId?: string;
  configHash?: string;
  engineVersion: string;
  featureVersion: string;
  setup: TimingSetupType;
  researchState: TimingResearchState;
  ruleEvaluations: TimingRuleEvaluation[];
  groupResults: Array<{
    role: TimingRuleRole;
    passed: number;
    required: number;
    minSatisfied: number;
    satisfied: boolean;
    missing: number;
  }>;
};

export type TimingMacd = { dif: number; dea: number; histogram: number };
export type TimingRsi = { value: number };
export type TimingBollinger = { upper: number; middle: number; lower: number; closePosition: number };
export type TimingObv = { value: number; slope: number };
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
export type TimingSignalContext = { engines: TimingSignalEngineResult[]; composite: TimingSignalComposite };
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
export type TimingSignalBatchData = { items: TimingSignalData[]; errors: TimingSignalBatchError[] };
export type TimingBarsData = { stockCode: string; stockName: string; timeframe: TimingTimeframe; adjust: string; bars: TimingBar[] };

export type TimingEngineBreakdownItem = {
  key: TimingSignalEngineKey;
  label: string;
  status: "positive" | "neutral" | "negative";
  score: number;
  confidence: number;
  weight: number;
  detail: string;
};

export type TimingObservationCondition = {
  id: string;
  kind: "CONFIRMATION" | "CHANGE" | "RISK";
  category: "TREND" | "MOMENTUM" | "PRICE_VOLUME" | "RELATIVE_STRENGTH" | "VOLATILITY" | "LIQUIDITY";
  label: string;
  metric: string;
  operator: TimingRuleOperator;
  threshold: number | string;
  actual?: number | string | null;
  status: "MET" | "NEAR" | "PENDING";
  severity: "INFO" | "WARNING" | "CRITICAL";
  explanation: string;
};

export type TimingResearchDimension = {
  key: TimingDimensionKey;
  label: string;
  status: TimingDimensionStatus;
  score: number | null;
  evidence: string[];
  limitations: string[];
  dataAsOf: string | null;
};

export type TechnicalAssessment = {
  stockCode: string;
  stockName: string;
  asOfDate: string;
  researchState: TimingResearchState;
  trendState: TimingTrendState;
  compositeScore: number;
  confidence: number;
  dimensions: TimingResearchDimension[];
  observationConditions: TimingObservationCondition[];
  riskFlags: TimingRiskFlag[];
  summary: string;
  explanation: string;
  engineBreakdown: TimingEngineBreakdownItem[];
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

export type TimingModelEvidenceStatus =
  | "AVAILABLE"
  | "INSUFFICIENT_HISTORY"
  | "MODEL_DISABLED"
  | "SERVICE_UNAVAILABLE"
  | "PREDICTION_FAILED";

export type TimingModelEvidence = {
  status: TimingModelEvidenceStatus;
  inputBars: number;
  requestedTimeframes: TimingTimeframe[];
  availableTimeframes: TimingTimeframe[];
  message: string;
  retryable: boolean;
  alignment: "CONFIRMING" | "CONFLICTING" | "NEUTRAL" | "UNAVAILABLE";
  timeframeConsistency: "CONSISTENT" | "DIVERGENT" | "SINGLE_TIMEFRAME" | "UNAVAILABLE";
  confidenceAdjustment: number;
  timeframeResults: Partial<Record<TimingTimeframe, {
    status: TimingModelEvidenceStatus;
    inputBars: number;
    message: string;
    retryable: boolean;
  }>>;
};

export type TimingFrozenForecast = {
  snapshotId: string;
  forecast: TimingKronosForecast;
};

export type TimingForecastSet = Partial<Record<TimingTimeframe, TimingFrozenForecast>>;

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

export type TimingResearchReasoning = {
  indicators: TimingIndicators;
  engineBreakdown: TimingEngineBreakdownItem[];
  dataManifest: TimingDataManifestItem[];
  featureEvidence: TimingFeatureEvidence[];
  inputHash: string;
  evidenceCitations?: EvidenceCitation[];
};
export type TimingDataCompleteness = {
  status: "COMPLETE" | "PARTIAL" | "INSUFFICIENT";
  available: number;
  total: number;
  missing: string[];
  warnings: string[];
};
export type TimingResearchReportRecord = {
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
  researchState: TimingResearchState;
  trendState: TimingTrendState;
  confidence: number;
  marketState?: TimingMarketState | null;
  marketTransition?: TimingMarketTransition | null;
  summary: string;
  dimensions: TimingResearchDimension[];
  observationConditions: TimingObservationCondition[];
  dataCompleteness: TimingDataCompleteness;
  modelOutlook?: TimingKronosForecast | null;
  modelEvidence: TimingModelEvidence;
  forecastSnapshots?: TimingFrozenForecast[];
  riskFlags: TimingRiskFlag[];
  reasoning: TimingResearchReasoning;
  ruleAudit: TimingRuleAudit;
  createdAt: Date;
  updatedAt: Date;
  signalSnapshot?: TimingSignalSnapshotRecord;
};
export type TimingResearchReportDraft = Omit<
  TimingResearchReportRecord,
  "id" | "createdAt" | "updatedAt" | "signalSnapshot" | "forecastSnapshots"
> & { forecastSnapshotIds?: Partial<Record<TimingTimeframe, string>> };

export type PortfolioCompositionPosition = {
  stockCode: string;
  stockName: string;
  weightPct: number;
  sector?: string;
  themes: string[];
};
export type PortfolioCompositionRecord = {
  id: string;
  userId: string;
  name: string;
  positions: PortfolioCompositionPosition[];
  source: "SAVED" | "RUN_INPUT";
  workflowRunId?: string | null;
  createdAt: Date;
  updatedAt: Date;
};
export type PortfolioCompositionDraft = Omit<PortfolioCompositionRecord, "id" | "createdAt" | "updatedAt">;

export type PortfolioRiskDiagnostic = {
  concentration: {
    top1Pct: number;
    top3Pct: number;
    top5Pct: number;
    hhi: number;
    effectiveHoldings: number;
  };
  exposures: {
    sectors: Array<{ name: string; weightPct: number }>;
    themes: Array<{ name: string; weightPct: number }>;
  };
  correlation: {
    stockCodes: string[];
    matrix: Array<Array<number | null>>;
    clusters: Array<{ stockCodes: string[]; averageCorrelation: number }>;
    lookbackDays: 60;
  };
  volatility: {
    annualizedPct: number | null;
    contributions: Array<{ stockCode: string; contributionPct: number | null }>;
    lookbackDays: 60;
  };
  liquidity: {
    buckets: Array<{ level: "HIGH" | "MEDIUM" | "LOW" | "UNAVAILABLE"; weightPct: number }>;
    items: Array<{ stockCode: string; averageAmount20: number | null; turnoverRate20: number | null; level: "HIGH" | "MEDIUM" | "LOW" | "UNAVAILABLE" }>;
  };
  scenarios: Array<{
    id: "MARKET_DOWN_5" | "LARGEST_SECTOR_DOWN_8" | "TOP_HOLDING_DOWN_10" | "VOLATILITY_UP_50" | "LIQUIDITY_DOWN_50";
    name: string;
    estimatedImpactPct: number | null;
    detail: string;
    disclaimer: "压力假设，不代表发生概率或投资建议。";
  }>;
  dataQuality: {
    asOfDate: string;
    completeStocks: number;
    totalStocks: number;
    warnings: string[];
  };
};
export type PortfolioRiskDiagnosticRecord = PortfolioRiskDiagnostic & {
  id: string;
  userId: string;
  workflowRunId?: string | null;
  portfolioCompositionId: string;
  asOfDate: string;
  createdAt: Date;
};

export type TimingChartLinePoint = { tradeDate: string; value: number };
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
export type MarketContextSnapshot = {
  asOfDate: string;
  indexes: MarketIndexSnapshot[];
  latestBreadth: MarketBreadthPoint;
  latestVolatility: MarketVolatilityPoint;
  latestLeadership: MarketLeadershipPoint;
  breadthSeries: MarketBreadthPoint[];
  volatilitySeries: MarketVolatilityPoint[];
  leadershipSeries: MarketLeadershipPoint[];
  features: { benchmarkStrength: number; breadthScore: number; riskScore: number; stateScore: number; northboundFlowScore?: number | null; activityScore?: number | null };
  source?: string;
  availability?: { daily: boolean; dailyBasic: boolean; indexDaily: boolean; stockLimit?: boolean; indexDailyBasic?: boolean; hsgtFlow?: boolean; warnings?: string[] };
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
  leadership: { leaderCode: string; leaderName: string; switched: boolean; previousLeaderCode?: string | null };
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

export type TimingPresetRevisionStatus = "DRAFT" | "VALIDATING" | "PUBLISHED" | "ARCHIVED";
export type TimingPresetRevisionRecord = {
  id: string;
  presetId: string;
  userId: string;
  revisionNumber: number;
  status: TimingPresetRevisionStatus;
  config: TimingResearchRuleConfig;
  configHash: string;
  engineVersion: string;
  featureVersion: string;
  templateVersion?: number | null;
  validationSource?: "SYSTEM_TEMPLATE" | "RULE_COVERAGE_VALIDATION" | null;
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
export type TimingRuleValidationMetrics = {
  stockCount: number;
  requiredEvidenceCount: number;
  availableEvidenceCount: number;
  coveragePct: number;
  noLookaheadPassed: boolean;
  gatePassed: boolean;
  failures: string[];
};

export type TimingReportEvidence = Partial<Record<TimingSignalEngineKey, TimingSignalEngineResult>>;
export type TimingReportPayload = {
  report: TimingResearchReportRecord;
  bars: TimingBar[];
  chartLevels: TimingChartLevels;
  evidence: TimingReportEvidence;
  marketContext: MarketContextAnalysis;
  modelOutlook?: TimingKronosForecast;
};
export type TimingReportSeriesPayload = {
  stockCode: string;
  stockName: string;
  timeframe: TimingTimeframe;
  adjust: string;
  bars: TimingBar[];
  chartLevels: TimingChartLevels;
  modelOutlook?: TimingKronosForecast;
  warnings: string[];
};

export type TimingMarketRegime = TimingMarketState;
export type MarketRegimeSnapshot = MarketContextSnapshot;
export type MarketRegimeAnalysis = MarketContextAnalysis;

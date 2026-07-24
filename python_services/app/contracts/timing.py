"""Standardized timing contracts for daily bars, signal context, and market context."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.contracts.common import BatchItemError
from app.contracts.meta import GatewayResponse

TimingDirection = Literal["bullish", "neutral", "bearish"]
TimingTimeframe = Literal[
    "DAILY",
    "WEEKLY",
    "MONTHLY",
    "MINUTE_60",
    "MINUTE_30",
    "MINUTE_15",
    "MINUTE_1",
]
SignalEngineKey = Literal[
    "multiTimeframeAlignment",
    "relativeStrength",
    "volatilityPercentile",
    "liquidityStructure",
    "breakoutFailure",
    "gapVolumeQuality",
]
TimingMarketState = Literal["RISK_ON", "NEUTRAL", "RISK_OFF"]
TimingMarketTransition = Literal[
    "IMPROVING",
    "STABLE",
    "DETERIORATING",
    "PIVOT_UP",
    "PIVOT_DOWN",
]


class TimingBar(BaseModel):
    tradeDate: str
    open: float
    high: float
    low: float
    close: float
    volume: float
    amount: float | None = None
    turnoverRate: float | None = None


class TimingBarsData(BaseModel):
    stockCode: str
    stockName: str
    timeframe: str
    adjust: str
    bars: list[TimingBar] = Field(default_factory=list)


class TimingMacd(BaseModel):
    dif: float
    dea: float
    histogram: float


class TimingRsi(BaseModel):
    value: float


class TimingBollinger(BaseModel):
    upper: float
    middle: float
    lower: float
    closePosition: float = Field(..., ge=0, le=1)


class TimingObv(BaseModel):
    value: float
    slope: float


class TimingIndicators(BaseModel):
    close: float
    macd: TimingMacd
    rsi: TimingRsi
    bollinger: TimingBollinger
    obv: TimingObv
    ema5: float
    ema20: float
    ema60: float
    ema120: float
    atr14: float
    volumeRatio20: float
    realizedVol20: float
    realizedVol120: float
    amount: float | None = None
    turnoverRate: float | None = None


class TimingSignalEngineResult(BaseModel):
    key: SignalEngineKey
    label: str
    direction: TimingDirection
    score: float = Field(..., ge=-100, le=100)
    confidence: float = Field(..., ge=0, le=1)
    weight: float = Field(..., ge=0, le=1)
    detail: str
    metrics: dict[str, str | float | bool | None] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class TimingSignalComposite(BaseModel):
    score: float = Field(..., ge=-100, le=100)
    confidence: float = Field(..., ge=0, le=1)
    direction: TimingDirection
    signalStrength: float = Field(..., ge=0, le=100)
    participatingEngines: int = Field(..., ge=0)


class TimingSignalContext(BaseModel):
    engines: list[TimingSignalEngineResult] = Field(default_factory=list)
    composite: TimingSignalComposite


class TimingSignalData(BaseModel):
    stockCode: str
    stockName: str
    asOfDate: str
    barsCount: int = Field(..., ge=1)
    bars: list[TimingBar] | None = None
    barsByTimeframe: dict[TimingTimeframe, list[TimingBar]] | None = None
    indicators: TimingIndicators
    signalContext: TimingSignalContext


class TimingSignalBatchData(BaseModel):
    items: list[TimingSignalData] = Field(default_factory=list)
    errors: list[BatchItemError] = Field(default_factory=list)


class TimingSignalBatchRequest(BaseModel):
    stockCodes: list[str] = Field(..., min_length=1, max_length=100)
    asOfDate: str | None = None
    lookbackDays: int | None = Field(default=None, ge=120, le=365)
    includeBars: bool = False


TimingEvidenceStatus = Literal[
    "AVAILABLE",
    "MISSING",
    "STALE",
    "OBSERVATION_ONLY",
]


class TimingFeatureEvidence(BaseModel):
    indicatorId: str
    timeframe: TimingTimeframe
    value: float | str | bool | None
    previousValue: float | str | bool | None = None
    consecutiveBars: int | None = Field(default=None, ge=0)
    asOfDate: str
    source: str
    status: TimingEvidenceStatus
    rawValue: float | str | bool | None = None
    normalizedValue: float | str | bool | None = None
    inputValues: dict[str, Any] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class TimingDataManifestItem(BaseModel):
    dataset: str
    source: str
    timeframe: TimingTimeframe | None = None
    dataDate: str | None = None
    fetchedAt: str
    completeness: Literal["COMPLETE", "PARTIAL", "MISSING", "OBSERVATION_ONLY"]
    degradationReason: str | None = None
    contentHash: str
    rowCount: int = Field(..., ge=0)


class TimingEvidenceData(BaseModel):
    stockCode: str
    stockName: str
    asOfDate: str
    featureVersion: str
    features: list[TimingFeatureEvidence] = Field(default_factory=list)
    barsByTimeframe: dict[TimingTimeframe, list[TimingBar]] = Field(default_factory=dict)
    sourceRows: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)
    dataManifest: list[TimingDataManifestItem] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    inputHash: str


class TimingEvidenceBatchData(BaseModel):
    items: list[TimingEvidenceData] = Field(default_factory=list)
    errors: list[BatchItemError] = Field(default_factory=list)


class TimingEvidenceBatchRequest(BaseModel):
    stockCodes: list[str] = Field(..., min_length=1, max_length=100)
    asOfDate: str | None = None
    timeframes: list[TimingTimeframe] = Field(
        default_factory=lambda: ["MONTHLY", "WEEKLY", "DAILY", "MINUTE_60"]
    )
    indicatorIds: list[str] = Field(default_factory=list, max_length=100)
    lookbackDays: int = Field(default=365, ge=120, le=900)


class MarketIndexSnapshot(BaseModel):
    code: str
    name: str
    close: float
    changePct: float
    return5d: float
    return10d: float
    ema20: float
    ema60: float
    aboveEma20: bool
    aboveEma60: bool
    atrRatio: float
    signalDirection: TimingDirection


class MarketBreadthPoint(BaseModel):
    asOfDate: str
    totalCount: int = Field(..., ge=0)
    advancingCount: int = Field(..., ge=0)
    decliningCount: int = Field(..., ge=0)
    flatCount: int = Field(..., ge=0)
    positiveRatio: float = Field(..., ge=0, le=1)
    aboveThreePctRatio: float = Field(..., ge=0, le=1)
    belowThreePctRatio: float = Field(..., ge=0, le=1)
    medianChangePct: float
    averageTurnoverRate: float | None = None


class MarketVolatilityPoint(BaseModel):
    asOfDate: str
    highVolatilityCount: int = Field(..., ge=0)
    highVolatilityRatio: float = Field(..., ge=0, le=1)
    limitDownLikeCount: int = Field(..., ge=0)
    indexAtrRatio: float = Field(..., ge=0)


class MarketLeadershipPoint(BaseModel):
    asOfDate: str
    leaderCode: str
    leaderName: str
    ranking5d: list[str] = Field(default_factory=list)
    ranking10d: list[str] = Field(default_factory=list)
    switched: bool
    previousLeaderCode: str | None = None


class MarketContextFeatureSnapshot(BaseModel):
    benchmarkStrength: float = Field(..., ge=0, le=100)
    breadthScore: float = Field(..., ge=0, le=100)
    riskScore: float = Field(..., ge=0, le=100)
    stateScore: float = Field(..., ge=0, le=100)
    northboundFlowScore: float | None = None
    activityScore: float | None = None


class TimingMarketContextAvailability(BaseModel):
    daily: bool
    dailyBasic: bool
    indexDaily: bool
    stockLimit: bool = False
    indexDailyBasic: bool = False
    hsgtFlow: bool = False
    warnings: list[str] = Field(default_factory=list)


class MarketContextSnapshotData(BaseModel):
    asOfDate: str
    indexes: list[MarketIndexSnapshot] = Field(default_factory=list)
    latestBreadth: MarketBreadthPoint
    latestVolatility: MarketVolatilityPoint
    latestLeadership: MarketLeadershipPoint
    breadthSeries: list[MarketBreadthPoint] = Field(default_factory=list)
    volatilitySeries: list[MarketVolatilityPoint] = Field(default_factory=list)
    leadershipSeries: list[MarketLeadershipPoint] = Field(default_factory=list)
    features: MarketContextFeatureSnapshot
    source: str | None = None
    availability: TimingMarketContextAvailability | None = None


class TimingBarsResponse(GatewayResponse[TimingBarsData]):
    pass


class TimingSignalResponse(GatewayResponse[TimingSignalData]):
    pass


class TimingSignalBatchResponse(GatewayResponse[TimingSignalBatchData]):
    pass


class TimingEvidenceBatchResponse(GatewayResponse[TimingEvidenceBatchData]):
    pass


class MarketContextSnapshotResponse(GatewayResponse[MarketContextSnapshotData]):
    pass

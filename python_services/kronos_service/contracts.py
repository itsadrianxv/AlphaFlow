from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


Direction = Literal["bullish", "neutral", "bearish"]
KronosTimeframe = Literal[
    "DAILY",
    "WEEKLY",
    "MONTHLY",
    "MINUTE_60",
    "MINUTE_30",
    "MINUTE_15",
    "MINUTE_1",
]


class KronosBar(BaseModel):
    tradeDate: str
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None
    amount: float | None = None


class KronosForecastSummary(BaseModel):
    expectedReturnPct: float
    maxDrawdownPct: float
    upsidePct: float
    volatilityProxy: float = Field(..., ge=0)
    direction: Direction
    confidence: float = Field(..., ge=0, le=1)


class KronosForecastPoint(BaseModel):
    tradeDate: str
    open: float
    high: float
    low: float
    close: float
    volume: float | None = None
    amount: float | None = None


class KronosForecastRequest(BaseModel):
    stockCode: str
    timeframe: KronosTimeframe = "DAILY"
    bars: list[KronosBar] = Field(..., min_length=1)
    predictionLength: int | None = Field(default=None, ge=1, le=240)


class KronosForecastBatchItem(BaseModel):
    stockCode: str
    timeframe: KronosTimeframe = "DAILY"
    bars: list[KronosBar] = Field(..., min_length=1)


class KronosForecastBatchRequest(BaseModel):
    items: list[KronosForecastBatchItem] = Field(..., min_length=1, max_length=100)
    predictionLength: int | None = Field(default=None, ge=1, le=240)

    @field_validator("items")
    @classmethod
    def validate_uniform_lookback(cls, value: list[KronosForecastBatchItem]):
        lengths = {len(item.bars) for item in value}
        if len(lengths) > 1:
            raise ValueError("batch forecast requires a uniform lookback length")
        return value


class KronosForecastResponse(BaseModel):
    stockCode: str
    timeframe: KronosTimeframe = "DAILY"
    asOfDate: str
    modelName: str
    modelVersion: str
    lookbackDays: int
    lookbackBars: int | None = None
    predictionLength: int
    device: str
    points: list[KronosForecastPoint]
    summary: KronosForecastSummary
    warnings: list[str] = Field(default_factory=list)


class KronosBatchItemError(BaseModel):
    stockCode: str
    timeframe: KronosTimeframe = "DAILY"
    code: str
    message: str


class KronosForecastBatchResponse(BaseModel):
    items: list[KronosForecastResponse] = Field(default_factory=list)
    errors: list[KronosBatchItemError] = Field(default_factory=list)


class KronosHealthResponse(BaseModel):
    status: str
    modelLoaded: bool
    modelName: str
    tokenizerName: str
    modelVersion: str
    device: str
    maxContext: int
    defaultPredictionLength: int


class KronosErrorBody(BaseModel):
    code: str
    message: str
    stockCode: str | None = None


class KronosErrorResponse(BaseModel):
    error: KronosErrorBody

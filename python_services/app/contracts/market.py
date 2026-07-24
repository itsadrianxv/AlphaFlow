"""Standardized market data contracts."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.contracts.common import BatchItemError
from app.contracts.meta import GatewayResponse


class MarketStock(BaseModel):
    stockCode: str
    exchange: str
    market: str
    securityType: str
    stockName: str
    industry: str
    sector: str | None = None
    concepts: list[str] = Field(default_factory=list)
    marketCap: float | None = None
    floatMarketCap: float | None = None
    turnoverRate: float | None = None
    changePercent: float | None = None
    pe: float | None = None
    pb: float | None = None
    roe: float | None = None
    eps: float | None = None
    revenue: float | None = None
    netProfit: float | None = None
    debtRatio: float | None = None
    asOf: str
    provider: str


class ThemeCandidate(BaseModel):
    stockCode: str
    stockName: str
    concept: str
    reason: str
    heat: float = Field(..., ge=0, le=100)
    limitType: str | None = None
    limitTag: str | None = None
    limitStatus: str | None = None
    limitReason: str | None = None
    limitOrder: float | None = None
    limitAmount: float | None = None
    turnoverRate: float | None = None
    boardRank: int | None = None


class IndicatorHistoryPoint(BaseModel):
    date: str
    value: float | None = None
    isEstimated: bool = False


class StockCodesData(BaseModel):
    codes: list[str]
    total: int


class IndustriesData(BaseModel):
    industries: list[str]
    total: int


class IndicatorHistoryData(BaseModel):
    stockCode: str
    indicator: str
    years: int
    points: list[IndicatorHistoryPoint]


class MarketStockBatchData(BaseModel):
    items: list[MarketStock]
    errors: list[BatchItemError] = Field(default_factory=list)


class ThemeCandidatesData(BaseModel):
    theme: str
    candidates: list[ThemeCandidate]


class MarketStockResponse(GatewayResponse[MarketStock]):
    pass


class MarketStockBatchResponse(GatewayResponse[MarketStockBatchData]):
    pass


class ThemeCandidatesResponse(GatewayResponse[ThemeCandidatesData]):
    pass


class StockCodesResponse(GatewayResponse[StockCodesData]):
    pass


class IndustriesResponse(GatewayResponse[IndustriesData]):
    pass


class IndicatorHistoryResponse(GatewayResponse[IndicatorHistoryData]):
    pass

"""Contracts for external capability gateway routes."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CapabilityMeta(BaseModel):
    traceId: str
    provider: str
    capability: str
    operation: str
    retryable: bool = False
    failurePhase: str | None = None
    diagnostics: dict[str, Any] = Field(default_factory=dict)
    elapsedMs: int = Field(default=0, ge=0)


class CapabilityResponse(BaseModel):
    meta: CapabilityMeta
    data: Any


class CapabilityErrorBody(BaseModel):
    traceId: str
    provider: str
    capability: str
    operation: str
    code: str
    message: str
    retryable: bool = False
    failurePhase: str
    diagnostics: dict[str, Any] = Field(default_factory=dict)


class CapabilityErrorResponse(BaseModel):
    error: CapabilityErrorBody


class ScreeningQueryCapabilityRequest(BaseModel):
    stockCodes: list[str] = Field(..., min_length=1, max_length=20)
    indicators: list[dict[str, Any]] = Field(default_factory=list)
    formulas: list[dict[str, Any]] = Field(default_factory=list)
    timeConfig: dict[str, str]


class WebSearchCapabilityRequest(BaseModel):
    queries: list[str] = Field(..., min_length=1, max_length=8)
    limit: int = Field(default=5, ge=1, le=10)


class WebFetchCapabilityRequest(BaseModel):
    url: str = Field(..., min_length=1)


class ConceptMatchCapabilityRequest(BaseModel):
    theme: str = Field(..., min_length=1)
    limit: int = Field(default=5, ge=1, le=20)


class StockSearchCapabilityRequest(BaseModel):
    keyword: str = Field(..., min_length=1)
    limit: int = Field(default=10, ge=1, le=100)
    listStatus: str = Field(default="L")
    exchange: str | None = None


class StockProfileCapabilityRequest(BaseModel):
    stockCode: str = Field(..., min_length=1)
    includeCompany: bool = True


class StockBarsCapabilityRequest(BaseModel):
    stockCode: str = Field(..., min_length=1)
    startDate: str | None = None
    endDate: str | None = None
    freq: str = Field(default="daily")
    adjust: str = Field(default="qfq")


class StockDailyBasicCapabilityRequest(BaseModel):
    stockCode: str | None = None
    tradeDate: str | None = None
    startDate: str | None = None
    endDate: str | None = None


class IndexMarketCapabilityRequest(BaseModel):
    indexCode: str = Field(..., min_length=1)
    startDate: str | None = None
    endDate: str | None = None
    includeBasic: bool = True
    includeValuation: bool = True


class IndexConstituentsCapabilityRequest(BaseModel):
    indexCode: str = Field(..., min_length=1)
    tradeDate: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    includeNames: bool = True


class MoneyflowCapabilityRequest(BaseModel):
    stockCode: str | None = None
    tradeDate: str | None = None
    startDate: str | None = None
    endDate: str | None = None
    include: list[str] = Field(default_factory=lambda: ["moneyflow"])


class MarketEventsCapabilityRequest(BaseModel):
    tradeDate: str = Field(..., min_length=8)
    stockCode: str | None = None
    include: list[str] = Field(default_factory=lambda: ["topList", "topInst", "blockTrade", "limit"])


class ShareholderEventsCapabilityRequest(BaseModel):
    stockCode: str = Field(..., min_length=1)
    startDate: str | None = None
    endDate: str | None = None
    include: list[str] = Field(
        default_factory=lambda: ["holderNumber", "holderTrade", "pledge", "shareFloat", "repurchase"]
    )


class FinancialStatementsCapabilityRequest(BaseModel):
    stockCode: str = Field(..., min_length=1)
    startDate: str | None = None
    endDate: str | None = None
    period: str | None = None
    statement: str = Field(default="all")
    reportType: str = Field(default="1")


class FinancialIndicatorsCapabilityRequest(BaseModel):
    stockCode: str = Field(..., min_length=1)
    startDate: str | None = None
    endDate: str | None = None
    period: str | None = None
    include: list[str] = Field(default_factory=lambda: ["indicator", "mainBusiness", "audit"])


class EarningsEventsCapabilityRequest(BaseModel):
    stockCode: str = Field(..., min_length=1)
    startDate: str | None = None
    endDate: str | None = None
    include: list[str] = Field(default_factory=lambda: ["forecast", "express", "disclosureDate", "dividend"])


class FundMarketCapabilityRequest(BaseModel):
    fundCode: str = Field(..., min_length=1)
    startDate: str | None = None
    endDate: str | None = None
    include: list[str] = Field(default_factory=lambda: ["basic", "nav"])


class ConvertibleBondMarketCapabilityRequest(BaseModel):
    bondCode: str = Field(..., min_length=1)
    startDate: str | None = None
    endDate: str | None = None
    include: list[str] = Field(default_factory=lambda: ["basic", "issue", "daily"])


class MacroRatesCapabilityRequest(BaseModel):
    startDate: str | None = None
    endDate: str | None = None
    include: list[str] = Field(default_factory=lambda: ["shibor", "lpr", "libor", "hibor"])

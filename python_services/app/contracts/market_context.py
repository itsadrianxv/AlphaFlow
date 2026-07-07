"""Market context snapshot contracts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.contracts.intelligence import ConceptMatchItem, ThemeNewsItem
from app.contracts.market import ThemeCandidate
from app.contracts.meta import GatewayResponse


class MarketContextAvailabilityEntry(BaseModel):
    available: bool
    warning: str | None = None


class MarketContextAvailability(BaseModel):
    regime: MarketContextAvailabilityEntry
    flow: MarketContextAvailabilityEntry
    hotThemes: MarketContextAvailabilityEntry


class MarketRegimeSummary(BaseModel):
    overallTone: Literal["risk_on", "neutral", "risk_off", "unknown"]
    growthTone: Literal["expansion", "neutral", "contraction", "unknown"]
    liquidityTone: Literal["supportive", "neutral", "tightening", "unknown"]
    riskTone: Literal["risk_on", "neutral", "risk_off", "unknown"]
    summary: str
    drivers: list[str] = Field(default_factory=list)


class MarketFlowSummary(BaseModel):
    northboundNetAmount: float | None = None
    direction: Literal["inflow", "outflow", "flat", "unknown"]
    summary: str


class SectionHint(BaseModel):
    summary: str = Field(..., min_length=1)
    suggestedQuestion: str | None = None
    suggestedDraftName: str | None = None


class MarketContextDownstreamHints(BaseModel):
    workflows: SectionHint
    companyResearch: SectionHint
    screening: SectionHint
    timing: SectionHint


class HotThemeContext(BaseModel):
    theme: str
    heatScore: float = Field(..., ge=0, le=100)
    whyHot: str
    conceptMatches: list[ConceptMatchItem] = Field(default_factory=list)
    candidateStocks: list[ThemeCandidate] = Field(default_factory=list)
    topNews: list[ThemeNewsItem] = Field(default_factory=list)


class MarketContextSnapshot(BaseModel):
    asOf: str
    status: Literal["complete", "partial", "unavailable"]
    regime: MarketRegimeSummary
    flow: MarketFlowSummary
    hotThemes: list[HotThemeContext] = Field(default_factory=list)
    downstreamHints: MarketContextDownstreamHints
    availability: MarketContextAvailability


class MarketContextSnapshotResponse(GatewayResponse[MarketContextSnapshot]):
    pass

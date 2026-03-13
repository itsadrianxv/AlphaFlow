"""Standardized intelligence data contracts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.contracts.common import BatchItemError
from app.contracts.meta import GatewayResponse


class ThemeNewsItem(BaseModel):
    id: str
    title: str
    summary: str
    source: str
    publishedAt: str
    sentiment: str
    relevanceScore: float
    relatedStocks: list[str] = Field(default_factory=list)


class ThemeNewsData(BaseModel):
    theme: str
    newsItems: list[ThemeNewsItem]


class ConceptMatchItem(BaseModel):
    name: str
    code: str | None = None
    aliases: list[str] = Field(default_factory=list)
    confidence: float = Field(..., ge=0, le=1)
    reason: str
    source: str


class ThemeConceptsData(BaseModel):
    theme: str
    matchedBy: Literal["whitelist", "zhipu", "auto"]
    conceptMatches: list[ConceptMatchItem]


class CompanyEvidence(BaseModel):
    stockCode: str
    companyName: str
    concept: str
    evidenceSummary: str
    catalysts: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    credibilityScore: int = Field(..., ge=0, le=100)
    updatedAt: str


class StockEvidenceData(BaseModel):
    stockCode: str
    concept: str
    evidence: CompanyEvidence


class StockEvidenceBatchRequest(BaseModel):
    stockCodes: list[str] = Field(..., min_length=1, max_length=100)
    concept: str


class StockEvidenceBatchData(BaseModel):
    items: list[CompanyEvidence] = Field(default_factory=list)
    errors: list[BatchItemError] = Field(default_factory=list)


class CompanyResearchPackReferenceItem(BaseModel):
    id: str
    title: str
    sourceName: str
    snippet: str
    extractedFact: str
    url: str | None = None
    publishedAt: str | None = None
    credibilityScore: float | None = Field(default=None, ge=0, le=1)
    sourceType: str


class CompanyResearchPack(BaseModel):
    stockCode: str
    companyName: str
    concept: str
    financialHighlights: list[str] = Field(default_factory=list)
    referenceItems: list[CompanyResearchPackReferenceItem] = Field(
        default_factory=list
    )
    summaryNotes: list[str] = Field(default_factory=list)


class StockResearchPackData(BaseModel):
    stockCode: str
    concept: str
    researchPack: CompanyResearchPack


class ConfidenceReferenceItem(BaseModel):
    id: str
    title: str
    sourceName: str
    excerpt: str
    url: str | None = None
    publishedAt: str | None = None
    sourceType: str | None = None
    credibilityScore: float | None = Field(default=None, ge=0, le=1)


class ConfidenceClaimAnalysis(BaseModel):
    claimId: str
    claimText: str
    triplet: tuple[str, str, str] | None = None
    attributedSentenceIds: list[str] = Field(default_factory=list)
    matchedReferenceIds: list[str] = Field(default_factory=list)
    label: Literal["supported", "insufficient", "contradicted", "abstain"]
    explanation: str


class ConfidenceAnalysis(BaseModel):
    status: Literal["COMPLETE", "PARTIAL", "UNAVAILABLE"]
    finalScore: int | None = Field(default=None, ge=0, le=100)
    level: Literal["high", "medium", "low", "unknown"]
    claimCount: int = Field(ge=0)
    supportedCount: int = Field(ge=0)
    insufficientCount: int = Field(ge=0)
    contradictedCount: int = Field(ge=0)
    abstainCount: int = Field(ge=0)
    supportRate: float = Field(ge=0, le=1)
    insufficientRate: float = Field(ge=0, le=1)
    contradictionRate: float = Field(ge=0, le=1)
    abstainRate: float = Field(ge=0, le=1)
    evidenceCoverageScore: int = Field(ge=0, le=100)
    freshnessScore: int = Field(ge=0, le=100)
    sourceDiversityScore: int = Field(ge=0, le=100)
    notes: list[str] = Field(default_factory=list)
    claims: list[ConfidenceClaimAnalysis] = Field(default_factory=list)


class ConfidenceCheckRequest(BaseModel):
    module: Literal["screening_insight", "company_research", "quick_research"]
    question: str | None = None
    responseText: str = Field(..., min_length=1)
    referenceItems: list[ConfidenceReferenceItem] = Field(default_factory=list)


class ConfidenceCheckBatchRequest(BaseModel):
    items: list[ConfidenceCheckRequest] = Field(default_factory=list)


class ConfidenceCheckBatchResponse(BaseModel):
    items: list[ConfidenceAnalysis] = Field(default_factory=list)


class ThemeNewsResponse(GatewayResponse[ThemeNewsData]):
    pass


class ThemeConceptsResponse(GatewayResponse[ThemeConceptsData]):
    pass


class StockEvidenceResponse(GatewayResponse[StockEvidenceData]):
    pass


class StockEvidenceBatchResponse(GatewayResponse[StockEvidenceBatchData]):
    pass


class StockResearchPackResponse(GatewayResponse[StockResearchPackData]):
    pass

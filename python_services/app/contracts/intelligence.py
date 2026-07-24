"""Standardized intelligence data contracts."""

from __future__ import annotations

from datetime import datetime
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
    scopeTags: list[Literal["macro", "theme", "industry", "company"]] = Field(default_factory=list)
    eventType: str = "其他"
    matchReason: str = ""
    content: str = ""
    url: str | None = None
    sourceKind: Literal["fast", "major", "cctv"] = "fast"
    sourceRefs: list[dict] = Field(default_factory=list)
    attributions: list[dict] = Field(default_factory=list)
    analysisStatus: Literal["complete", "partial"] = "complete"
    warnings: list[str] = Field(default_factory=list)


class ThemeNewsData(BaseModel):
    theme: str
    newsItems: list[ThemeNewsItem]


class ScopedNewsData(BaseModel):
    scope: Literal["macro", "industry", "company"]
    target: str
    newsItems: list[ThemeNewsItem]


class NewsRadarCompanyInput(BaseModel):
    stockCode: str = Field(..., pattern=r"^\d{6}$")
    companyName: str = ""
    aliases: list[str] = Field(default_factory=list, max_length=20)


class NewsRadarIndustryInput(BaseModel):
    name: str = Field(..., min_length=1)
    aliases: list[str] = Field(default_factory=list, max_length=20)


class NewsRadarRequest(BaseModel):
    days: int = Field(default=7, ge=1, le=30)
    limit: int = Field(default=50, ge=1, le=50)
    endAt: datetime | None = None
    companies: list[NewsRadarCompanyInput] = Field(default_factory=list, max_length=100)
    industries: list[NewsRadarIndustryInput] = Field(default_factory=list, max_length=20)
    includeMacro: bool = True


class NewsRadarData(BaseModel):
    days: int
    companyCount: int
    industryCount: int
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
    dataQuality: Literal["complete", "partial"] = "complete"
    warnings: list[str] = Field(default_factory=list)
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
    dataQuality: Literal["complete", "partial"] = "complete"
    warnings: list[str] = Field(default_factory=list)


class StockResearchPackData(BaseModel):
    stockCode: str
    concept: str
    researchPack: CompanyResearchPack


class ResearchTaskContract(BaseModel):
    requiredSources: list[str] = Field(default_factory=list)
    requiredSections: list[str] = Field(default_factory=list)
    citationRequired: bool = False
    analysisDepth: Literal["standard", "deep"] = "standard"
    deadlineMinutes: int = Field(default=30, ge=5, le=24 * 60)


class ResearchReplanRecord(BaseModel):
    replanId: str
    iteration: int = Field(ge=0)
    triggerNodeKey: str
    reason: str
    missingAreas: list[str] = Field(default_factory=list)
    action: str
    fallbackProvider: str | None = None
    fallbackCapability: str | None = None
    reasoningSummary: str | None = None
    decisionLog: list[str] = Field(default_factory=list)
    resultSummary: str
    createdAt: str


class ResearchReflectionResult(BaseModel):
    status: Literal["pass", "warn", "fail"]
    summary: str
    contractScore: float = Field(ge=0, le=100)
    citationCoverage: float = Field(ge=0, le=1)
    firstPartyRatio: float = Field(ge=0, le=1)
    answeredQuestionCoverage: float = Field(ge=0, le=1)
    missingRequirements: list[str] = Field(default_factory=list)
    unansweredQuestions: list[str] = Field(default_factory=list)
    qualityFlags: list[str] = Field(default_factory=list)
    suggestedFixes: list[str] = Field(default_factory=list)


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


class ScopedNewsResponse(GatewayResponse[ScopedNewsData]):
    pass


class NewsRadarResponse(GatewayResponse[NewsRadarData]):
    pass


class ThemeConceptsResponse(GatewayResponse[ThemeConceptsData]):
    pass


class StockEvidenceResponse(GatewayResponse[StockEvidenceData]):
    pass


class StockEvidenceBatchResponse(GatewayResponse[StockEvidenceBatchData]):
    pass


class StockResearchPackResponse(GatewayResponse[StockResearchPackData]):
    pass

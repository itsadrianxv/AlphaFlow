"""
Intelligence data router
Provides theme news and evidence endpoints for workflow agents.
"""

from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.contracts.intelligence import (
    ConfidenceAnalysis,
    ConfidenceCheckBatchRequest,
    ConfidenceCheckBatchResponse,
    ConfidenceCheckRequest,
)
from app.services.intelligence_data_adapter import IntelligenceDataAdapter
from app.services.confidence_analysis_service import ConfidenceAnalysisService

router = APIRouter()
confidence_analysis_service = ConfidenceAnalysisService()


class ThemeNewsItem(BaseModel):
    id: str
    title: str
    summary: str
    source: str
    publishedAt: str
    sentiment: str
    relevanceScore: float
    relatedStocks: list[str]


class CandidateStock(BaseModel):
    stockCode: str
    stockName: str
    reason: str
    heat: float = Field(..., ge=0, le=100)
    concept: str


class ConceptMatchItem(BaseModel):
    name: str
    code: str | None = None
    aliases: list[str] = Field(default_factory=list)
    confidence: float = Field(..., ge=0, le=1)
    reason: str
    source: str


class ConceptMatchResponse(BaseModel):
    theme: str
    matchedBy: Literal["whitelist", "zhipu", "auto"]
    concepts: list[ConceptMatchItem]


class ConceptRuleRecord(BaseModel):
    theme: str
    whitelist: list[str] = Field(default_factory=list)
    blacklist: list[str] = Field(default_factory=list)
    aliases: list[str] = Field(default_factory=list)
    updatedAt: str | None = None


class ConceptRuleUpdateRequest(BaseModel):
    theme: str = Field(..., min_length=1)
    whitelist: list[str] = Field(default_factory=list)
    blacklist: list[str] = Field(default_factory=list)
    aliases: list[str] = Field(default_factory=list)


class CompanyEvidence(BaseModel):
    stockCode: str
    companyName: str
    concept: str
    evidenceSummary: str
    catalysts: list[str]
    risks: list[str]
    credibilityScore: int
    updatedAt: str


class EvidenceBatchRequest(BaseModel):
    stockCodes: list[str] = Field(..., min_length=1)
    concept: str


@router.get(
    "/intelligence/news",
    response_model=list[ThemeNewsItem],
    summary="Get theme news",
)
async def get_theme_news(
    theme: str = Query(..., min_length=1),
    days: int = Query(7, ge=1, le=30),
    limit: int = Query(20, ge=1, le=50),
):
    try:
        return IntelligenceDataAdapter.get_theme_news(theme=theme, days=days, limit=limit)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"获取主题资讯失败: {exc}") from exc


@router.get(
    "/intelligence/candidates",
    response_model=list[CandidateStock],
    summary="Get candidate stocks by theme",
)
async def get_candidates(
    theme: str = Query(..., min_length=1),
    limit: int = Query(6, ge=1, le=30),
):
    try:
        return IntelligenceDataAdapter.get_candidates(theme=theme, limit=limit)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"获取候选股失败: {exc}") from exc


@router.get(
    "/intelligence/concepts/match",
    response_model=ConceptMatchResponse,
    summary="Match concept boards by theme",
)
async def match_theme_concepts(
    theme: str = Query(..., min_length=1),
    limit: int = Query(5, ge=1, le=20),
):
    try:
        return IntelligenceDataAdapter.match_theme_concepts(theme=theme, limit=limit)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"概念匹配失败: {exc}") from exc


@router.get(
    "/intelligence/concepts/rules",
    response_model=ConceptRuleRecord,
    summary="Get concept rules by theme",
)
async def get_concept_rules(theme: str = Query(..., min_length=1)):
    try:
        return IntelligenceDataAdapter.get_concept_rules(theme=theme)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"读取概念规则失败: {exc}") from exc


@router.put(
    "/intelligence/concepts/rules",
    response_model=ConceptRuleRecord,
    summary="Upsert concept rules",
)
async def put_concept_rules(request: ConceptRuleUpdateRequest):
    try:
        return IntelligenceDataAdapter.update_concept_rules(
            theme=request.theme,
            whitelist=request.whitelist,
            blacklist=request.blacklist,
            aliases=request.aliases,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"更新概念规则失败: {exc}") from exc


@router.get(
    "/intelligence/evidence/{stock_code}",
    response_model=CompanyEvidence,
    summary="Get company evidence",
)
async def get_company_evidence(stock_code: str, concept: str | None = Query(None)):
    if not stock_code.isdigit() or len(stock_code) != 6:
        raise HTTPException(status_code=400, detail="无效的股票代码")

    try:
        return IntelligenceDataAdapter.get_company_evidence(stock_code, concept)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"获取公司证据失败: {exc}") from exc


@router.post(
    "/intelligence/evidence/batch",
    response_model=list[CompanyEvidence],
    summary="Get batch company evidence",
)
async def get_company_evidence_batch(request: EvidenceBatchRequest):
    invalid_codes = [
        code for code in request.stockCodes if (not code.isdigit() or len(code) != 6)
    ]

    if invalid_codes:
        raise HTTPException(
            status_code=400,
            detail=f"存在无效股票代码: {','.join(invalid_codes)}",
        )

    try:
        return IntelligenceDataAdapter.get_company_evidence_batch(
            stock_codes=request.stockCodes,
            concept=request.concept,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"批量获取公司证据失败: {exc}") from exc


@router.post(
    "/intelligence/confidence/check",
    response_model=ConfidenceAnalysis,
    summary="Run confidence analysis for a generated response",
)
async def run_confidence_check(request: ConfidenceCheckRequest):
    try:
        return confidence_analysis_service.check(request)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"可信度分析失败: {exc}") from exc


@router.post(
    "/intelligence/confidence/check-batch",
    response_model=ConfidenceCheckBatchResponse,
    summary="Run batch confidence analysis",
)
async def run_confidence_check_batch(request: ConfidenceCheckBatchRequest):
    try:
        return ConfidenceCheckBatchResponse(
            items=confidence_analysis_service.check_batch(request.items)
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"批量可信度分析失败: {exc}") from exc

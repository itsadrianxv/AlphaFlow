"""
Intelligence data router
Provides theme news and evidence endpoints for workflow agents.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from app.services.intelligence_data_adapter import IntelligenceDataAdapter

router = APIRouter()


class ThemeNewsItem(BaseModel):
    id: str
    title: str
    summary: str
    source: str
    publishedAt: str
    sentiment: str
    relevanceScore: float
    relatedStocks: list[str]


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
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"获取主题资讯失败: {exc}") from exc


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
    except Exception as exc:
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
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"批量获取公司证据失败: {exc}") from exc

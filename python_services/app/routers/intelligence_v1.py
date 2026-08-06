"""Standardized v1 intelligence data endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.contracts.intelligence import (
    DailyNewsRequest,
    DailyNewsResponse,
    NewsRadarRequest,
    NewsRadarResponse,
    NewsRadarResolveRequest,
    StockEvidenceBatchRequest,
    StockEvidenceBatchResponse,
    StockEvidenceResponse,
    StockResearchPackResponse,
    ScopedNewsResponse,
    ThemeConceptsResponse,
    ThemeNewsResponse,
)
from app.gateway.common import GatewayError, is_valid_stock_code
from app.gateway.intelligence_gateway import intelligence_gateway

router = APIRouter(prefix="/api/v1/intelligence")


@router.post("/news/radar", response_model=NewsRadarResponse)
def get_news_radar(
    request: Request,
    body: NewsRadarRequest,
):
    return intelligence_gateway.get_news_radar(
        request_id=request.state.request_id,
        companies=[item.model_dump() for item in body.companies],
        industries=[item.model_dump() for item in body.industries],
        days=body.days,
        limit=body.limit,
        end_at=body.endAt,
        include_macro=body.includeMacro,
        trace_anchor=body.traceAnchor.model_dump() if body.traceAnchor else None,
    )


@router.post("/news/daily", response_model=DailyNewsResponse)
def get_daily_news(request: Request, body: DailyNewsRequest):
    return intelligence_gateway.get_daily_news(
        request_id=request.state.request_id,
        target_date=body.date,
    )


@router.post("/news/radar/resolve", response_model=NewsRadarResponse)
def resolve_news_radar(request: Request, body: NewsRadarResolveRequest):
    return intelligence_gateway.resolve_news_radar(
        request_id=request.state.request_id,
        companies=[item.model_dump() for item in body.companies],
        industries=[item.model_dump() for item in body.industries],
        days=body.days,
        limit=body.limit,
        end_at=body.endAt,
        raw_items=body.rawItems,
        include_macro=body.includeMacro,
        trace_anchor=body.traceAnchor.model_dump() if body.traceAnchor else None,
    )


@router.get("/themes/{theme:path}/news", response_model=ThemeNewsResponse)
async def get_theme_news(
    request: Request,
    theme: str,
    days: int = Query(7, ge=1, le=30),
    limit: int = Query(20, ge=1, le=50),
):
    normalized_theme = theme.strip()
    if not normalized_theme:
        raise GatewayError(
            code="invalid_theme",
            message="主题不能为空",
            status_code=400,
        )

    return intelligence_gateway.get_theme_news(
        request_id=request.state.request_id,
        theme=normalized_theme,
        days=days,
        limit=limit,
    )


@router.get("/news/macro", response_model=ScopedNewsResponse)
async def get_macro_news(request: Request, days: int = Query(7, ge=1, le=30), limit: int = Query(20, ge=1, le=50)):
    return intelligence_gateway.get_macro_news(request_id=request.state.request_id, days=days, limit=limit)


@router.get("/industries/{industry}/news", response_model=ScopedNewsResponse)
async def get_industry_news(request: Request, industry: str, days: int = Query(7, ge=1, le=30), limit: int = Query(20, ge=1, le=50)):
    normalized_industry = industry.strip()
    if not normalized_industry:
        raise GatewayError(code="invalid_industry", message="行业不能为空", status_code=400)
    return intelligence_gateway.get_industry_news(request_id=request.state.request_id, industry=normalized_industry, days=days, limit=limit)


@router.get("/stocks/{stock_code}/news", response_model=ScopedNewsResponse)
async def get_company_news(request: Request, stock_code: str, days: int = Query(7, ge=1, le=30), limit: int = Query(20, ge=1, le=50)):
    if not is_valid_stock_code(stock_code):
        raise GatewayError(code="invalid_stock_code", message=f"无效的股票代码格式: {stock_code}", status_code=400)
    return intelligence_gateway.get_company_news(request_id=request.state.request_id, stock_code=stock_code, days=days, limit=limit)


@router.get("/themes/{theme}/concepts", response_model=ThemeConceptsResponse)
async def get_theme_concepts(
    request: Request,
    theme: str,
    limit: int = Query(5, ge=1, le=20),
):
    normalized_theme = theme.strip()
    if not normalized_theme:
        raise GatewayError(
            code="invalid_theme",
            message="主题不能为空",
            status_code=400,
        )

    return intelligence_gateway.get_theme_concepts(
        request_id=request.state.request_id,
        theme=normalized_theme,
        limit=limit,
    )


@router.get("/stocks/{stock_code}/evidence", response_model=StockEvidenceResponse)
async def get_stock_evidence(
    request: Request,
    stock_code: str,
    concept: str | None = Query(None),
):
    if not is_valid_stock_code(stock_code):
        raise GatewayError(
            code="invalid_stock_code",
            message=f"无效的股票代码格式: {stock_code}",
            status_code=400,
        )

    return intelligence_gateway.get_stock_evidence(
        request_id=request.state.request_id,
        stock_code=stock_code,
        concept=concept.strip() if concept else None,
    )


@router.post("/stocks/evidence/batch", response_model=StockEvidenceBatchResponse)
async def get_stock_evidence_batch(
    request: Request,
    body: StockEvidenceBatchRequest,
):
    invalid_codes = [code for code in body.stockCodes if not is_valid_stock_code(code)]
    if invalid_codes:
        raise GatewayError(
            code="invalid_stock_code",
            message=f"存在无效股票代码: {', '.join(invalid_codes)}",
            status_code=400,
        )

    return intelligence_gateway.get_stock_evidence_batch(
        request_id=request.state.request_id,
        stock_codes=body.stockCodes,
        concept=body.concept,
    )


@router.get(
    "/stocks/{stock_code}/research-pack",
    response_model=StockResearchPackResponse,
)
async def get_stock_research_pack(
    request: Request,
    stock_code: str,
    concept: str | None = Query(None),
):
    if not is_valid_stock_code(stock_code):
        raise GatewayError(
            code="invalid_stock_code",
            message=f"无效的股票代码格式: {stock_code}",
            status_code=400,
        )

    return intelligence_gateway.get_stock_research_pack(
        request_id=request.state.request_id,
        stock_code=stock_code,
        concept=concept.strip() if concept else None,
    )

"""Standardized v1 intelligence data endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.contracts.intelligence import (
    StockEvidenceBatchRequest,
    StockEvidenceBatchResponse,
    StockEvidenceResponse,
    StockResearchPackResponse,
    ThemeConceptsResponse,
    ThemeNewsResponse,
)
from app.gateway.common import GatewayError, is_valid_stock_code
from app.gateway.intelligence_gateway import intelligence_gateway

router = APIRouter(prefix="/api/v1/intelligence")


@router.get("/themes/{theme}/news", response_model=ThemeNewsResponse)
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

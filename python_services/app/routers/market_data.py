"""Standardized v1 market data endpoints."""

from __future__ import annotations

from enum import IntEnum

from fastapi import APIRouter, Query, Request

from app.contracts.common import StockBatchRequest
from app.contracts.market import (
    IndicatorHistoryResponse,
    IndustriesResponse,
    MarketHeatmapResponse,
    MarketStockBatchResponse,
    MarketStockResponse,
    StockCodesResponse,
    ThemeCandidatesResponse,
)
from app.gateway.common import GatewayError, is_valid_stock_code
from app.gateway.market_gateway import market_gateway

router = APIRouter(prefix="/api/v1/market")

_VALID_HISTORY_INDICATORS = {
    "ROE",
    "PE",
    "PB",
    "EPS",
    "REVENUE",
    "NET_PROFIT",
    "DEBT_RATIO",
}


class HeatmapConceptLimit(IntEnum):
    EIGHT = 8
    FIFTEEN = 15


@router.get("/heatmap", response_model=MarketHeatmapResponse)
async def get_market_heatmap(
    request: Request,
    concept_limit: HeatmapConceptLimit = Query(
        HeatmapConceptLimit.FIFTEEN,
        alias="conceptLimit",
    ),
):
    return market_gateway.get_heatmap_snapshot(
        request_id=request.state.request_id,
        concept_limit=int(concept_limit),
    )


@router.get("/stocks/codes", response_model=StockCodesResponse)
async def get_stock_codes(request: Request):
    return market_gateway.get_stock_codes(request_id=request.state.request_id)


@router.get("/stocks/industries", response_model=IndustriesResponse)
async def get_stock_industries(request: Request):
    return market_gateway.get_available_industries(request_id=request.state.request_id)


@router.get("/stocks/{stock_code}/history", response_model=IndicatorHistoryResponse)
async def get_stock_indicator_history(
    request: Request,
    stock_code: str,
    indicator: str = Query(..., description="Indicator name, e.g. ROE or REVENUE"),
    years: int = Query(3, ge=1, le=10),
):
    if not is_valid_stock_code(stock_code):
        raise GatewayError(
            code="invalid_stock_code",
            message=f"无效的证券代码格式: {stock_code}",
            status_code=400,
        )

    normalized_indicator = indicator.strip().upper()
    if normalized_indicator not in _VALID_HISTORY_INDICATORS:
        raise GatewayError(
            code="invalid_indicator",
            message=(
                "不支持的指标: "
                f"{indicator}，支持的指标: {', '.join(sorted(_VALID_HISTORY_INDICATORS))}"
            ),
            status_code=400,
        )

    return market_gateway.get_indicator_history(
        request_id=request.state.request_id,
        stock_code=stock_code,
        indicator=normalized_indicator,
        years=years,
    )


@router.get("/stocks/{stock_code}", response_model=MarketStockResponse)
async def get_stock_snapshot(request: Request, stock_code: str):
    if not is_valid_stock_code(stock_code):
        raise GatewayError(
            code="invalid_stock_code",
            message=f"无效的证券代码格式: {stock_code}",
            status_code=400,
        )

    return market_gateway.get_stock(
        request_id=request.state.request_id,
        stock_code=stock_code,
    )


@router.post("/stocks/batch", response_model=MarketStockBatchResponse)
async def get_stock_batch(request: Request, body: StockBatchRequest):
    invalid_codes = [code for code in body.stockCodes if not is_valid_stock_code(code)]
    if invalid_codes:
        raise GatewayError(
            code="invalid_stock_code",
            message=f"无效的证券代码格式: {', '.join(invalid_codes)}",
            status_code=400,
        )

    return market_gateway.get_stock_batch(
        request_id=request.state.request_id,
        stock_codes=body.stockCodes,
    )


@router.get("/themes/{theme}/candidates", response_model=ThemeCandidatesResponse)
async def get_theme_candidates(
    request: Request,
    theme: str,
    limit: int = Query(6, ge=1, le=30),
):
    normalized_theme = theme.strip()
    if not normalized_theme:
        raise GatewayError(
            code="invalid_theme",
            message="主题不能为空",
            status_code=400,
        )

    return market_gateway.get_theme_candidates(
        request_id=request.state.request_id,
        theme=normalized_theme,
        limit=limit,
    )

"""Standardized v1 timing endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.contracts.timing import (
    MarketContextSnapshotResponse,
    TimingBarsResponse,
    TimingEvidenceBatchRequest,
    TimingEvidenceBatchResponse,
    TimingSignalBatchRequest,
    TimingSignalBatchResponse,
    TimingSignalResponse,
)
from app.gateway.common import GatewayError, is_valid_stock_code
from app.gateway.timing_gateway import timing_gateway

router = APIRouter(prefix="/api/v1/timing")


def _validate_timeframe(timeframe: str) -> str:
    normalized = timeframe.strip().upper()
    if normalized not in {
        "DAILY",
        "WEEKLY",
        "MONTHLY",
        "MINUTE_60",
        "MINUTE_30",
        "MINUTE_15",
        "MINUTE_1",
    }:
        raise GatewayError(
            code="invalid_timeframe",
            message="timing v1 仅支持 DAILY、WEEKLY、MONTHLY、MINUTE_60、MINUTE_30、MINUTE_15、MINUTE_1 时间框架",
            status_code=400,
            provider="gateway",
        )
    return normalized


def _validate_adjust(adjust: str) -> str:
    normalized = adjust.strip().lower()
    if normalized not in {"qfq", "hfq", ""}:
        raise GatewayError(
            code="invalid_adjust",
            message="adjust 仅支持 qfq、hfq 或空字符串",
            status_code=400,
            provider="gateway",
        )
    return normalized or "qfq"


@router.get("/stocks/{stock_code}/bars", response_model=TimingBarsResponse)
async def get_stock_bars(
    request: Request,
    stock_code: str,
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    timeframe: str = Query(default="DAILY"),
    adjust: str = Query(default="qfq"),
):
    if not is_valid_stock_code(stock_code):
        raise GatewayError(
            code="invalid_stock_code",
            message=f"无效的股票代码格式: {stock_code}",
            status_code=400,
            provider="gateway",
        )

    return timing_gateway.get_bars(
        request_id=request.state.request_id,
        stock_code=stock_code,
        start=start,
        end=end,
        timeframe=_validate_timeframe(timeframe),
        adjust=_validate_adjust(adjust),
    )


@router.get("/stocks/{stock_code}/signals", response_model=TimingSignalResponse)
async def get_stock_signal(
    request: Request,
    stock_code: str,
    as_of_date: str | None = Query(default=None, alias="asOfDate"),
    lookback_days: int | None = Query(
        default=None,
        alias="lookbackDays",
        ge=120,
        le=365,
    ),
    include_bars: bool = Query(default=False, alias="includeBars"),
):
    if not is_valid_stock_code(stock_code):
        raise GatewayError(
            code="invalid_stock_code",
            message=f"无效的股票代码格式: {stock_code}",
            status_code=400,
            provider="gateway",
        )

    return timing_gateway.get_signal(
        request_id=request.state.request_id,
        stock_code=stock_code,
        as_of_date=as_of_date,
        lookback_days=lookback_days,
        include_bars=include_bars,
    )


@router.post("/stocks/signals/batch", response_model=TimingSignalBatchResponse)
async def get_stock_signal_batch(
    request: Request,
    body: TimingSignalBatchRequest,
):
    invalid_codes = [code for code in body.stockCodes if not is_valid_stock_code(code)]
    if invalid_codes:
        raise GatewayError(
            code="invalid_stock_code",
            message=f"无效的股票代码格式: {', '.join(invalid_codes)}",
            status_code=400,
            provider="gateway",
        )

    return timing_gateway.get_signal_batch(
        request_id=request.state.request_id,
        stock_codes=body.stockCodes,
        as_of_date=body.asOfDate,
        lookback_days=body.lookbackDays,
        include_bars=body.includeBars,
    )


@router.post("/stocks/evidence/batch", response_model=TimingEvidenceBatchResponse)
async def get_stock_evidence_batch(
    request: Request,
    body: TimingEvidenceBatchRequest,
):
    invalid_codes = [code for code in body.stockCodes if not is_valid_stock_code(code)]
    if invalid_codes:
        raise GatewayError(
            code="invalid_stock_code",
            message=f"无效的股票代码格式: {', '.join(invalid_codes)}",
            status_code=400,
            provider="gateway",
        )
    return timing_gateway.get_evidence_batch(
        request_id=request.state.request_id,
        stock_codes=body.stockCodes,
        as_of_date=body.asOfDate,
        timeframes=body.timeframes,
        indicator_ids=body.indicatorIds,
        lookback_days=body.lookbackDays,
    )


@router.get(
    "/market/context",
    response_model=MarketContextSnapshotResponse,
)
async def get_market_context(
    request: Request,
    as_of_date: str | None = Query(default=None, alias="asOfDate"),
):
    return timing_gateway.get_market_context(
        request_id=request.state.request_id,
        as_of_date=as_of_date,
    )

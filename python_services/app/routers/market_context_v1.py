"""Standardized v1 market context endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.contracts.market_context import MarketContextSnapshotResponse
from app.gateway.market_context_gateway import market_context_gateway

router = APIRouter(prefix="/api/v1/market-context")


@router.get("/snapshot", response_model=MarketContextSnapshotResponse)
async def get_market_context_snapshot(request: Request):
    return market_context_gateway.get_snapshot(request_id=request.state.request_id)

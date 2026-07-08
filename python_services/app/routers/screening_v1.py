"""Strict screening workbench routes."""

from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.data_providers import get_default_data_provider
from app.services.screening_catalog import load_indicator_catalog
from app.services.screening_formula_engine import SafeFormulaEngine
from app.services.screening_periods import resolve_periods
from app.services.screening_query_service import ScreeningQueryService
from app.services.screening_universe import ScreeningStockSearcher

router = APIRouter(prefix="/api/v1/screening", tags=["screening-v1"])


class FormulaValidationRequest(BaseModel):
    expression: str = Field(..., min_length=1)
    targetIndicators: list[str] = Field(default_factory=list, max_length=5)


class ScreeningQueryRequest(BaseModel):
    stockCodes: list[str] = Field(..., min_length=1, max_length=20)
    indicators: list[dict[str, str]]
    formulas: list[dict[str, object]] = Field(default_factory=list)
    timeConfig: dict[str, str]


@lru_cache(maxsize=1)
def get_stock_searcher() -> ScreeningStockSearcher:
    provider = get_default_data_provider()

    def load_universe():
        return [
            {
                "stockCode": profile.stockCode,
                "stockName": profile.stockName,
                "market": profile.market,
            }
            for profile in provider.get_stock_universe()
        ]

    return ScreeningStockSearcher(universe_loader=load_universe)


@router.get("/stocks/search")
def search_stocks(
    keyword: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=20),
):
    try:
        return get_stock_searcher().search(keyword, limit)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/indicator-categories")
def list_indicator_categories():
    return load_indicator_catalog()["categories"]


@router.get("/indicators")
def list_indicators():
    return load_indicator_catalog()["items"]


@router.post("/formulas/validate")
def validate_formula(request: FormulaValidationRequest):
    engine = SafeFormulaEngine()
    result = engine.validate(
        expression=request.expression,
        target_indicators=request.targetIndicators,
    )
    return {
        "valid": result.valid,
        "normalizedExpression": result.normalized_expression,
        "referencedMetrics": result.referenced_metrics,
        "errors": result.errors,
    }


@router.post("/query")
def query_dataset(request: ScreeningQueryRequest):
    try:
        provider = get_default_data_provider()
        service = ScreeningQueryService(provider=provider)
        periods = resolve_periods(request.timeConfig)
        return service.query_dataset(
            stock_codes=request.stockCodes,
            indicators=request.indicators,
            formulas=request.formulas,
            periods=periods,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc

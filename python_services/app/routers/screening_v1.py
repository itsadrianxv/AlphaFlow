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
from app.services.screening_stock_universe_store import (
    ScreeningStockUniverseStore,
    StockUniverseUnavailableError,
)
from app.financial_metrics.service import get_financial_metric_service
from app.services.screening_run_executor import ScreeningRunExecutor

router = APIRouter(prefix="/api/v1/screening", tags=["screening-v1"])


class FormulaValidationRequest(BaseModel):
    expression: str = Field(..., min_length=1)
    targetIndicators: list[str] = Field(default_factory=list, max_length=5)


class ScreeningQueryRequest(BaseModel):
    stockCodes: list[str] = Field(..., min_length=1, max_length=20)
    indicators: list[dict[str, str]]
    formulas: list[dict[str, object]] = Field(default_factory=list)
    timeConfig: dict[str, str]


class StockMentionsRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=20_000)


class ScreeningRunExecutionRequest(BaseModel):
    runId: str = Field(..., min_length=1)
    config: dict[str, object]


@lru_cache(maxsize=1)
def get_stock_searcher() -> ScreeningStockSearcher:
    store = ScreeningStockUniverseStore()
    return ScreeningStockSearcher(universe_loader=store.load_records, ttl_seconds=0)


@router.get("/stocks/search")
def search_stocks(
    keyword: str = Query(..., min_length=1),
    limit: int = Query(20, ge=1, le=20),
):
    try:
        return get_stock_searcher().search(keyword, limit)
    except StockUniverseUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/stocks/mentions")
def resolve_stock_mentions(request: StockMentionsRequest):
    try:
        searcher = get_stock_searcher()
        records = searcher.get_universe()
        return searcher.resolve_mentions(request.text, records)
    except StockUniverseUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/indicator-categories")
def list_indicator_categories():
    return load_indicator_catalog()["categories"]


@router.get("/indicators")
def list_indicators():
    return load_indicator_catalog()["items"]


@router.get("/financial-metrics/search")
def search_financial_metrics(q: str = Query(..., min_length=1), company_type: str | None = None, limit: int = Query(50, ge=1, le=100)):
    return [metric.to_dict() for metric in get_financial_metric_service().search_metrics(q, company_type=company_type, limit=limit)]


@router.post("/execute-run")
def execute_screening_run(request: ScreeningRunExecutionRequest):
    try:
        return ScreeningRunExecutor().execute(request.runId, request.config)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=str(exc)) from exc


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

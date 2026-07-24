from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from kronos_service.contracts import (
    KronosBatchItemError,
    KronosErrorBody,
    KronosErrorResponse,
    KronosForecastBatchRequest,
    KronosForecastBatchResponse,
    KronosForecastRequest,
    KronosForecastResponse,
    KronosHealthResponse,
)
from kronos_service.service import KronosForecastError, KronosModelForecaster
from kronos_service.service import normalize_bars


def error_response(error: KronosForecastError, status_code: int = 400) -> JSONResponse:
    payload = KronosErrorResponse(
        error=KronosErrorBody(
            code=error.code,
            message=error.message,
            stockCode=error.stock_code,
        )
    )
    return JSONResponse(status_code=status_code, content=payload.model_dump(mode="json"))


def create_app(forecaster=None) -> FastAPI:
    effective_forecaster = forecaster or KronosModelForecaster()
    app = FastAPI(
        title="Kronos Forecast Service",
        description="Independent local FastAPI service for Kronos K-line forecasts",
        version="0.1.0",
    )

    @app.get("/health", response_model=KronosHealthResponse)
    async def health():
        return effective_forecaster.health()

    @app.post("/api/v1/kronos/forecast", response_model=KronosForecastResponse)
    async def forecast(body: KronosForecastRequest):
        try:
            bars = normalize_bars(
                body.bars,
                effective_forecaster.max_context,
                body.timeframe,
            )
            return effective_forecaster.forecast(
                stock_code=body.stockCode,
                timeframe=body.timeframe,
                bars=bars,
                prediction_length=body.predictionLength,
            )
        except KronosForecastError as error:
            return error_response(error)

    @app.post(
        "/api/v1/kronos/forecast/batch",
        response_model=KronosForecastBatchResponse,
    )
    async def forecast_batch(body: KronosForecastBatchRequest):
        items = []
        errors: list[KronosBatchItemError] = []
        normalized_items = []

        for item in body.items:
            try:
                normalized_items.append(
                    (
                        item.stockCode,
                        item.timeframe,
                        normalize_bars(
                            item.bars,
                            effective_forecaster.max_context,
                            item.timeframe,
                        ),
                    )
                )
            except KronosForecastError as error:
                errors.append(
                    KronosBatchItemError(
                        stockCode=item.stockCode,
                        timeframe=item.timeframe,
                        code=error.code,
                        message=error.message,
                    )
                )

        if hasattr(effective_forecaster, "forecast_batch") and normalized_items:
            try:
                forecasts = effective_forecaster.forecast_batch(
                    items=normalized_items,
                    prediction_length=body.predictionLength,
                )
                return KronosForecastBatchResponse(items=forecasts, errors=errors)
            except (AttributeError, NotImplementedError):
                pass
            except KronosForecastError as error:
                errors.extend(
                    KronosBatchItemError(
                        stockCode=stock_code,
                        timeframe=timeframe,
                        code=error.code,
                        message=error.message,
                    )
                    for stock_code, timeframe, _bars in normalized_items
                )
                return KronosForecastBatchResponse(
                    items=[],
                    errors=errors,
                )

        for stock_code, timeframe, bars in normalized_items:
            try:
                items.append(
                    effective_forecaster.forecast(
                        stock_code=stock_code,
                        timeframe=timeframe,
                        bars=bars,
                        prediction_length=body.predictionLength,
                    )
                )
            except KronosForecastError as error:
                errors.append(
                    KronosBatchItemError(
                        stockCode=stock_code,
                        timeframe=timeframe,
                        code=error.code,
                        message=error.message,
                    )
                )

        return KronosForecastBatchResponse(items=items, errors=errors)

    return app


app = create_app()

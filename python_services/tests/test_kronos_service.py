from __future__ import annotations

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from kronos_service.app import create_app
from kronos_service.service import KronosForecastError, future_period_dates


def build_bars(count: int) -> list[dict[str, float | str]]:
    start = date(2025, 1, 1)
    return [
        {
            "tradeDate": (start + timedelta(days=index)).isoformat(),
            "open": 10 + index * 0.1,
            "high": 10.4 + index * 0.1,
            "low": 9.8 + index * 0.1,
            "close": 10.2 + index * 0.1,
            "volume": 1000 + index,
            "amount": 10000 + index * 10,
        }
        for index in range(count)
    ]


class FakeForecaster:
    model_name = "NeoQuasar/Kronos-base"
    tokenizer_name = "NeoQuasar/Kronos-Tokenizer-base"
    model_version = "fake-local"
    max_context = 512
    default_prediction_length = 60
    device = "cpu"
    is_loaded = True

    def __init__(self) -> None:
        self.seen_lookback_days: list[int] = []

    def health(self):
        return {
            "status": "healthy",
            "modelLoaded": self.is_loaded,
            "modelName": self.model_name,
            "tokenizerName": self.tokenizer_name,
            "modelVersion": self.model_version,
            "device": self.device,
            "maxContext": self.max_context,
            "defaultPredictionLength": self.default_prediction_length,
        }

    def forecast(self, *, stock_code, timeframe="DAILY", bars, prediction_length):
        self.seen_lookback_days.append(len(bars))
        if stock_code == "000000":
            raise KronosForecastError(
                code="mock_failed",
                message="mock forecast failed",
                stock_code=stock_code,
            )

        last = bars[-1]
        points = [
            {
                "tradeDate": (date.fromisoformat(last.tradeDate) + timedelta(days=index + 1)).isoformat(),
                "open": last.close + index * 0.2,
                "high": last.close + index * 0.2 + 0.4,
                "low": last.close + index * 0.2 - 0.3,
                "close": last.close + index * 0.2 + 0.1,
                "volume": last.volume,
                "amount": last.amount,
            }
            for index in range(prediction_length)
        ]
        return {
            "stockCode": stock_code,
            "timeframe": timeframe,
            "asOfDate": last.tradeDate,
            "modelName": self.model_name,
            "modelVersion": self.model_version,
            "lookbackDays": len(bars),
            "lookbackBars": len(bars),
            "predictionLength": prediction_length,
            "device": self.device,
            "points": points,
            "summary": {
                "expectedReturnPct": 8.2,
                "maxDrawdownPct": -3.1,
                "upsidePct": 9.4,
                "volatilityProxy": 0.18,
                "direction": "bullish",
                "confidence": 0.72,
            },
            "warnings": [],
        }


@pytest.fixture()
def client_and_forecaster():
    forecaster = FakeForecaster()
    app = create_app(forecaster=forecaster)
    return TestClient(app), forecaster


def test_health_exposes_model_device_and_defaults(client_and_forecaster):
    client, _forecaster = client_and_forecaster

    response = client.get("/health")

    assert response.status_code == 200
    payload = response.json()
    assert payload["modelLoaded"] is True
    assert payload["modelName"] == "NeoQuasar/Kronos-base"
    assert payload["tokenizerName"] == "NeoQuasar/Kronos-Tokenizer-base"
    assert payload["device"] == "cpu"
    assert payload["maxContext"] == 512
    assert payload["defaultPredictionLength"] == 60


def test_forecast_rejects_short_history(client_and_forecaster):
    client, _forecaster = client_and_forecaster

    response = client.post(
        "/api/v1/kronos/forecast",
        json={
            "stockCode": "600519",
            "bars": build_bars(119),
            "predictionLength": 60,
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload["error"]["code"] == "insufficient_history"


def test_forecast_truncates_lookback_to_max_context(client_and_forecaster):
    client, forecaster = client_and_forecaster

    response = client.post(
        "/api/v1/kronos/forecast",
        json={
            "stockCode": "600519",
            "bars": build_bars(620),
            "predictionLength": 5,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["stockCode"] == "600519"
    assert payload["lookbackBars"] == 512
    assert len(payload["points"]) == 5
    assert forecaster.seen_lookback_days == [512]


def test_batch_returns_item_level_error(client_and_forecaster):
    client, _forecaster = client_and_forecaster

    response = client.post(
        "/api/v1/kronos/forecast/batch",
        json={
            "items": [
                {"stockCode": "600519", "bars": build_bars(130)},
                {"stockCode": "000000", "bars": build_bars(130)},
            ],
            "predictionLength": 3,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert [item["stockCode"] for item in payload["items"]] == ["600519"]
    assert payload["errors"] == [
        {
            "stockCode": "000000",
            "timeframe": "DAILY",
            "code": "mock_failed",
            "message": "mock forecast failed",
        }
    ]


def test_future_period_dates_follow_selected_timeframe():
    assert future_period_dates("2026-07-06", 2, "WEEKLY") == [
        "2026-07-10",
        "2026-07-17",
    ]
    assert future_period_dates("2026-07-06", 2, "MONTHLY") == [
        "2026-07-31",
        "2026-08-31",
    ]
    minute_dates = future_period_dates(
        "2026-07-24 11:30:00",
        2,
        "MINUTE_30",
    )
    assert minute_dates == ["2026-07-24 13:00:00", "2026-07-24 13:30:00"]

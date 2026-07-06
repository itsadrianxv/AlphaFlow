"""Tests for timing v1 bars, signal context, and market context endpoints."""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd
from fastapi.testclient import TestClient

from app.gateway.common import GatewayError
from app.main import app

client = TestClient(app)


def _sample_history(stock_code: str = "600519") -> pd.DataFrame:
    dates = pd.date_range(end="2026-07-06", periods=280, freq="B")
    records: list[dict[str, object]] = []

    for index, value in enumerate(dates):
        base_close = 10 + index * 0.05
        records.append(
            {
                "日期": value.strftime("%Y-%m-%d"),
                "股票代码": stock_code,
                "开盘": base_close - 0.05,
                "收盘": base_close,
                "最高": base_close + 0.12,
                "最低": base_close - 0.15,
                "成交量": 1_000_000 + (index * 8_000),
                "成交额": (1_000_000 + (index * 8_000)) * base_close,
                "换手率": 1.2 + (index % 5) * 0.1,
            }
        )

    return pd.DataFrame.from_records(records)


def test_get_timing_bars_success() -> None:
    with (
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_stock_snapshot",
            return_value={"code": "600519", "name": "Moutai"},
        ),
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_stock_bars",
            return_value=_sample_history(),
        ),
    ):
        response = client.get("/api/v1/timing/stocks/600519/bars")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["provider"] == "tushare"
    assert payload["data"]["stockCode"] == "600519"
    assert payload["data"]["stockName"] == "Moutai"
    assert payload["data"]["timeframe"] == "DAILY"
    assert len(payload["data"]["bars"]) == 280


def test_get_timing_signal_success() -> None:
    with (
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_stock_snapshot",
            return_value={"code": "600519", "name": "Moutai"},
        ),
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_stock_bars",
            return_value=_sample_history(),
        ),
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_benchmark_bars",
            return_value=_sample_history("000300"),
            create=True,
        ),
    ):
        response = client.get("/api/v1/timing/stocks/600519/signals")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["provider"] == "tushare"
    assert payload["data"]["stockCode"] == "600519"
    assert payload["data"]["barsCount"] == 280
    assert payload["data"]["indicators"]["ema20"] > 0
    assert payload["data"]["signalContext"]["composite"]["direction"] in {
        "bullish",
        "neutral",
        "bearish",
    }
    assert len(payload["data"]["signalContext"]["engines"]) == 6


def test_get_timing_signal_includes_bars_when_requested() -> None:
    with (
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_stock_snapshot",
            return_value={"code": "600519", "name": "Moutai"},
        ),
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_stock_bars",
            return_value=_sample_history(),
        ),
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_benchmark_bars",
            return_value=_sample_history("000300"),
            create=True,
        ),
    ):
        response = client.get(
            "/api/v1/timing/stocks/600519/signals",
            params={"includeBars": "true"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["data"]["bars"]) == 280


def test_get_timing_signal_batch_reports_partial_errors() -> None:
    def mock_stock_bars(
        stock_code: str,
        start_date: str | None,
        end_date: str | None,
        adjust: str,
    ):
        del start_date, end_date, adjust
        if stock_code == "000001":
            raise GatewayError(
                code="bars_unavailable",
                message="upstream unavailable",
                status_code=503,
                provider="tushare",
            )
        return _sample_history(stock_code)

    with (
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_stock_snapshots",
            return_value={
                "600519": {"code": "600519", "name": "Moutai"},
                "000001": {"code": "000001", "name": "PingAn"},
            },
            create=True,
        ),
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_stock_bars",
            side_effect=mock_stock_bars,
        ),
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_benchmark_bars",
            return_value=_sample_history("000300"),
            create=True,
        ),
    ):
        response = client.post(
            "/api/v1/timing/stocks/signals/batch",
            json={"stockCodes": ["600519", "000001"]},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["provider"] == "tushare"
    assert len(payload["data"]["items"]) == 1
    assert payload["data"]["items"][0]["stockCode"] == "600519"
    assert len(payload["data"]["errors"]) == 1
    assert payload["data"]["errors"][0]["stockCode"] == "000001"
    assert any(
        warning["code"] == "partial_results"
        for warning in payload["meta"]["warnings"]
    )


def test_get_timing_signal_batch_includes_bars_when_requested() -> None:
    with (
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_stock_snapshots",
            return_value={
                "600519": {"code": "600519", "name": "Moutai"},
            },
            create=True,
        ),
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_stock_bars",
            return_value=_sample_history("600519"),
        ),
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_benchmark_bars",
            return_value=_sample_history("000300"),
            create=True,
        ),
    ):
        response = client.post(
            "/api/v1/timing/stocks/signals/batch",
            json={"stockCodes": ["600519"], "includeBars": True},
        )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["data"]["items"][0]["bars"]) == 280


def test_get_timing_bars_rejects_invalid_timeframe() -> None:
    response = client.get(
        "/api/v1/timing/stocks/600519/bars",
        params={"timeframe": "WEEKLY"},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_timeframe"


def test_get_market_context_success() -> None:
    with (
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_stock_universe",
            return_value=[
                {
                    "code": "600519",
                    "name": "Moutai",
                    "tradeDate": "2026-07-06",
                    "changePercent": 2.5,
                    "turnoverRate": 1.1,
                },
                {
                    "code": "000001",
                    "name": "PingAn",
                    "tradeDate": "2026-07-06",
                    "changePercent": -1.6,
                    "turnoverRate": 0.8,
                },
                {
                    "code": "300750",
                    "name": "CATL",
                    "tradeDate": "2026-07-06",
                    "changePercent": 5.8,
                    "turnoverRate": 2.4,
                },
            ],
        ),
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_stock_snapshot",
            side_effect=lambda stock_code: {"code": stock_code, "name": stock_code},
        ),
        patch(
            "app.providers.timing.tushare_provider.TushareTimingProvider.get_stock_bars",
            return_value=_sample_history(),
        ),
    ):
        response = client.get("/api/v1/timing/market/context")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["provider"] == "tushare"
    assert payload["data"]["asOfDate"] == "2026-07-06"
    assert payload["data"]["latestBreadth"]["totalCount"] == 3
    assert len(payload["data"]["indexes"]) == 4
    assert payload["data"]["features"]["benchmarkStrength"] >= 0
    assert "latestLeadership" in payload["data"]

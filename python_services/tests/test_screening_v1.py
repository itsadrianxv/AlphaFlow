from __future__ import annotations

from fastapi.testclient import TestClient

from app.data_providers.contracts import StockProfile
from app.main import app

client = TestClient(app)


def test_screening_query_route_uses_strict_provider(monkeypatch):
    class StrictProvider:
        provider_name = "tushare"

        def get_stock_profile(self, stock_code: str) -> StockProfile:
            return StockProfile(
                stockCode=stock_code,
                tsCode=f"{stock_code}.SH",
                stockName=stock_code,
                market="SH",
                sector="主板",
                industry="",
            )

        def get_latest_metrics(
            self,
            stock_codes: list[str],
            metric_ids: list[str],
        ) -> dict[str, dict[str, float | None]]:
            return {stock_code: {} for stock_code in stock_codes}

        def get_metric_series(
            self,
            stock_codes: list[str],
            metric_ids: list[str],
            periods: list[str],
        ) -> dict[str, dict[str, list]]:
            return {stock_code: {} for stock_code in stock_codes}

    monkeypatch.setattr(
        "app.routers.screening_v1.get_default_data_provider",
        lambda: StrictProvider(),
    )

    response = client.post(
        "/api/v1/screening/query",
        json={
            "stockCodes": ["600519"],
            "indicators": [],
            "formulas": [],
            "timeConfig": {
                "periodType": "ANNUAL",
                "rangeMode": "PRESET",
                "presetKey": "1Y",
            },
        },
    )

    assert response.status_code == 200
    assert response.json()["provider"] == "tushare"

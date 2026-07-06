from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_screening_query_route_uses_strict_provider(monkeypatch):
    class StrictProvider:
        provider_name = "tushare"

        def resolve_stock_metadata(self, stock_codes: list[str]) -> dict[str, dict[str, str]]:
            return {
                stock_code: {"stockName": stock_code, "market": "SH"}
                for stock_code in stock_codes
            }

        def query_latest_metrics(
            self,
            stock_codes: list[str],
            indicator_ids: list[str],
        ) -> dict[str, dict[str, float | None]]:
            return {stock_code: {} for stock_code in stock_codes}

        def query_series_metrics(
            self,
            stock_codes: list[str],
            indicator_ids: list[str],
            periods: list[str],
        ) -> dict[str, dict[str, dict[str, float | None]]]:
            return {stock_code: {} for stock_code in stock_codes}

    monkeypatch.setattr(
        "app.routers.screening_v1.get_strict_screening_provider",
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

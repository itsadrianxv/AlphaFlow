"""Tests for legacy stock data routes backed by screening providers."""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app
from app.providers.screening.factory import FallbackScreeningProvider

client = TestClient(app)


@dataclass
class StaticProvider:
    provider_name: str = "test"
    codes: list[str] | None = None
    batch: list[dict] | None = None
    history: list[dict] | None = None
    industries: list[str] | None = None
    errors: dict[str, Exception] | None = None

    def get_all_stock_codes(self) -> list[str]:
        if self.errors and "codes" in self.errors:
            raise self.errors["codes"]
        return self.codes or []

    def get_stock_batch(self, stock_codes: list[str]) -> list[dict]:
        if self.errors and "batch" in self.errors:
            raise self.errors["batch"]
        return self.batch or []

    def get_indicator_history(
        self,
        stock_code: str,
        indicator: str,
        years: int,
    ) -> list[dict]:
        if self.errors and "history" in self.errors:
            raise self.errors["history"]
        return self.history or []

    def get_available_industries(self) -> list[str]:
        if self.errors and "industries" in self.errors:
            raise self.errors["industries"]
        return self.industries or []


class TestStockDataRoutes:
    def test_get_all_stock_codes_success(self):
        provider = StaticProvider(codes=["600519", "000001", "000002"])

        with patch("app.routers.stock_data.get_screening_provider", return_value=provider):
            response = client.get("/api/stocks/codes")

        assert response.status_code == 200
        data = response.json()
        assert data["codes"] == ["600519", "000001", "000002"]
        assert data["total"] == 3

    def test_get_all_stock_codes_error(self):
        provider = StaticProvider(errors={"codes": Exception("provider down")})

        with patch("app.routers.stock_data.get_screening_provider", return_value=provider):
            response = client.get("/api/stocks/codes")

        assert response.status_code == 500
        assert "获取股票代码列表失败" in response.json()["detail"]

    def test_get_stocks_by_codes_success(self):
        provider = StaticProvider(
            batch=[
                {
                    "code": "600519",
                    "name": "贵州茅台",
                    "industry": "白酒",
                    "sector": "主板",
                    "roe": 0.28,
                    "pe": 35.5,
                    "pb": 10.2,
                    "eps": 50.3,
                    "revenue": 1275.5,
                    "netProfit": 620.8,
                    "debtRatio": 0.25,
                    "marketCap": 21000.0,
                    "floatMarketCap": 20500.0,
                    "dataDate": "2026-03-12",
                }
            ]
        )

        with patch("app.routers.stock_data.get_screening_provider", return_value=provider):
            response = client.post("/api/stocks/batch", json={"codes": ["600519"]})

        assert response.status_code == 200
        payload = response.json()
        assert len(payload) == 1
        assert payload[0]["code"] == "600519"
        assert payload[0]["name"] == "贵州茅台"

    def test_get_stocks_by_codes_falls_back_when_primary_provider_fails(self):
        primary = StaticProvider(
            provider_name="ifind",
            errors={"batch": Exception("ifind unavailable")},
        )
        fallback = StaticProvider(
            provider_name="akshare",
            batch=[
                {
                    "code": "600519",
                    "name": "贵州茅台",
                    "industry": "白酒",
                    "sector": "主板",
                    "roe": 0.28,
                    "pe": 35.5,
                    "pb": 10.2,
                    "eps": 50.3,
                    "revenue": 1275.5,
                    "netProfit": 620.8,
                    "debtRatio": 0.25,
                    "marketCap": 21000.0,
                    "floatMarketCap": 20500.0,
                    "dataDate": "2026-03-12",
                }
            ],
        )
        provider = FallbackScreeningProvider(primary=primary, fallback=fallback)

        with patch("app.routers.stock_data.get_screening_provider", return_value=provider):
            response = client.post("/api/stocks/batch", json={"codes": ["600519"]})

        assert response.status_code == 200
        payload = response.json()
        assert payload[0]["industry"] == "白酒"
        assert payload[0]["marketCap"] == 21000.0

    def test_get_stocks_by_codes_error_when_primary_and_fallback_fail(self):
        primary = StaticProvider(
            provider_name="ifind",
            errors={"batch": Exception("ifind unavailable")},
        )
        fallback = StaticProvider(
            provider_name="akshare",
            errors={"batch": Exception("akshare unavailable")},
        )
        provider = FallbackScreeningProvider(primary=primary, fallback=fallback)

        with patch("app.routers.stock_data.get_screening_provider", return_value=provider):
            response = client.post("/api/stocks/batch", json={"codes": ["600519"]})

        assert response.status_code == 500
        assert "批量查询股票数据失败" in response.json()["detail"]

    def test_get_stocks_by_codes_invalid_code(self):
        response = client.post("/api/stocks/batch", json={"codes": ["INVALID"]})

        assert response.status_code == 400
        assert "无效的股票代码格式" in response.json()["detail"]

    def test_get_stocks_by_codes_empty_list(self):
        response = client.post("/api/stocks/batch", json={"codes": []})

        assert response.status_code == 422

    def test_get_indicator_history_success(self):
        provider = StaticProvider(
            history=[
                {"date": "2022-12-31", "value": 1000.0, "isEstimated": False},
                {"date": "2023-12-31", "value": 1210.0, "isEstimated": False},
                {"date": "2024-12-31", "value": 1331.0, "isEstimated": False},
            ]
        )

        with patch("app.routers.stock_data.get_screening_provider", return_value=provider):
            response = client.get(
                "/api/stocks/600519/history",
                params={"indicator": "REVENUE", "years": 3},
            )

        assert response.status_code == 200
        payload = response.json()
        assert payload[0]["date"] == "2022-12-31"
        assert payload[-1]["value"] == 1331.0

    def test_get_indicator_history_invalid_code(self):
        response = client.get(
            "/api/stocks/INVALID/history",
            params={"indicator": "ROE", "years": 3},
        )

        assert response.status_code == 400
        assert "无效的股票代码格式" in response.json()["detail"]

    def test_get_indicator_history_invalid_indicator(self):
        response = client.get(
            "/api/stocks/600519/history",
            params={"indicator": "INVALID_INDICATOR", "years": 3},
        )

        assert response.status_code == 400
        assert "不支持的指标" in response.json()["detail"]

    def test_get_indicator_history_invalid_years(self):
        response = client.get(
            "/api/stocks/600519/history",
            params={"indicator": "ROE", "years": 20},
        )

        assert response.status_code == 422

    def test_get_available_industries_success(self):
        provider = StaticProvider(industries=["白酒", "银行", "医药"])

        with patch("app.routers.stock_data.get_screening_provider", return_value=provider):
            response = client.get("/api/stocks/industries")

        assert response.status_code == 200
        payload = response.json()
        assert payload["industries"] == ["白酒", "银行", "医药"]
        assert payload["total"] == 3

    def test_get_available_industries_error(self):
        provider = StaticProvider(errors={"industries": Exception("provider down")})

        with patch("app.routers.stock_data.get_screening_provider", return_value=provider):
            response = client.get("/api/stocks/industries")

        assert response.status_code == 500
        assert "获取行业列表失败" in response.json()["detail"]


class TestStockCodeValidation:
    def test_valid_stock_codes(self):
        from app.routers.stock_data import _is_valid_stock_code

        assert _is_valid_stock_code("600519") is True
        assert _is_valid_stock_code("000001") is True
        assert _is_valid_stock_code("300750") is True

    def test_invalid_stock_codes(self):
        from app.routers.stock_data import _is_valid_stock_code

        assert _is_valid_stock_code("12345") is False
        assert _is_valid_stock_code("1234567") is False
        assert _is_valid_stock_code("500001") is False
        assert _is_valid_stock_code("ABCDEF") is False
        assert _is_valid_stock_code("") is False
        assert _is_valid_stock_code(123456) is False

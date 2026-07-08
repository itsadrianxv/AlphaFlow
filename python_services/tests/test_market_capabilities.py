from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd
from fastapi.testclient import TestClient

import app.data_providers.tushare_provider as tushare_module
from app.data_providers import TushareProvider
from app.gateway.external_capability_gateway import ExternalCapabilityGateway
from app.main import app

client = TestClient(app)


@dataclass
class FakeMarketClient:
    calls: list[tuple[str, dict[str, object]]] = field(default_factory=list)

    def stock_basic(self, **kwargs):
        self.calls.append(("stock_basic", kwargs))
        return pd.DataFrame(
            {
                "ts_code": ["600519.SH"],
                "symbol": ["600519"],
                "name": ["贵州茅台"],
                "industry": ["白酒"],
            }
        )

    def daily_basic(self, **kwargs):
        self.calls.append(("daily_basic", kwargs))
        return pd.DataFrame(
            {
                "ts_code": ["600519.SH"],
                "trade_date": ["20260708"],
                "pe_ttm": [25.0],
                "pb": [8.0],
                "total_mv": [2_000_000.0],
            }
        )

    def margin(self, **kwargs):
        self.calls.append(("margin", kwargs))
        return pd.DataFrame({"trade_date": ["20260708"], "rzye": [100.0]})

    def margin_detail(self, **kwargs):
        self.calls.append(("margin_detail", kwargs))
        return pd.DataFrame({"trade_date": ["20260708"], "ts_code": ["600519.SH"], "rzye": [10.0]})

    def income(self, **kwargs):
        self.calls.append(("income", kwargs))
        return pd.DataFrame({"ts_code": ["600519.SH"], "end_date": ["20251231"], "total_revenue": [100.0]})

    def balancesheet(self, **kwargs):
        self.calls.append(("balancesheet", kwargs))
        return pd.DataFrame({"ts_code": ["600519.SH"], "end_date": ["20251231"], "total_assets": [200.0]})

    def cashflow(self, **kwargs):
        self.calls.append(("cashflow", kwargs))
        return pd.DataFrame({"ts_code": ["600519.SH"], "end_date": ["20251231"], "n_cashflow_act": [50.0]})

    def fund_basic(self, **kwargs):
        self.calls.append(("fund_basic", kwargs))
        return pd.DataFrame(
            {
                "ts_code": ["510300.SH"],
                "name": ["沪深300ETF"],
                "market": ["E"],
                "fund_type": ["股票型"],
            }
        )

    def fund_nav(self, **kwargs):
        self.calls.append(("fund_nav", kwargs))
        return pd.DataFrame(
            {
                "ts_code": ["510300.SH"],
                "nav_date": ["20260707"],
                "unit_nav": [4.0],
                "accum_nav": [4.0],
            }
        )

    def fund_daily(self, **kwargs):
        raise AssertionError("fund_daily should be skipped in 2000-credit mode")

    def fund_portfolio(self, **kwargs):
        raise AssertionError("fund_portfolio should be skipped in 2000-credit mode")


def test_market_capability_route_returns_standard_envelope(monkeypatch):
    fake_client = FakeMarketClient()
    monkeypatch.setenv("TUSHARE_TOKEN", "token-1")
    monkeypatch.setattr(tushare_module, "_create_tushare_client", lambda _token: fake_client)

    response = client.post(
        "/api/v1/capabilities/market/stock/daily-basic",
        json={"stockCode": "600519", "tradeDate": "20260708"},
        headers={"x-request-id": "req_market_daily_basic"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["traceId"] == "req_market_daily_basic"
    assert payload["meta"]["provider"] == "tushare"
    assert payload["meta"]["capability"] == "market"
    assert payload["meta"]["operation"] == "stock_daily_basic"
    assert payload["data"]["api"] == ["daily_basic"]
    assert payload["data"]["request"]["tsCode"] == "600519.SH"
    assert payload["data"]["rows"][0]["pe_ttm"] == 25.0


def test_market_tool_filters_include_and_uses_field_whitelist(monkeypatch):
    fake_client = FakeMarketClient()
    monkeypatch.setenv("TUSHARE_TOKEN", "token-1")
    monkeypatch.setattr(tushare_module, "_create_tushare_client", lambda _token: fake_client)

    result = TushareProvider().query_market_tool(
        "moneyflow",
        {
            "stockCode": "600519",
            "tradeDate": "20260708",
            "include": ["margin"],
        },
    )

    called_datasets = [name for name, _kwargs in fake_client.calls]
    assert called_datasets == ["stock_basic", "margin", "margin_detail"]
    assert result["api"] == ["margin", "margin_detail"]
    assert "fields" in fake_client.calls[-1][1]
    assert "rzye" in str(fake_client.calls[-1][1]["fields"])


def test_market_tool_filters_financial_statement(monkeypatch):
    fake_client = FakeMarketClient()
    monkeypatch.setenv("TUSHARE_TOKEN", "token-1")
    monkeypatch.setattr(tushare_module, "_create_tushare_client", lambda _token: fake_client)

    result = TushareProvider().query_market_tool(
        "financial_statements",
        {
            "stockCode": "600519",
            "startDate": "20250101",
            "endDate": "20251231",
            "statement": "income",
            "reportType": "1",
        },
    )

    called_datasets = [name for name, _kwargs in fake_client.calls]
    assert called_datasets == ["stock_basic", "income"]
    assert result["api"] == ["income"]
    assert result["rows"]["income"][0]["total_revenue"] == 100.0


def test_fund_market_skips_high_permission_apis_in_2000_credit_mode(monkeypatch):
    fake_client = FakeMarketClient()
    monkeypatch.setenv("TUSHARE_TOKEN", "token-1")
    monkeypatch.setattr(tushare_module, "_create_tushare_client", lambda _token: fake_client)

    result = TushareProvider().query_market_tool(
        "fund_market",
        {
            "fundCode": "510300.SH",
            "include": ["basic", "nav", "daily", "portfolio"],
        },
    )

    called_datasets = [name for name, _kwargs in fake_client.calls]
    assert called_datasets == ["fund_basic", "fund_nav"]
    assert result["api"] == ["fund_basic", "fund_nav"]
    assert result["diagnostics"]["skippedApis"] == ["fund_daily", "fund_portfolio"]
    assert any("fund_daily skipped" in warning for warning in result["warnings"])


def test_market_gateway_maps_unsupported_provider_to_capability_error(monkeypatch):
    class UnsupportedProvider:
        provider_name = "tushare"

    monkeypatch.setattr(
        "app.gateway.external_capability_gateway.get_default_data_provider",
        lambda: UnsupportedProvider(),
    )

    gateway = ExternalCapabilityGateway()
    try:
        gateway.query_market_data("req_market_unsupported", "stock_search", {"keyword": "茅台"})
    except Exception as exc:  # noqa: BLE001
        assert getattr(exc, "code") == "unsupported_market_provider"
        assert getattr(exc, "status_code") == 501
    else:
        raise AssertionError("expected unsupported provider error")


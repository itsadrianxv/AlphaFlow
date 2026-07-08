"""Tests for standardized v1 gateway endpoints and stale cache fallback."""

from __future__ import annotations

from fastapi.testclient import TestClient
from unittest.mock import patch

from app.gateway.common import build_cache_key, gateway_cache
from app.infrastructure.metrics.recorder import metrics_recorder
from app.main import app
from app.policies.cache_policy import CachePolicy

client = TestClient(app)


def setup_function() -> None:
    gateway_cache.clear()
    metrics_recorder.clear()


def test_get_v1_market_stock_codes_success() -> None:
    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_all_stock_codes",
        return_value=["600519", "000001"],
    ):
        response = client.get("/api/v1/market/stocks/codes")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["provider"] == "tushare"
    assert payload["data"]["codes"] == ["600519", "000001"]
    assert payload["data"]["total"] == 2


def test_get_v1_market_industries_success() -> None:
    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_available_industries",
        return_value=["白酒", "银行"],
    ):
        response = client.get("/api/v1/market/stocks/industries")

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["industries"] == ["白酒", "银行"]
    assert payload["data"]["total"] == 2


def test_get_v1_indicator_history_success() -> None:
    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_indicator_history",
        return_value=[
            {"date": "2023-12-31", "value": 1000.0, "isEstimated": False},
            {"date": "2024-12-31", "value": 1200.0, "isEstimated": False},
        ],
    ):
        response = client.get(
            "/api/v1/market/stocks/600519/history",
            params={"indicator": "REVENUE", "years": 2},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["stockCode"] == "600519"
    assert payload["data"]["indicator"] == "REVENUE"
    assert payload["data"]["points"][0]["date"] == "2023-12-31"


def test_get_v1_market_stock_success() -> None:
    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_stock_snapshot",
        return_value={
            "code": "600519",
            "name": "贵州茅台",
            "industry": "白酒",
            "sector": "主板",
            "marketCap": 21000.0,
            "floatMarketCap": 20500.0,
            "pe": 35.5,
            "pb": 10.2,
            "roe": 0.28,
            "dataDate": "2026-03-08",
        },
    ):
        response = client.get("/api/v1/market/stocks/600519")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["provider"] == "tushare"
    assert payload["meta"]["cacheHit"] is False
    assert payload["data"]["stockCode"] == "600519"
    assert payload["data"]["exchange"] == "SSE"
    assert payload["data"]["stockName"] == "贵州茅台"
    assert payload["data"]["sector"] == "主板"


def test_get_v1_market_batch_reports_partial_errors() -> None:
    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_stock_batch",
        return_value=[
            {
                "code": "600519",
                "name": "贵州茅台",
                "industry": "白酒",
                "sector": "主板",
                "dataDate": "2026-03-08",
            }
        ],
    ):
        response = client.post(
            "/api/v1/market/stocks/batch",
            json={"stockCodes": ["600519", "000001"]},
        )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["data"]["items"]) == 1
    assert payload["data"]["items"][0]["stockCode"] == "600519"
    assert len(payload["data"]["errors"]) == 1
    assert payload["data"]["errors"][0]["stockCode"] == "000001"
    assert any(
        warning["code"] == "partial_results" for warning in payload["meta"]["warnings"]
    )


def test_get_v1_theme_news_success() -> None:
    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_theme_news",
        return_value=[
            {
                "id": "ai-1",
                "title": "AI 算力需求提升",
                "summary": "产业链景气度持续改善。",
                "source": "tushare:news",
                "publishedAt": "2026-03-08T08:00:00+00:00",
                "sentiment": "positive",
                "relevanceScore": 0.92,
                "relatedStocks": ["603019"],
            }
        ],
    ):
        response = client.get("/api/v1/intelligence/themes/AI/news")

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["theme"] == "AI"
    assert payload["data"]["newsItems"][0]["id"] == "ai-1"


def test_get_v1_stock_research_pack_success() -> None:
    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_stock_research_pack",
        return_value={
            "stockCode": "600519",
            "companyName": "贵州茅台",
            "concept": "白酒",
            "financialHighlights": ["总市值: 20000.00亿元"],
            "referenceItems": [
                {
                    "id": "pack-1",
                    "title": "财务快照",
                    "sourceName": "tushare:financial_snapshot",
                    "snippet": "结构化财务指标摘要",
                    "extractedFact": "总市值: 20000.00亿元",
                    "sourceType": "financial",
                }
            ],
            "summaryNotes": ["用于补强财务口径"],
        },
    ):
        response = client.get("/api/v1/intelligence/stocks/600519/research-pack")

    assert response.status_code == 200
    payload = response.json()
    assert payload["data"]["stockCode"] == "600519"
    assert payload["data"]["researchPack"]["referenceItems"][0]["id"] == "pack-1"


def test_market_gateway_uses_stale_cache_when_provider_fails() -> None:
    cache_key = build_cache_key(
        dataset="stock_snapshot",
        provider="tushare",
        params={"stockCode": "600519"},
    )
    gateway_cache.set(
        key=cache_key,
        value={
            "stockCode": "600519",
            "exchange": "SSE",
            "market": "CN-A",
            "securityType": "equity",
            "stockName": "贵州茅台",
            "industry": "白酒",
            "sector": "主板",
            "concepts": [],
            "marketCap": 21000.0,
            "floatMarketCap": 20500.0,
            "turnoverRate": None,
            "changePercent": None,
            "pe": 35.5,
            "pb": 10.2,
            "roe": 0.28,
            "eps": None,
            "revenue": None,
            "netProfit": None,
            "debtRatio": None,
            "asOf": "2026-03-08",
            "provider": "tushare",
        },
        policy=CachePolicy(fresh_ttl_seconds=0, stale_ttl_seconds=120),
        as_of="2026-03-08T08:00:00+00:00",
    )

    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_stock_snapshot",
        side_effect=Exception("provider down"),
    ):
        response = client.get("/api/v1/market/stocks/600519")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["cacheHit"] is True
    assert payload["meta"]["isStale"] is True
    assert payload["data"]["stockCode"] == "600519"
    assert any(
        warning["code"] == "stale_cache" for warning in payload["meta"]["warnings"]
    )


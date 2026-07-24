"""Minishare news provider tests."""

from __future__ import annotations

from unittest.mock import patch

import httpx
import pytest

from app.gateway.common import GatewayError
from app.providers.minishare.news import MinishareNewsProvider, NewsQuery


def _provider() -> MinishareNewsProvider:
    return MinishareNewsProvider(token="minishare-token", deepseek_api_key="deepseek-token")


def test_requires_minishare_token() -> None:
    provider = MinishareNewsProvider(token="", deepseek_api_key="deepseek-token")
    with pytest.raises(GatewayError, match="MINISHARE_TOKEN"):
        provider.get_news(NewsQuery(scope="theme", target="AI", days=7, limit=5, terms=("AI",)))


def test_recall_and_deepseek_enrichment_produces_standard_news() -> None:
    provider = _provider()
    candidates = [
        {
            "id": "stable-1",
            "content": "AI 算力需求提升，相关公司扩产。",
            "publishedAt": "2026-07-24T10:00:00+08:00",
            "matchedTerms": ["AI"],
            "initialRelevanceScore": 0.61,
        }
    ]
    response = httpx.Response(
        200,
        json={
            "choices": [
                {
                    "message": {
                        "content": '{"items":[{"id":"stable-1","title":"AI算力需求提升","summary":"产业链扩产","sentiment":"positive","relevanceScore":0.91,"relatedStocks":["603019"],"eventType":"资本开支","matchReason":"命中AI"}]}'
                    }
                }
            ]
        },
    )
    with patch("app.providers.minishare.news.httpx.post", return_value=response):
        items = provider._enrich(candidates, NewsQuery(scope="theme", target="AI", days=7, limit=5, terms=("AI",)))

    assert items[0]["source"] == "minishare:news"
    assert items[0]["scopeTags"] == ["theme"]
    assert items[0]["relatedStocks"] == ["603019"]
    assert items[0]["eventType"] == "资本开支"


def test_deepseek_failure_is_strict() -> None:
    provider = _provider()
    with patch("app.providers.minishare.news.httpx.post", side_effect=httpx.ConnectError("offline")):
        with pytest.raises(GatewayError, match="新闻重排失败"):
            provider._enrich(
                [{"id": "n1", "content": "AI", "publishedAt": "2026-07-24T10:00:00+08:00", "matchedTerms": ["AI"]}],
                NewsQuery(scope="theme", target="AI", days=7, limit=5, terms=("AI",)),
            )


def test_company_scope_keeps_requested_stock_code() -> None:
    provider = _provider()
    response = httpx.Response(
        200,
        json={"choices": [{"message": {"content": '{"items":[{"id":"n1","title":"公司新闻","summary":"摘要","sentiment":"neutral","relevanceScore":0.8,"relatedStocks":[],"eventType":"订单","matchReason":"公司名称命中"}]}'}}]},
    )
    candidate = {"id": "n1", "content": "公司新闻", "publishedAt": "2026-07-24T10:00:00+08:00", "matchedTerms": ["公司"]}
    with patch("app.providers.minishare.news.httpx.post", return_value=response):
        items = provider._enrich([candidate], NewsQuery(scope="company", target="测试公司", days=7, limit=5, terms=("测试公司",), related_stocks=("600519",)))
    assert items[0]["relatedStocks"] == ["600519"]

"""Minishare 三源新闻管线测试。"""

from __future__ import annotations

from datetime import datetime
import json
from unittest.mock import Mock, patch
from zoneinfo import ZoneInfo

import httpx
import pandas as pd
import pytest

from app.gateway.common import GatewayError
from app.providers.minishare.client import MinishareNewsClient, RawNewsRecord
from app.providers.minishare.news import MinishareNewsProvider, NewsQuery, RadarCompany

_SHANGHAI = ZoneInfo("Asia/Shanghai")


def _raw(kind: str, *, content: str, title: str = "测试新闻") -> RawNewsRecord:
    return RawNewsRecord(
        sourceKind=kind,
        sourceName=f"source:{kind}",
        url="https://example.com/news" if kind == "major" else None,
        title=title,
        content=content,
        publishedAt="2026-07-24T10:00:00+08:00",
        contentHash=f"hash-{kind}-{len(content)}",
        sourceItemId=f"source-{kind}-{len(content)}",
    )


def _provider(client: Mock | None = None, api_key: str = "deepseek-token"):
    return MinishareNewsProvider(
        token="minishare-token",
        deepseek_api_key=api_key,
        client=client,
    )


def test_requires_minishare_token() -> None:
    provider = MinishareNewsProvider(token="", deepseek_api_key="deepseek-token")
    with pytest.raises(GatewayError, match="MINISHARE_TOKEN"):
        provider.get_news(
            NewsQuery(scope="theme", target="AI", days=7, limit=5, terms=("AI",))
        )


def test_low_level_client_normalizes_three_sources() -> None:
    client = MinishareNewsClient("token")
    frames = {
        "news": pd.DataFrame(
            [{"datetime": "2026-07-24 10:00:00", "content": "AI 快讯正文"}]
        ),
        "major_news": pd.DataFrame(
            [
                {
                    "title": "AI 长新闻",
                    "pub_time": "2026-07-24 09:00:00",
                    "src": "测试媒体",
                    "url": "https://example.com/major",
                    "content": "完整长新闻正文",
                }
            ]
        ),
        "cctv_news": pd.DataFrame(
            [{"date": "20260723", "title": "联播标题", "content": "联播正文"}]
        ),
    }
    with patch.object(client, "_call", side_effect=lambda method, **_: frames[method]):
        start = datetime(2026, 7, 23, tzinfo=_SHANGHAI)
        end = datetime(2026, 7, 24, tzinfo=_SHANGHAI)
        fast = client.fetch_fast_news(start, end)
        major = client.fetch_major_news(start, end)
        cctv = client.fetch_cctv_news("20260723")

    assert fast[0].sourceKind == "fast"
    assert major[0].content == "完整长新闻正文"
    assert major[0].url == "https://example.com/major"
    assert cctv[0].sourceName == "CCTV 新闻联播"


def test_daily_raw_returns_partial_records_and_source_status() -> None:
    client = Mock()
    client.fetch_fast_news.return_value = [_raw("fast", content="当天快讯")]
    client.fetch_major_news.return_value = [_raw("major", content="当天要闻")]
    client.fetch_cctv_news.side_effect = RuntimeError("cctv offline")
    provider = _provider(client=client, api_key="")

    result = provider.get_daily_raw(datetime(2026, 7, 24, tzinfo=_SHANGHAI))

    assert result.source_status == {"fast": True, "major": True, "cctv": False}
    assert len(result.items) == 2
    assert result.items[0]["sourceItemId"]
    assert result.warnings[0].code == "minishare_cctv_partial"


def test_resolve_radar_uses_persisted_raw_items_without_fetching_sources() -> None:
    provider = _provider(client=Mock(), api_key="")
    raw = _raw("major", content="中科曙光扩大算力资本开支", title="算力扩产").to_dict()

    result = provider.resolve_radar(
        raw_items=[raw],
        companies=(RadarCompany("603019", "中科曙光"),),
        industries=(),
        days=1,
        limit=10,
    )

    assert result.items[0]["content"] == raw["content"]
    assert result.items[0]["analysisStatus"] == "partial"


def test_source_strategy_matches_scope() -> None:
    assert MinishareNewsProvider._source_kinds("company") == ("fast", "major")
    assert MinishareNewsProvider._source_kinds("industry") == ("fast", "major")
    assert MinishareNewsProvider._source_kinds("theme") == ("fast", "major")
    assert MinishareNewsProvider._source_kinds("macro") == (
        "fast",
        "major",
        "cctv",
    )


def test_major_news_full_content_reaches_attribution_and_rerank() -> None:
    full_content = "长新闻全文-" + "正文" * 4000
    client = Mock()
    client.fetch_fast_news.return_value = []
    client.fetch_major_news.return_value = [
        _raw("major", content=full_content, title="AI 资本开支")
    ]
    provider = _provider(client)
    responses = [
        httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": '{"items":[{"id":"source-major-8006","attributions":[],"relatedStocks":[],"scopeTags":["industry"]}]}'
                        }
                    }
                ]
            },
        ),
        httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": '{"items":[{"id":"source-major-8006","title":"资本开支","summary":"扩产","sentiment":"positive","relevanceScore":0.9,"eventType":"资本开支","matchReason":"AI相关"}]}'
                        }
                    }
                ]
            },
        ),
    ]
    captured: list[dict] = []

    def fake_post(*_args, **kwargs):
        captured.append(json.loads(kwargs["json"]["messages"][1]["content"]))
        return responses[len(captured) - 1]

    with patch("app.providers.minishare.news.httpx.post", side_effect=fake_post):
        result = provider.get_news_result(
            NewsQuery(scope="industry", target="AI", days=2, limit=5, terms=("AI",))
        )

    assert len(captured) == 2
    assert captured[0]["candidates"][0]["content"] == full_content
    assert captured[1]["candidates"][0]["content"] == full_content
    assert result.items[0]["content"] == full_content
    assert result.items[0]["sourceKind"] == "major"


def test_cross_source_dedupe_prefers_major_and_preserves_sources() -> None:
    provider = _provider()
    content = "央行宣布调整利率政策，市场流动性预期变化。"
    fast = _raw("fast", content=content, title="央行调整利率")
    major = _raw("major", content=content, title="央行调整利率政策")
    items = provider._recall(
        [fast, major],
        NewsQuery(scope="macro", target="宏观", days=1, limit=10),
    )
    deduped = provider._dedupe(items)

    assert len(deduped) == 1
    assert deduped[0]["sourceKind"] == "major"
    assert {item["sourceKind"] for item in deduped[0]["sourceRefs"]} == {
        "fast",
        "major",
    }


def test_model_failure_returns_partial_evidence() -> None:
    provider = _provider(api_key="")
    source = _raw("fast", content="AI 算力需求提升")
    result = provider._analyze_and_standardize(
        provider._dedupe(
            provider._recall(
                [source],
                NewsQuery(scope="theme", target="AI", days=1, limit=5, terms=("AI",)),
            )
        ),
        query=NewsQuery(scope="theme", target="AI", days=1, limit=5, terms=("AI",)),
        warnings=[],
    )

    assert result.items[0]["analysisStatus"] == "partial"
    assert "news_model_not_configured" in result.items[0]["warnings"]


def test_single_source_failure_is_partial_but_all_sources_fail() -> None:
    client = Mock()
    client.fetch_fast_news.side_effect = RuntimeError("fast offline")
    client.fetch_major_news.return_value = [_raw("major", content="AI 行业扩产")]
    partial = _provider(client, api_key="").get_news_result(
        NewsQuery(scope="industry", target="AI", days=1, limit=5, terms=("AI",))
    )
    assert partial.items
    assert partial.warnings[0].code == "minishare_fast_partial"

    failed_client = Mock()
    failed_client.fetch_fast_news.side_effect = RuntimeError("offline")
    failed_client.fetch_major_news.side_effect = RuntimeError("offline")
    with pytest.raises(GatewayError, match="全部不可用"):
        _provider(failed_client).get_news_result(
            NewsQuery(scope="company", target="测试", days=1, limit=5, terms=("测试",))
        )

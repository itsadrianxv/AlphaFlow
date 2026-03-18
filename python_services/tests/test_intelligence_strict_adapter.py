from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pandas as pd
import pytest

from app.services import intelligence_data_adapter as adapter_module
from app.services.akshare_adapter import AkShareAdapter
from app.services.intelligence_data_adapter import IntelligenceDataAdapter


def setup_function() -> None:
    adapter_module._CACHE.clear()
    AkShareAdapter.clear_caches()


def _concept_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "板块名称": ["AI compute"],
            "板块代码": ["BK001"],
            "涨跌幅": [2.1],
        }
    )


def _constituents_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "代码": ["300308"],
            "名称": ["Test Corp"],
            "涨跌幅": [3.2],
            "换手率": [4.8],
            "市盈率": [29.0],
        }
    )


def test_get_candidates_strict_raises_when_no_theme_specific_candidates():
    with (
        patch(
            "app.services.intelligence_data_adapter.AkShareAdapter.get_concept_catalog_frame",
            return_value=_concept_df(),
        ),
        patch(
            "app.services.intelligence_data_adapter.AkShareAdapter.get_concept_constituents_frame",
            side_effect=Exception("upstream down"),
        ),
        patch(
            "app.services.intelligence_data_adapter._build_candidates_from_spot",
            return_value=[],
        ) as mock_spot_fallback,
        patch(
            "app.services.intelligence_data_adapter._RULES_REGISTRY.get_rules",
            return_value={"theme": "AI", "whitelist": [], "blacklist": [], "aliases": []},
        ),
        patch(
            "app.services.intelligence_data_adapter._ZHIPU_SEARCH_CLIENT.search_theme_concepts",
            return_value=[],
        ),
    ):
        with pytest.raises(ValueError):
            IntelligenceDataAdapter.get_candidates_strict(theme="AI", limit=5)

    mock_spot_fallback.assert_not_called()


def test_get_candidates_strict_uses_local_catalog_snapshot():
    with (
        patch(
            "app.services.intelligence_data_adapter.AkShareAdapter.get_concept_catalog_frame",
            return_value=_concept_df(),
        ),
        patch(
            "app.services.intelligence_data_adapter.AkShareAdapter.get_concept_constituents_frame",
            return_value=_constituents_df(),
        ),
        patch(
            "app.services.akshare_adapter.ak.stock_board_concept_name_ths",
            side_effect=AssertionError("live THS concept catalog should not be called"),
        ),
        patch(
            "app.services.intelligence_data_adapter._RULES_REGISTRY.get_rules",
            return_value={"theme": "AI", "whitelist": [], "blacklist": [], "aliases": []},
        ),
        patch(
            "app.services.intelligence_data_adapter._ZHIPU_SEARCH_CLIENT.search_theme_concepts",
            return_value=[
                {
                    "name": "AI compute",
                    "code": "BK001",
                    "aliases": [],
                    "confidence": 0.91,
                    "reason": "local snapshot path",
                    "source": "zhipu_web_search",
                }
            ],
        ) as mock_zhipu,
    ):
        payload = IntelligenceDataAdapter.get_candidates_strict(theme="AI", limit=5)

    assert len(payload) == 1
    assert payload[0]["stockCode"] == "300308"
    mock_zhipu.assert_not_called()


@patch("app.services.intelligence_data_adapter._fetch_candidates_from_akshare")
@patch("app.services.intelligence_data_adapter.ak.stock_news_em")
def test_get_theme_news_strict_filters_by_days(mock_stock_news, mock_candidates):
    now = datetime.now(UTC)
    recent = (now - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
    stale = (now - timedelta(days=20)).strftime("%Y-%m-%d %H:%M:%S")

    mock_candidates.return_value = [
        {
            "stockCode": "603019",
            "stockName": "Test Corp",
            "reason": "Test reason",
            "heat": 80,
            "concept": "AI compute",
        }
    ]
    mock_stock_news.return_value = pd.DataFrame(
        {
            "title": ["Recent news", "Stale news"],
            "content": ["Recent summary", "Stale summary"],
            "date": [recent, stale],
            "source": ["test-source", "test-source"],
            "url": ["https://example.com/recent", "https://example.com/stale"],
        }
    )

    payload = IntelligenceDataAdapter.get_theme_news_strict(theme="AI", days=7, limit=10)

    assert len(payload) == 1
    assert payload[0]["title"] == "Recent news"


@patch("app.services.intelligence_data_adapter._fetch_theme_news_from_akshare")
def test_get_theme_news_strict_falls_back_to_mock_news_on_empty_result(
    mock_fetch_theme_news,
):
    mock_fetch_theme_news.return_value = []

    theme = "chip equipment import substitution, key milestones?"
    payload = IntelligenceDataAdapter.get_theme_news_strict(
        theme=theme,
        days=7,
        limit=3,
    )

    assert len(payload) == 3
    assert all(item["source"] == "intelligence-fallback" for item in payload)
    assert all(theme in item["title"] for item in payload)


@patch("app.services.intelligence_data_adapter.AkShareAdapter.get_stocks_by_codes")
def test_get_company_evidence_strict_raises_without_snapshot(mock_get_stocks_by_codes):
    mock_get_stocks_by_codes.side_effect = ValueError("spot unavailable")

    with pytest.raises(ValueError, match="spot unavailable"):
        IntelligenceDataAdapter.get_company_evidence_strict("603019", "AI")


@patch("app.services.intelligence_data_adapter._fetch_stock_news", return_value=[])
@patch("app.services.intelligence_data_adapter.AkShareAdapter.get_stocks_by_codes")
def test_get_company_evidence_strict_returns_partial_metadata(
    mock_get_stocks_by_codes,
    _mock_news,
):
    mock_get_stocks_by_codes.return_value = [
        {
            "code": "603019",
            "name": "中科曙光",
            "industry": "算力",
            "changePercent": None,
            "turnoverRate": None,
            "pe": None,
            "marketCap": None,
            "dataQuality": "partial",
            "warnings": ["spot_snapshot_partial"],
        }
    ]

    payload = IntelligenceDataAdapter.get_company_evidence_strict("603019", "AI")

    assert payload["companyName"] == "中科曙光"
    assert payload["dataQuality"] == "partial"
    assert payload["warnings"] == ["spot_snapshot_partial"]


@patch("app.services.intelligence_data_adapter._fetch_stock_news", return_value=[])
@patch("app.services.intelligence_data_adapter.AkShareAdapter.get_stocks_by_codes")
def test_get_company_research_pack_strict_returns_partial_payload(
    mock_get_stocks_by_codes,
    _mock_news,
):
    mock_get_stocks_by_codes.return_value = [
        {
            "code": "603019",
            "name": "中科曙光",
            "industry": "算力",
            "changePercent": None,
            "turnoverRate": None,
            "pe": None,
            "marketCap": None,
            "floatMarketCap": None,
            "pb": None,
            "roe": None,
            "dataQuality": "partial",
            "warnings": ["spot_snapshot_partial"],
        }
    ]

    payload = IntelligenceDataAdapter.get_company_research_pack_strict("603019", "AI")

    assert payload["companyName"] == "中科曙光"
    assert payload["dataQuality"] == "partial"
    assert payload["warnings"] == ["spot_snapshot_partial"]

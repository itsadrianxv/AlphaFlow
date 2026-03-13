"""Concept matching service tests."""

from unittest.mock import patch

import pandas as pd

from app.services.intelligence_data_adapter import IntelligenceDataAdapter


def _build_mock_concept_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "板块名称": ["算力租赁", "CPO概念", "光模块"],
            "板块代码": ["BK001", "BK002", "BK003"],
            "涨跌幅": [2.1, 1.1, 0.6],
            "领涨股票": ["中科曙光", "天孚通信", "新易盛"],
            "上涨家数": [12, 8, 6],
            "下跌家数": [3, 4, 5],
        }
    )


def test_whitelist_has_higher_priority_than_zhipu():
    mock_rules = {
        "theme": "算力",
        "whitelist": ["算力租赁"],
        "blacklist": [],
        "aliases": [],
        "updatedAt": "2026-03-07T00:00:00+00:00",
    }
    zhipu_payload = [
        {
            "name": "CPO概念",
            "code": "BK002",
            "aliases": [],
            "confidence": 0.9,
            "reason": "搜索结果匹配",
            "source": "zhipu_web_search",
        }
    ]

    with (
        patch(
            "app.services.intelligence_data_adapter.ak.stock_board_concept_name_em",
            return_value=_build_mock_concept_df(),
        ),
        patch(
            "app.services.intelligence_data_adapter._RULES_REGISTRY.get_rules",
            return_value=mock_rules,
        ),
        patch(
            "app.services.intelligence_data_adapter._ZHIPU_SEARCH_CLIENT.search_theme_concepts",
            return_value=zhipu_payload,
        ),
    ):
        result = IntelligenceDataAdapter.match_theme_concepts(theme="算力", limit=3)

    assert result["matchedBy"] == "whitelist"
    assert result["concepts"][0]["name"] == "算力租赁"


def test_blacklist_filters_out_forced_concepts():
    mock_rules = {
        "theme": "算力",
        "whitelist": ["算力租赁", "CPO概念"],
        "blacklist": ["算力租赁"],
        "aliases": [],
        "updatedAt": "2026-03-07T00:00:00+00:00",
    }

    with (
        patch(
            "app.services.intelligence_data_adapter.ak.stock_board_concept_name_em",
            return_value=_build_mock_concept_df(),
        ),
        patch(
            "app.services.intelligence_data_adapter._RULES_REGISTRY.get_rules",
            return_value=mock_rules,
        ),
        patch(
            "app.services.intelligence_data_adapter._ZHIPU_SEARCH_CLIENT.search_theme_concepts",
            return_value=[],
        ),
    ):
        result = IntelligenceDataAdapter.match_theme_concepts(theme="算力", limit=3)

    concept_names = [item["name"] for item in result["concepts"]]
    assert "算力租赁" not in concept_names
    assert "CPO概念" in concept_names


def test_fallback_to_auto_when_zhipu_returns_empty():
    mock_rules = {
        "theme": "算力",
        "whitelist": [],
        "blacklist": [],
        "aliases": [],
        "updatedAt": "2026-03-07T00:00:00+00:00",
    }

    with (
        patch(
            "app.services.intelligence_data_adapter.ak.stock_board_concept_name_em",
            return_value=_build_mock_concept_df(),
        ),
        patch(
            "app.services.intelligence_data_adapter._RULES_REGISTRY.get_rules",
            return_value=mock_rules,
        ),
        patch(
            "app.services.intelligence_data_adapter._ZHIPU_SEARCH_CLIENT.search_theme_concepts",
            return_value=[],
        ),
    ):
        result = IntelligenceDataAdapter.match_theme_concepts(theme="算力", limit=2)

    assert result["matchedBy"] == "auto"
    assert len(result["concepts"]) == 1
    assert result["concepts"][0]["name"] == "算力租赁"
    assert all(item["source"] == "auto" for item in result["concepts"])

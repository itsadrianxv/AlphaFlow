"""Concept matching service tests."""

from unittest.mock import patch

import pandas as pd

from app.services.intelligence_data_adapter import IntelligenceDataAdapter


def _build_mock_concept_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "name": [
                "东数西算(算力)",
                "算力租赁",
                "AI PC",
                "AI手机",
                "AI语料",
                "机器人概念",
            ],
            "code": ["BK001", "BK002", "BK003", "BK004", "BK005", "BK006"],
        }
    )


def test_whitelist_long_query_has_higher_priority_than_zhipu():
    long_query = "AI 算力基础设施的盈利兑现节奏，应该看哪些领先指标？"
    mock_rules = {
        "theme": "算力",
        "whitelist": ["东数西算(算力)", "算力租赁"],
        "blacklist": [],
        "aliases": ["算力基础设施", "ai算力基础设施"],
        "updatedAt": "2026-03-18T00:00:00+00:00",
    }

    with (
        patch(
            "app.services.intelligence_data_adapter.AkShareAdapter.get_concept_catalog_frame",
            return_value=_build_mock_concept_df(),
        ),
        patch(
            "app.services.intelligence_data_adapter._RULES_REGISTRY.get_rules",
            return_value=mock_rules,
        ),
        patch(
            "app.services.intelligence_data_adapter._ZHIPU_SEARCH_CLIENT.search_theme_concepts",
        ) as mock_zhipu,
    ):
        result = IntelligenceDataAdapter.match_theme_concepts(theme=long_query, limit=3)

    assert result["matchedBy"] == "whitelist"
    assert [item["name"] for item in result["concepts"]] == ["东数西算(算力)", "算力租赁"]
    mock_zhipu.assert_not_called()


def test_blacklist_filters_out_forced_concepts():
    mock_rules = {
        "theme": "算力",
        "whitelist": ["算力租赁", "AI手机"],
        "blacklist": ["AI手机"],
        "aliases": [],
        "updatedAt": "2026-03-07T00:00:00+00:00",
    }

    with (
        patch(
            "app.services.intelligence_data_adapter.AkShareAdapter.get_concept_catalog_frame",
            return_value=_build_mock_concept_df(),
        ),
        patch(
            "app.services.intelligence_data_adapter._RULES_REGISTRY.get_rules",
            return_value=mock_rules,
        ),
        patch(
            "app.services.intelligence_data_adapter._ZHIPU_SEARCH_CLIENT.search_theme_concepts",
        ) as mock_zhipu,
    ):
        result = IntelligenceDataAdapter.match_theme_concepts(theme="算力", limit=3)

    concept_names = [item["name"] for item in result["concepts"]]
    assert "AI手机" not in concept_names
    assert "算力租赁" in concept_names
    mock_zhipu.assert_not_called()


def test_auto_prefers_specific_concept_substrings_before_generic_ai():
    long_query = "AI 算力基础设施的盈利兑现节奏，应该看哪些领先指标？"
    mock_rules = {
        "theme": long_query,
        "whitelist": [],
        "blacklist": [],
        "aliases": [],
        "updatedAt": None,
    }

    with (
        patch(
            "app.services.intelligence_data_adapter.AkShareAdapter.get_concept_catalog_frame",
            return_value=_build_mock_concept_df(),
        ),
        patch(
            "app.services.intelligence_data_adapter._RULES_REGISTRY.get_rules",
            return_value=mock_rules,
        ),
        patch(
            "app.services.intelligence_data_adapter._ZHIPU_SEARCH_CLIENT.search_theme_concepts",
        ) as mock_zhipu,
    ):
        result = IntelligenceDataAdapter.match_theme_concepts(theme=long_query, limit=3)

    concept_names = [item["name"] for item in result["concepts"]]
    assert result["matchedBy"] == "auto"
    assert concept_names[0] == "东数西算(算力)"
    assert "AI PC" not in concept_names
    assert "AI手机" not in concept_names
    assert "AI语料" not in concept_names
    mock_zhipu.assert_not_called()


def test_auto_allows_generic_ai_only_query():
    mock_rules = {
        "theme": "AI",
        "whitelist": [],
        "blacklist": [],
        "aliases": [],
        "updatedAt": None,
    }

    with (
        patch(
            "app.services.intelligence_data_adapter.AkShareAdapter.get_concept_catalog_frame",
            return_value=_build_mock_concept_df(),
        ),
        patch(
            "app.services.intelligence_data_adapter._RULES_REGISTRY.get_rules",
            return_value=mock_rules,
        ),
        patch(
            "app.services.intelligence_data_adapter._ZHIPU_SEARCH_CLIENT.search_theme_concepts",
        ) as mock_zhipu,
    ):
        result = IntelligenceDataAdapter.match_theme_concepts(theme="AI", limit=3)

    concept_names = [item["name"] for item in result["concepts"]]
    assert result["matchedBy"] == "auto"
    assert concept_names == ["AI PC", "AI手机", "AI语料"]
    mock_zhipu.assert_not_called()


def test_zhipu_runs_only_when_local_matches_are_unavailable():
    mock_rules = {
        "theme": "边缘主题",
        "whitelist": [],
        "blacklist": [],
        "aliases": [],
        "updatedAt": None,
    }
    zhipu_payload = [
        {
            "name": "机器人概念",
            "code": "SHOULD_NOT_BE_USED",
            "aliases": ["机器人产业链"],
            "confidence": 0.9,
            "reason": "搜索结果匹配",
            "source": "zhipu_web_search",
        }
    ]

    with (
        patch(
            "app.services.intelligence_data_adapter.AkShareAdapter.get_concept_catalog_frame",
            return_value=_build_mock_concept_df(),
        ),
        patch(
            "app.services.intelligence_data_adapter._RULES_REGISTRY.get_rules",
            return_value=mock_rules,
        ),
        patch(
            "app.services.intelligence_data_adapter._ZHIPU_SEARCH_CLIENT.search_theme_concepts",
            return_value=zhipu_payload,
        ) as mock_zhipu,
    ):
        result = IntelligenceDataAdapter.match_theme_concepts(theme="边缘主题", limit=2)

    assert result["matchedBy"] == "zhipu"
    assert result["concepts"][0]["name"] == "机器人概念"
    assert result["concepts"][0]["code"] == "BK006"
    mock_zhipu.assert_called_once()

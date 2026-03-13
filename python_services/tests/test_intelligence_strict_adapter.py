from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pandas as pd
import pytest

from app.services import intelligence_data_adapter as adapter_module
from app.services.intelligence_data_adapter import IntelligenceDataAdapter


def setup_function() -> None:
    adapter_module._CACHE.clear()
    adapter_module._SPOT_CACHE = None


def _concept_df() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "板块名称": ["算力租赁"],
            "板块代码": ["BK001"],
            "涨跌幅": [2.1],
            "领涨股票": ["中科曙光"],
            "上涨家数": [10],
            "下跌家数": [2],
        }
    )


def test_get_candidates_strict_raises_when_no_theme_specific_candidates():
    with (
        patch(
            "app.services.intelligence_data_adapter.ak.stock_board_concept_name_em",
            return_value=_concept_df(),
        ),
        patch(
            "app.services.intelligence_data_adapter.ak.stock_board_concept_cons_em",
            side_effect=Exception("upstream down"),
        ),
        patch(
            "app.services.intelligence_data_adapter._RULES_REGISTRY.get_rules",
            return_value={"theme": "算力", "whitelist": [], "blacklist": [], "aliases": []},
        ),
        patch(
            "app.services.intelligence_data_adapter._ZHIPU_SEARCH_CLIENT.search_theme_concepts",
            return_value=[],
        ),
    ):
        with pytest.raises(ValueError, match="暂无可用候选股数据"):
            IntelligenceDataAdapter.get_candidates_strict(theme="算力", limit=5)


@patch("app.services.intelligence_data_adapter._fetch_candidates_from_akshare")
@patch("app.services.intelligence_data_adapter.ak.stock_news_em")
def test_get_theme_news_strict_filters_by_days(mock_stock_news, mock_candidates):
    now = datetime.now(UTC)
    recent = (now - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
    stale = (now - timedelta(days=20)).strftime("%Y-%m-%d %H:%M:%S")

    mock_candidates.return_value = [
        {
            "stockCode": "603019",
            "stockName": "中科曙光",
            "reason": "测试原因",
            "heat": 80,
            "concept": "算力租赁",
        }
    ]
    mock_stock_news.return_value = pd.DataFrame(
        {
            "新闻标题": ["近期新闻", "过期新闻"],
            "新闻内容": ["近期摘要", "过期摘要"],
            "发布时间": [recent, stale],
            "文章来源": ["测试源", "测试源"],
            "新闻链接": ["https://example.com/recent", "https://example.com/stale"],
        }
    )

    payload = IntelligenceDataAdapter.get_theme_news_strict(theme="算力", days=7, limit=10)

    assert len(payload) == 1
    assert payload[0]["title"] == "近期新闻"


@patch("app.services.intelligence_data_adapter._get_spot_snapshot")
def test_get_company_evidence_strict_raises_without_mock_fallback(mock_spot_snapshot):
    mock_spot_snapshot.side_effect = ValueError("spot unavailable")

    with pytest.raises(ValueError, match="spot unavailable"):
        IntelligenceDataAdapter.get_company_evidence_strict("603019", "算力")

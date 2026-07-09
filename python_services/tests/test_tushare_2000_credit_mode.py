import pandas as pd
import pytest

import app.providers.tushare.client as tushare_client_module
from app.providers.tushare.client import TushareProviderClient
from app.services.theme_concept_rules_registry import ThemeConceptRulesRegistry


@pytest.fixture(autouse=True)
def isolate_theme_rules(tmp_path, monkeypatch):
    registry = ThemeConceptRulesRegistry(file_path=str(tmp_path / "theme_concept_rules.json"))
    monkeypatch.setattr(tushare_client_module, "_RULES_REGISTRY", registry)


class FakeTushareRawProvider:
    provider_name = "tushare"

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, str]]] = []

    def get_raw_frame(self, dataset: str, **params: str) -> pd.DataFrame:
        self.calls.append((dataset, params))
        if dataset.startswith("ths_"):
            raise AssertionError(f"{dataset} should not be called in 2000-credit mode")
        if dataset == "index_classify":
            return pd.DataFrame(
                [
                    {
                        "index_code": "801750.SI",
                        "industry_name": "计算机",
                        "level": "L1",
                        "src": "SW2021",
                    },
                    {
                        "index_code": "851041.SI",
                        "industry_name": "软件开发",
                        "level": "L3",
                        "src": "SW2021",
                    },
                    {
                        "index_code": "850711.SI",
                        "industry_name": "机床工具",
                        "level": "L3",
                        "src": "SW2021",
                    },
                ]
            )
        if dataset == "index_member_all":
            return pd.DataFrame(
                [
                    {
                        "l3_code": "851041.SI",
                        "l3_name": "软件开发",
                        "ts_code": "603019.SH",
                        "name": "中科曙光",
                        "is_new": "Y",
                    }
                ]
            )
        return pd.DataFrame()

    def get_market_snapshot(self):
        return []


class FakeZhipuClient:
    def __init__(self, concepts: list[dict]) -> None:
        self.concepts = concepts

    def search_theme_concepts(self, theme: str, limit: int) -> list[dict]:
        return self.concepts[:limit]


def test_theme_concepts_use_sw_industries_without_calling_ths() -> None:
    provider = FakeTushareRawProvider()
    client = TushareProviderClient(provider=provider)

    result = client.get_theme_concepts(theme="AI", limit=3)

    called_datasets = [dataset for dataset, _params in provider.calls]
    assert "ths_index" not in called_datasets
    assert result["concepts"]
    assert result["concepts"][0]["source"].startswith("tushare:index_classify")


def test_concept_constituents_use_index_member_all_without_calling_ths_member() -> None:
    provider = FakeTushareRawProvider()
    client = TushareProviderClient(provider=provider)

    members = client.get_concept_constituents("软件开发", concept_code="851041.SI")

    assert members == [
        {
            "conceptName": "软件开发",
            "stockCode": "603019",
            "stockName": "中科曙光",
            "latestPrice": None,
            "changePercent": None,
            "turnoverRate": None,
        }
    ]
    assert ("ths_member", {"ts_code": "851041.SI"}) not in provider.calls
    assert any(
        dataset == "index_member_all"
        and params == {"is_new": "Y", "l3_code": "851041.SI"}
        for dataset, params in provider.calls
    )


def test_theme_candidates_do_not_fallback_to_unrelated_market_hot_stocks() -> None:
    provider = FakeTushareRawProvider()
    client = TushareProviderClient(provider=provider)

    candidates = client.get_theme_candidates(theme="完全未知主题", limit=6)

    assert candidates == []
    assert any(dataset == "index_classify" for dataset, _params in provider.calls)
    assert all(dataset != "ths_member" for dataset, _params in provider.calls)


def test_theme_candidates_use_web_search_concept_hints_after_tushare_match_misses() -> None:
    provider = FakeTushareRawProvider()
    client = TushareProviderClient(provider=provider)

    candidates = client.get_theme_candidates(
        theme="国产办公软件替代",
        limit=6,
        concept_hints=[
            {
                "name": "软件开发",
                "aliases": ["基础软件"],
                "confidence": 0.86,
                "reason": "Web Search 指向软件开发板块",
            }
        ],
    )

    assert candidates
    assert candidates[0]["stockCode"] == "603019"
    assert candidates[0]["concept"] == "软件开发"

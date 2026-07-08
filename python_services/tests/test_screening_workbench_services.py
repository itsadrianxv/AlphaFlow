from __future__ import annotations

from app.data_providers.contracts import FinancialMetricPoint, StockProfile
from app.services.screening_formula_engine import SafeFormulaEngine
from app.services.screening_query_service import ScreeningQueryService
from app.services.screening_universe import ScreeningStockSearcher


def test_stock_searcher_uses_cached_universe_loader():
    calls: list[str] = []

    def load_universe():
        calls.append("load")
        return [
            {"stockCode": "600519", "stockName": "贵州茅台", "market": "SH"},
            {"stockCode": "000001", "stockName": "平安银行", "market": "SZ"},
        ]

    searcher = ScreeningStockSearcher(
        universe_loader=load_universe,
        ttl_seconds=300,
        now_fn=lambda: 100.0,
    )

    first = searcher.search("茅台", limit=20)
    second = searcher.search("6005", limit=20)

    assert calls == ["load"]
    assert first == [
        {
            "stockCode": "600519",
            "stockName": "贵州茅台",
            "market": "SH",
            "matchField": "NAME",
        }
    ]
    assert second == [
        {
            "stockCode": "600519",
            "stockName": "贵州茅台",
            "market": "SH",
            "matchField": "CODE",
        }
    ]


def test_safe_formula_engine_validates_expression_and_target_limit():
    engine = SafeFormulaEngine()

    valid = engine.validate(
        expression="var[0] / var[1]",
        target_indicators=["营业收入", "归母净利润"],
    )
    invalid = engine.validate(
        expression="max(var[0], var[1])",
        target_indicators=["A", "B"],
    )
    too_many_targets = engine.validate(
        expression="var[0] + var[1]",
        target_indicators=["A", "B", "C", "D", "E", "F"],
    )

    assert valid.valid is True
    assert valid.normalized_expression == "var[0] / var[1]"
    assert invalid.valid is False
    assert invalid.errors
    assert too_many_targets.valid is False


def test_screening_query_service_chunks_statement_queries_by_budget():
    class FakeProvider:
        provider_name = "tushare"

        def __init__(self) -> None:
            self.series_calls: list[tuple[list[str], list[str], list[str]]] = []
            self.latest_calls: list[tuple[list[str], list[str]]] = []

        def get_stock_profile(self, stock_code: str) -> StockProfile:
            return StockProfile(
                stockCode=stock_code,
                tsCode=f"{stock_code}.SH",
                stockName=f"股票{stock_code}",
                market="SH" if stock_code.startswith("6") else "SZ",
                sector="主板",
                industry="",
            )

        def get_metric_series(
            self,
            stock_codes: list[str],
            metric_ids: list[str],
            periods: list[str],
        ) -> dict[str, dict[str, list[FinancialMetricPoint]]]:
            self.series_calls.append((stock_codes[:], metric_ids[:], periods[:]))
            return {
                stock_code: {
                    metric_id: [
                        FinancialMetricPoint(
                            stockCode=stock_code,
                            metricId=metric_id,
                            period=period,
                            endDate=f"{period}-12-31",
                            value=float(index + period_index + len(stock_code)),
                        )
                        for period_index, period in enumerate(periods)
                    ]
                    for index, metric_id in enumerate(metric_ids)
                }
                for stock_code in stock_codes
            }

        def get_latest_metrics(
            self,
            stock_codes: list[str],
            metric_ids: list[str],
        ) -> dict[str, dict[str, float | None]]:
            self.latest_calls.append((stock_codes[:], metric_ids[:]))
            return {
                stock_code: {
                    metric_id: float(index + len(stock_code))
                    for index, metric_id in enumerate(metric_ids)
                }
                for stock_code in stock_codes
            }

    provider = FakeProvider()
    service = ScreeningQueryService(provider=provider)

    stock_codes = [f"{600000 + index}" for index in range(20)]
    indicators = [
        {
            "id": f"metric_{index}",
            "name": f"指标{index}",
            "retrievalMode": "statement_series",
            "periodScope": "series",
            "valueType": "NUMBER",
        }
        for index in range(10)
    ]

    result = service.query_dataset(
        stock_codes=stock_codes,
        indicators=indicators,
        formulas=[],
        periods=["2022", "2023", "2024"],
    )

    assert result["provider"] == "tushare"
    assert provider.series_calls == [
        (
            stock_codes,
            [f"metric_{index}" for index in range(10)],
            ["2022", "2023", "2024"],
        )
    ]
    assert provider.latest_calls == []
    assert result["latestSnapshotRows"][0]["stockName"] == f"股票{stock_codes[0]}"
    assert result["rows"][0]["metrics"]["metric_0"]["byPeriod"] == {
        "2022": 6.0,
        "2023": 7.0,
        "2024": 8.0,
    }


def test_screening_query_service_combines_latest_only_and_formula_values():
    class FakeProvider:
        provider_name = "tushare"

        def get_stock_profile(self, stock_code: str) -> StockProfile:
            return StockProfile(
                stockCode=stock_code,
                tsCode=f"{stock_code}.SH",
                stockName=stock_code,
                market="SH",
                sector="主板",
                industry="",
            )

        def get_metric_series(
            self,
            stock_codes: list[str],
            metric_ids: list[str],
            periods: list[str],
        ) -> dict[str, dict[str, list[FinancialMetricPoint]]]:
            assert metric_ids == ["revenue"]
            assert periods == ["2024"]
            return {
                stock_codes[0]: {
                    "revenue": [
                        FinancialMetricPoint(
                            stockCode=stock_codes[0],
                            metricId="revenue",
                            period="2024",
                            endDate="2024-12-31",
                            value=100.0,
                        )
                    ]
                },
            }

        def get_latest_metrics(
            self,
            stock_codes: list[str],
            metric_ids: list[str],
        ) -> dict[str, dict[str, float | None]]:
            assert metric_ids == ["pe_ttm"]
            return {
                stock_codes[0]: {"pe_ttm": 20.0},
            }

    service = ScreeningQueryService(provider=FakeProvider(), formula_engine=SafeFormulaEngine())

    result = service.query_dataset(
        stock_codes=["600519"],
        indicators=[
            {
                "id": "revenue",
                "name": "营业收入",
                "retrievalMode": "statement_series",
                "periodScope": "series",
                "valueType": "NUMBER",
            },
            {
                "id": "pe_ttm",
                "name": "PE(TTM)",
                "retrievalMode": "latest_only",
                "periodScope": "latest_only",
                "valueType": "NUMBER",
            },
        ],
        formulas=[
            {
                "id": "revenue_over_pe",
                "name": "收入除PE",
                "expression": "var[0] / var[1]",
                "targetIndicators": ["revenue", "pe_ttm"],
            }
        ],
        periods=["2024"],
    )

    assert result["provider"] == "tushare"
    assert result["latestSnapshotRows"][0]["metrics"]["pe_ttm"]["value"] == 20.0
    assert result["rows"][0]["metrics"]["revenue"]["byPeriod"]["2024"] == 100.0
    assert result["rows"][0]["metrics"]["revenue_over_pe"]["byPeriod"]["2024"] == 5.0


def test_screening_query_service_rejects_invalid_latest_payload_shape():
    class FakeProvider:
        provider_name = "tushare"

        def get_stock_profile(self, stock_code: str) -> StockProfile:
            return StockProfile(
                stockCode=stock_code,
                tsCode=f"{stock_code}.SH",
                stockName=stock_code,
                market="SH",
                sector="主板",
                industry="",
            )

        def get_metric_series(
            self,
            stock_codes: list[str],
            metric_ids: list[str],
            periods: list[str],
        ) -> dict[str, dict[str, list[FinancialMetricPoint]]]:
            return {}

        def get_latest_metrics(
            self,
            stock_codes: list[str],
            metric_ids: list[str],
        ):
            return None

    service = ScreeningQueryService(provider=FakeProvider(), formula_engine=SafeFormulaEngine())

    try:
        service.query_dataset(
            stock_codes=["601138"],
            indicators=[
                {
                    "id": "pe_ttm",
                    "name": "PE(TTM)",
                    "retrievalMode": "latest_only",
                    "periodScope": "latest_only",
                    "valueType": "NUMBER",
                },
                {
                    "id": "float_a_shares",
                    "name": "Float A Shares",
                    "retrievalMode": "latest_only",
                    "periodScope": "latest_only",
                    "valueType": "NUMBER",
                },
            ],
            formulas=[],
            periods=["2024"],
        )
    except RuntimeError as exc:
        assert (
            str(exc)
            == "Screening provider tushare returned invalid latest metrics payload: expected dict, got NoneType"
        )
    else:
        raise AssertionError("Expected invalid latest metrics payload to raise RuntimeError")


def test_load_indicator_catalog_returns_non_empty_snapshot():
    from app.services.screening_catalog import load_indicator_catalog

    load_indicator_catalog.cache_clear()
    catalog = load_indicator_catalog()

    assert catalog["categories"]
    assert catalog["items"]


def test_indicator_catalog_uses_tushare_business_ids():
    from app.services.screening_catalog import load_indicator_catalog

    load_indicator_catalog.cache_clear()
    catalog = load_indicator_catalog()
    item_ids = {item["id"] for item in catalog["items"]}

    assert {
        "pe_ttm",
        "pb",
        "market_cap",
        "float_market_cap",
        "total_shares",
        "float_a_shares",
        "roe_report",
        "eps_report",
        "revenue",
        "net_profit_parent",
        "asset_liability_ratio",
    }.issubset(item_ids)


def test_indicator_catalog_exposes_sorting_keywords_and_source_metadata():
    from app.services.screening_catalog import load_indicator_catalog

    load_indicator_catalog.cache_clear()
    catalog = load_indicator_catalog()

    category_ids = [category["id"] for category in catalog["categories"]]
    assert category_ids == [
        "valuation_capital",
        "profit_quality",
        "growth_quality",
        "solvency",
        "cashflow_quality",
        "operating_efficiency",
    ]
    assert all("sortOrder" in category for category in catalog["categories"])

    items_by_id = {item["id"]: item for item in catalog["items"]}
    assert items_by_id["ps_ttm"]["sourceDataset"] == "daily_basic"
    assert "市销率" in items_by_id["ps_ttm"]["keywords"]
    assert items_by_id["grossprofit_margin"]["sourceDataset"] == "fina_indicator"
    assert items_by_id["n_cashflow_act"]["sourceDataset"] == "cashflow"
    assert items_by_id["free_cashflow"]["sourceDataset"] == "cashflow"
    assert all("sortOrder" in item for item in catalog["items"])

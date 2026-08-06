from __future__ import annotations

from datetime import date

import pandas as pd

from app.financial_metrics.catalog import metric_map
from app.financial_metrics.models import MetricSeriesResult
from app.services.screening_run_executor import ScreeningRunExecutor
from app.services.screening_stock_universe_store import ScreeningStockUniverseStore


class FakeFinancialService:
    def __init__(self) -> None:
        self.queries = []

    def get_series(self, query):
        self.queries.append(query)
        metric_id = "income.total_revenue"
        return MetricSeriesResult(
            definitions=(metric_map()[metric_id],),
            periods=query.periods,
            frame=pd.DataFrame([
                {"stock_code": "000001.SZ", "period": "2024", "metric_id": metric_id, "value": 100.0},
                {"stock_code": "600519.SH", "period": "2024", "metric_id": metric_id, "value": 300.0},
                {"stock_code": "300750.SZ", "period": "2024", "metric_id": metric_id, "value": 200.0},
            ]),
        )


def test_execute_run_resolves_industry_filters_and_stably_ranks(tmp_path) -> None:
    store = ScreeningStockUniverseStore(tmp_path / "universe.json")
    store.replace(
        records=[
            {"stockCode": "000001", "stockName": "平安银行", "market": "SZ", "industry": "银行"},
            {"stockCode": "600519", "stockName": "贵州茅台", "market": "SH", "industry": "白酒"},
            {"stockCode": "300750", "stockName": "宁德时代", "market": "SZ", "industry": "电池"},
        ],
        trading_date=date(2026, 7, 29),
        provider="fixture",
    )
    financial_service = FakeFinancialService()
    result = ScreeningRunExecutor(
        financial_service=financial_service, universe_store=store
    ).execute("run-1", {
        "universe": {"type": "INDUSTRY", "industryNames": ["白酒", "电池"]},
        "indicatorIds": ["income.total_revenue"],
        "formulas": [],
        "timeConfig": {"periodType": "ANNUAL", "rangeMode": "CUSTOM", "customStart": "2024", "customEnd": "2024"},
        "filterRules": [{"metricId": "income.total_revenue", "operator": ">=", "value": 150}],
        "sortState": {"metricId": "income.total_revenue", "direction": "desc"},
    })

    assert result["runId"] == "run-1"
    assert result["universeCount"] == 2
    assert financial_service.queries[0].stock_codes == ("300750.SZ", "600519.SH")
    assert result["results"] == [
        {"stockCode": "600519", "rank": 1},
        {"stockCode": "300750", "rank": 2},
    ]

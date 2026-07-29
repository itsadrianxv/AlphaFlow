from __future__ import annotations

import pandas as pd
import pytest

from app.financial_metrics.catalog import list_metrics, metric_map, search_metrics
from app.financial_metrics.models import SeriesQuery
from app.financial_metrics.normalization import to_metric_frame
from app.financial_metrics.query_planner import build_query_plan


def test_catalog_contains_all_three_statements_and_unique_ids() -> None:
    metrics = list_metrics()
    assert len(metrics) == 326
    assert {metric.dataset for metric in metrics} == {"income", "balancesheet", "cashflow"}
    assert len({metric.id for metric in metrics}) == len(metrics)
    assert all(metric.id == f"{metric.dataset}.{metric.field}" for metric in metrics)


def test_search_matches_chinese_name_and_tushare_field() -> None:
    assert search_metrics("营业总收入", limit=1)[0].id == "income.total_revenue"
    assert search_metrics("n_cashflow_act", limit=1)[0].dataset == "cashflow"


def test_planner_selects_regular_for_one_stock_history_and_vip_for_large_pool() -> None:
    definition = metric_map()["income.total_revenue"]
    overview = SeriesQuery(("600519",), (definition.id,), ("2021", "2022", "2023"), "ANNUAL", "COMPANY_OVERVIEW")
    screening = SeriesQuery(tuple(f"{index:06d}" for index in range(100)), (definition.id,), ("2024Q4",), "QUARTERLY", "SCREENING")
    assert build_query_plan(overview, (definition,)).steps[0].strategy == "regular"
    assert build_query_plan(screening, (definition,)).steps[0].strategy == "vip"


def test_quarterly_cumulative_metric_is_converted_to_single_quarter() -> None:
    definition = metric_map()["income.total_revenue"]
    query = SeriesQuery(("600519",), (definition.id,), ("2024Q2",), "QUARTERLY", "COMPANY_OVERVIEW")
    raw = pd.DataFrame({
        "ts_code": ["600519.SH", "600519.SH"],
        "end_date": ["20240331", "20240630"],
        "report_type": ["1", "1"],
        "update_flag": ["1", "1"],
        "comp_type": ["1", "1"],
        "total_revenue": [100.0, 260.0],
    })
    frame, warnings = to_metric_frame([raw], (definition,), query)
    assert warnings == []
    assert frame.iloc[0]["value"] == pytest.approx(160.0)
    assert frame.iloc[0]["period_semantics"] == "single_quarter"


def test_balance_sheet_point_in_time_is_not_differenced() -> None:
    definition = metric_map()["balancesheet.total_assets"]
    query = SeriesQuery(("600519",), (definition.id,), ("2024Q2",), "QUARTERLY", "COMPANY_OVERVIEW")
    raw = pd.DataFrame({
        "ts_code": ["600519.SH", "600519.SH"],
        "end_date": ["20240331", "20240630"],
        "report_type": ["1", "1"],
        "update_flag": ["1", "1"],
        "comp_type": ["1", "1"],
        "total_assets": [100.0, 260.0],
    })
    frame, _ = to_metric_frame([raw], (definition,), query)
    assert frame.iloc[0]["value"] == pytest.approx(260.0)
    assert frame.iloc[0]["period_semantics"] == "point_in_time"

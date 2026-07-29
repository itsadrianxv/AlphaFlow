from __future__ import annotations

import pandas as pd

from app.data_providers.contracts import StockProfile
from app.financial_metrics.catalog import metric_map
from app.financial_metrics.models import MetricSeriesResult
from app.gateway.company_overview_gateway import CompanyOverviewGateway


class FakeProvider:
    provider_name = "tushare"

    def get_stock_profile(self, stock_code: str) -> StockProfile:
        return StockProfile(stock_code, "600000.SH", "浦发银行", "SSE", "主板", "银行")

    def get_raw_frame(self, dataset: str, **_params: str) -> pd.DataFrame:
        frames = {
            "stock_company": pd.DataFrame([{"introduction": "测试公司", "main_business": "公司金融", "business_scope": "银行业务"}]),
            "income": pd.DataFrame([
                {"end_date": "20250331", "ann_date": "20250430", "revenue": 100, "n_income_attr_p": 10, "net_after_nr_lp_correct": 8},
                {"end_date": "20250630", "ann_date": "20250830", "revenue": 240, "n_income_attr_p": 26, "net_after_nr_lp_correct": 21},
                {"end_date": "20250930", "ann_date": "20251030", "revenue": 390, "n_income_attr_p": 42, "net_after_nr_lp_correct": 35},
                {"end_date": "20251231", "ann_date": "20260330", "revenue": 560, "n_income_attr_p": 61, "net_after_nr_lp_correct": 52},
            ]),
            "cashflow": pd.DataFrame([
                {"end_date": "20250331", "n_cashflow_act": 30, "c_pay_acq_const_fiolta": 5},
                {"end_date": "20250630", "n_cashflow_act": 70, "c_pay_acq_const_fiolta": 13},
                {"end_date": "20250930", "n_cashflow_act": 110, "c_pay_acq_const_fiolta": 18},
                {"end_date": "20251231", "n_cashflow_act": 160, "c_pay_acq_const_fiolta": 26},
            ]),
            "balancesheet": pd.DataFrame(),
            "fina_indicator": pd.DataFrame([{"end_date": "20251231", "roe": 12.4, "grossprofit_margin": 31.0, "netprofit_margin": 10.9}]),
            "daily_basic": pd.DataFrame([{"trade_date": "20260724", "pe_ttm": 8.2, "pb": 0.7, "ps_ttm": 1.2}]),
            "fina_mainbz": pd.DataFrame([
                {"end_date": "20241231", "bz_item": "公司金融", "bz_sales": 60, "bz_profit": 25, "bz_cost": 35},
                {"end_date": "20251231", "bz_item": "公司金融", "bz_sales": 100, "bz_profit": 45, "bz_cost": 55},
                {"end_date": "20251231", "bz_item": "零售金融", "bz_sales": 20, "bz_profit": 5, "bz_cost": 15},
            ]),
        }
        return frames[dataset].copy()


class FakeFinancialService:
    def get_series(self, query):
        definitions = tuple(metric_map()[metric_id] for metric_id in query.metric_ids)
        period = "2025Q4" if query.period_type == "QUARTERLY" else "2025"
        values = {
            "income.total_revenue": 170.0 if query.period_type == "QUARTERLY" else 560.0,
            "income.n_income_attr_p": 19.0 if query.period_type == "QUARTERLY" else 61.0,
            "income.basic_eps": 0.5,
            "balancesheet.total_assets": 1000.0,
            "balancesheet.total_liab": 700.0,
            "cashflow.n_cashflow_act": 50.0 if query.period_type == "QUARTERLY" else 160.0,
        }
        frame = pd.DataFrame([
            {"stock_code": "600000", "metric_id": metric_id, "period": period, "value": values[metric_id]}
            for metric_id in query.metric_ids
        ])
        return MetricSeriesResult(definitions=definitions, periods=query.periods, frame=frame)


def test_company_overview_uses_unified_financial_series_and_builds_businesses() -> None:
    overview = CompanyOverviewGateway(
        provider=FakeProvider(), financial_service=FakeFinancialService()
    )._build("600000")
    latest = overview["financials"]["quarters"][0]

    assert latest["endDate"] == "2025Q4"
    assert latest["values"]["income.total_revenue"] == 170
    assert latest["values"]["cashflow.n_cashflow_act"] == 50
    assert "valuation" not in overview["financials"]
    assert len(overview["financials"]["metrics"]) == 6
    assert overview["businesses"][0]["role"] == "核心主业"

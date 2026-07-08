from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
import pytest

import app.data_providers.tushare_provider as tushare_module
from app.data_providers import TushareProvider
from app.data_providers.errors import DataProviderConfigurationError


@dataclass
class FakeProClient:
    stock_basic_frame: pd.DataFrame
    daily_basic_frames: dict[str, pd.DataFrame]
    fina_indicator_frames: dict[str, pd.DataFrame]
    income_frames: dict[str, pd.DataFrame]
    balancesheet_frames: dict[str, pd.DataFrame]
    cashflow_frames: dict[str, pd.DataFrame]

    def stock_basic(self, **_kwargs):
        return self.stock_basic_frame.copy()

    def daily_basic(self, **kwargs):
        trade_date = kwargs.get("trade_date")
        if trade_date is not None:
            return self.daily_basic_frames.get(trade_date, pd.DataFrame()).copy()
        return pd.DataFrame()

    def fina_indicator(self, **kwargs):
        return self.fina_indicator_frames[kwargs["ts_code"]].copy()

    def income(self, **kwargs):
        return self.income_frames[kwargs["ts_code"]].copy()

    def balancesheet(self, **kwargs):
        return self.balancesheet_frames[kwargs["ts_code"]].copy()

    def cashflow(self, **kwargs):
        return self.cashflow_frames[kwargs["ts_code"]].copy()


def test_tushare_provider_maps_universe_latest_and_series_metrics(monkeypatch):
    fake_client = FakeProClient(
        stock_basic_frame=pd.DataFrame(
            {
                "ts_code": ["600519.SH", "300750.SZ", "430001.BJ"],
                "symbol": ["600519", "300750", "430001"],
                "name": ["贵州茅台", "宁德时代", "北交样本"],
                "industry": ["白酒", "电池", "专精特新"],
            }
        ),
        daily_basic_frames={
            "20260408": pd.DataFrame(),
            "20260407": pd.DataFrame(
                {
                    "ts_code": ["600519.SH", "300750.SZ", "430001.BJ"],
                    "pe_ttm": [25.0, 18.0, 30.0],
                    "pb": [8.0, 4.0, 2.0],
                    "ps_ttm": [10.0, 5.0, 2.0],
                    "dv_ttm": [3.2, 1.5, 0.8],
                    "total_mv": [210_380_000.0, 800_000.0, 100_000.0],
                    "circ_mv": [205_000_000.0, 700_000.0, 80_000.0],
                    "total_share": [125_600.0, 1_000.0, 500.0],
                    "float_share": [122_500.0, 900.0, 400.0],
                    "free_share": [120_000.0, 850.0, 380.0],
                }
            ),
        },
        fina_indicator_frames={
            "600519.SH": pd.DataFrame(
                {
                    "end_date": ["20241231", "20231231"],
                    "roe": [21.5, 19.0],
                    "eps": [50.3, 46.0],
                    "grossprofit_margin": [91.2, 90.5],
                    "current_ratio": [4.6, 4.2],
                    "ocfps": [42.6, 39.5],
                }
            )
        },
        income_frames={
            "600519.SH": pd.DataFrame(
                {
                    "end_date": ["20241231", "20231231"],
                    "total_revenue": [174_144_000_000.0, 150_560_000_000.0],
                    "n_income_attr_p": [86_228_000_000.0, 74_734_000_000.0],
                }
            )
        },
        balancesheet_frames={
            "600519.SH": pd.DataFrame(
                {
                    "end_date": ["20241231", "20231231"],
                    "total_assets": [300_000_000_000.0, 280_000_000_000.0],
                    "total_liab": [75_000_000_000.0, 70_000_000_000.0],
                }
            )
        },
        cashflow_frames={
            "600519.SH": pd.DataFrame(
                {
                    "end_date": ["20241231", "20231231"],
                    "n_cashflow_act": [92_360_000_000.0, 84_520_000_000.0],
                    "free_cashflow": [51_200_000_000.0, 45_800_000_000.0],
                }
            )
        },
    )

    monkeypatch.setenv("TUSHARE_TOKEN", "token-1")
    monkeypatch.setattr(tushare_module, "_create_tushare_client", lambda _token: fake_client)
    monkeypatch.setattr(
        tushare_module.TushareProvider,
        "_candidate_trade_dates",
        lambda self, as_of_date, *, lookback_days: ["20260408", "20260407"],
    )

    provider = TushareProvider()

    universe = provider.get_stock_universe()
    assert [profile.stockCode for profile in universe] == ["600519", "300750", "430001"]
    assert provider.get_stock_profile("430001").sector == "北交所"

    latest = provider.get_latest_metrics(
        ["600519"],
        ["pe_ttm", "ps_ttm", "dv_ttm", "market_cap", "total_shares", "free_share"],
    )
    assert latest == {
        "600519": {
            "pe_ttm": 25.0,
            "ps_ttm": 10.0,
            "dv_ttm": pytest.approx(0.032),
            "market_cap": pytest.approx(21038.0),
            "total_shares": 1_256_000_000.0,
            "free_share": 1_200_000_000.0,
        }
    }

    series = provider.get_metric_series(
        ["600519"],
        [
            "roe_report",
            "grossprofit_margin",
            "current_ratio",
            "ocfps",
            "n_cashflow_act",
            "free_cashflow",
            "asset_liability_ratio",
        ],
        ["2023", "2024"],
    )
    by_metric = {
        metric_id: {point.period: point.value for point in points}
        for metric_id, points in series["600519"].items()
    }
    assert by_metric["roe_report"] == {"2023": pytest.approx(0.19), "2024": pytest.approx(0.215)}
    assert by_metric["grossprofit_margin"] == {"2023": pytest.approx(0.905), "2024": pytest.approx(0.912)}
    assert by_metric["current_ratio"] == {"2023": pytest.approx(4.2), "2024": pytest.approx(4.6)}
    assert by_metric["ocfps"] == {"2023": pytest.approx(39.5), "2024": pytest.approx(42.6)}
    assert by_metric["n_cashflow_act"] == {"2023": pytest.approx(845.2), "2024": pytest.approx(923.6)}
    assert by_metric["free_cashflow"] == {"2023": pytest.approx(458.0), "2024": pytest.approx(512.0)}
    assert by_metric["asset_liability_ratio"] == {"2023": pytest.approx(0.25), "2024": pytest.approx(0.25)}


def test_tushare_provider_requires_token(monkeypatch):
    monkeypatch.delenv("TUSHARE_TOKEN", raising=False)

    with pytest.raises(DataProviderConfigurationError, match="TUSHARE_TOKEN"):
        TushareProvider().get_stock_universe()

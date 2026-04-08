from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
import pytest

from app.providers.screening.tushare_provider import TushareScreeningProvider
import app.providers.screening.tushare_provider as tushare_module


@dataclass
class FakeProClient:
    stock_basic_frame: pd.DataFrame
    daily_basic_frames: dict[str, pd.DataFrame]
    fina_indicator_frames: dict[str, pd.DataFrame]
    income_frames: dict[str, pd.DataFrame]
    balancesheet_frames: dict[str, pd.DataFrame]

    def stock_basic(self, **_kwargs):
        return self.stock_basic_frame.copy()

    def daily_basic(self, **kwargs):
        trade_date = kwargs["trade_date"]
        return self.daily_basic_frames.get(trade_date, pd.DataFrame()).copy()

    def fina_indicator(self, **kwargs):
        return self.fina_indicator_frames[kwargs["ts_code"]].copy()

    def income(self, **kwargs):
        return self.income_frames[kwargs["ts_code"]].copy()

    def balancesheet(self, **kwargs):
        return self.balancesheet_frames[kwargs["ts_code"]].copy()


def test_tushare_provider_maps_universe_latest_metrics_and_history(monkeypatch):
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
                    "total_mv": [210_380_000.0, 800_000.0, 100_000.0],
                    "circ_mv": [205_000_000.0, 700_000.0, 80_000.0],
                    "total_share": [125_600.0, 1_000.0, 500.0],
                    "float_share": [122_500.0, 900.0, 400.0],
                }
            ),
        },
        fina_indicator_frames={
            "600519.SH": pd.DataFrame(
                {
                    "end_date": ["20241231", "20231231"],
                    "roe": [21.5, 19.0],
                    "eps": [50.3, 46.0],
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
    )

    monkeypatch.setenv("TUSHARE_TOKEN", "token-1")
    monkeypatch.setattr(tushare_module, "_create_tushare_client", lambda _token: fake_client)
    monkeypatch.setattr(
        tushare_module.TushareScreeningProvider,
        "_today_trade_dates",
        lambda self: ["20260408", "20260407"],
    )

    provider = TushareScreeningProvider()

    assert provider.get_all_stock_codes() == ["600519", "300750", "430001"]

    batch = provider.get_stock_batch(["600519", "430001"])
    assert batch[0]["name"] == "贵州茅台"
    assert batch[0]["industry"] == "白酒"
    assert batch[0]["sector"] == "主板"
    assert batch[0]["pe"] == 25.0
    assert batch[0]["marketCap"] == pytest.approx(21038.0)
    assert batch[0]["floatMarketCap"] == pytest.approx(20500.0)
    assert batch[0]["totalShares"] == 1_256_000_000.0
    assert batch[0]["floatAShares"] == 1_225_000_000.0
    assert batch[0]["roe"] == pytest.approx(0.215)
    assert batch[0]["eps"] == 50.3
    assert batch[0]["revenue"] == pytest.approx(1741.44)
    assert batch[0]["netProfit"] == pytest.approx(862.28)
    assert batch[0]["debtRatio"] == pytest.approx(0.25)
    assert batch[1]["sector"] == "北交所"

    latest = provider.query_latest_metrics(["600519"], ["pe_ttm", "market_cap", "total_shares"])
    assert latest == {
        "600519": {
            "pe_ttm": 25.0,
            "market_cap": pytest.approx(21038.0),
            "total_shares": 1_256_000_000.0,
        }
    }

    series = provider.query_series_metrics(
        ["600519"],
        ["roe_report", "revenue", "asset_liability_ratio"],
        ["2023", "2024"],
    )
    assert series["600519"]["roe_report"] == {"2023": pytest.approx(0.19), "2024": pytest.approx(0.215)}
    assert series["600519"]["revenue"] == {"2023": pytest.approx(1505.6), "2024": pytest.approx(1741.44)}
    assert series["600519"]["asset_liability_ratio"] == {
        "2023": pytest.approx(0.25),
        "2024": pytest.approx(0.25),
    }


def test_tushare_provider_requires_token(monkeypatch):
    monkeypatch.delenv("TUSHARE_TOKEN", raising=False)

    with pytest.raises(RuntimeError, match="TUSHARE_TOKEN"):
        TushareScreeningProvider().get_all_stock_codes()

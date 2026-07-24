"""统一 TuShare provider 行情相关单元测试。"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd
import pytest

import app.data_providers.tushare_provider as tushare_module
from app.data_providers import TushareProvider
from app.data_providers.errors import DataProviderConfigurationError, InvalidSymbolError
from app.data_providers.tushare_provider import INDEX_BENCHMARK_TS_CODES


@dataclass
class FakeProClient:
    stock_basic_frame: pd.DataFrame
    daily_frames: dict[str, pd.DataFrame]
    adj_factor_frames: dict[str, pd.DataFrame]
    daily_basic_frames: dict[str, pd.DataFrame]
    index_daily_frames: dict[str, pd.DataFrame]
    stk_limit_frames: dict[str, pd.DataFrame] | None = None
    weekly_frames: dict[str, pd.DataFrame] | None = None
    monthly_frames: dict[str, pd.DataFrame] | None = None
    minute_frames: dict[str, pd.DataFrame] | None = None

    def stock_basic(self, **_kwargs):
        return self.stock_basic_frame.copy()

    def daily(self, **kwargs):
        key = kwargs.get("ts_code") or kwargs.get("trade_date")
        return self.daily_frames.get(key, pd.DataFrame()).copy()

    def adj_factor(self, **kwargs):
        return self.adj_factor_frames.get(kwargs["ts_code"], pd.DataFrame()).copy()

    def daily_basic(self, **kwargs):
        key = kwargs.get("ts_code") or kwargs.get("trade_date")
        return self.daily_basic_frames.get(key, pd.DataFrame()).copy()

    def index_daily(self, **kwargs):
        return self.index_daily_frames.get(kwargs["ts_code"], pd.DataFrame()).copy()

    def stk_limit(self, **kwargs):
        frames = self.stk_limit_frames or {}
        return frames.get(kwargs.get("trade_date"), pd.DataFrame()).copy()

    def weekly(self, **kwargs):
        return (self.weekly_frames or {}).get(kwargs["ts_code"], pd.DataFrame()).copy()

    def monthly(self, **kwargs):
        return (self.monthly_frames or {}).get(kwargs["ts_code"], pd.DataFrame()).copy()

    def stk_mins(self, **kwargs):
        return (self.minute_frames or {}).get(kwargs["freq"], pd.DataFrame()).copy()


def test_tushare_provider_maps_profile_and_qfq_bars(monkeypatch):
    fake_client = FakeProClient(
        stock_basic_frame=pd.DataFrame(
            {
                "ts_code": ["600519.SH"],
                "symbol": ["600519"],
                "name": ["Moutai"],
                "industry": ["Liquor"],
            }
        ),
        daily_frames={
            "600519.SH": pd.DataFrame(
                {
                    "trade_date": ["20250103", "20250102"],
                    "open": [102.0, 100.0],
                    "high": [104.0, 102.0],
                    "low": [101.0, 99.0],
                    "close": [103.0, 101.0],
                    "vol": [2_000.0, 1_800.0],
                    "amount": [200_000.0, 181_800.0],
                }
            )
        },
        adj_factor_frames={
            "600519.SH": pd.DataFrame(
                {
                    "trade_date": ["20250103", "20250102"],
                    "adj_factor": [2.0, 1.0],
                }
            )
        },
        daily_basic_frames={
            "600519.SH": pd.DataFrame(
                {
                    "trade_date": ["20250103", "20250102"],
                    "turnover_rate": [1.5, 1.2],
                }
            )
        },
        index_daily_frames={},
    )

    monkeypatch.setenv("TUSHARE_TOKEN", "token-1")
    monkeypatch.setattr(tushare_module, "_create_tushare_client", lambda _token: fake_client)

    provider = TushareProvider()

    profile = provider.get_stock_profile("600519")
    bars = provider.get_daily_bars(
        stock_code="600519",
        start_date="20250101",
        end_date="20250103",
        adjust="qfq",
    )

    assert profile.stockName == "Moutai"
    assert profile.industry == "Liquor"
    assert [bar.close for bar in bars] == [50.5, 103.0]
    assert [bar.turnoverRate for bar in bars] == [1.2, 1.5]


def test_tushare_provider_resolves_index_benchmarks(monkeypatch):
    fake_client = FakeProClient(
        stock_basic_frame=pd.DataFrame(),
        daily_frames={},
        adj_factor_frames={},
        daily_basic_frames={},
        index_daily_frames={
            INDEX_BENCHMARK_TS_CODES["510300"]: pd.DataFrame(
                {
                    "trade_date": ["20250103"],
                    "open": [4_000.0],
                    "high": [4_050.0],
                    "low": [3_980.0],
                    "close": [4_020.0],
                    "vol": [1_000_000.0],
                    "amount": [4_020_000_000.0],
                }
            )
        },
    )

    monkeypatch.setenv("TUSHARE_TOKEN", "token-1")
    monkeypatch.setattr(tushare_module, "_create_tushare_client", lambda _token: fake_client)

    bars = TushareProvider().get_daily_bars(
        stock_code="510300",
        start_date="20250101",
        end_date="20250103",
    )

    assert bars[0].stockCode == "510300"
    assert bars[0].close == 4020.0


def test_tushare_provider_reads_weekly_and_monthly_bars(monkeypatch):
    frame = pd.DataFrame(
        {
            "trade_date": ["20250131", "20241231"],
            "open": [10.0, 9.0],
            "high": [11.0, 10.0],
            "low": [9.5, 8.5],
            "close": [10.5, 9.5],
            "vol": [1000.0, 900.0],
            "amount": [10000.0, 9000.0],
        }
    )
    fake_client = FakeProClient(
        stock_basic_frame=pd.DataFrame(
            {
                "ts_code": ["600519.SH"],
                "symbol": ["600519"],
                "name": ["Moutai"],
                "industry": ["Liquor"],
            }
        ),
        daily_frames={},
        adj_factor_frames={
            "600519.SH": pd.DataFrame(
                {"trade_date": ["20241231", "20250131"], "adj_factor": [1.0, 1.0]}
            )
        },
        daily_basic_frames={},
        index_daily_frames={},
        weekly_frames={"600519.SH": frame},
        monthly_frames={"600519.SH": frame},
    )
    monkeypatch.setenv("TUSHARE_TOKEN", "token-1")
    monkeypatch.setattr(tushare_module, "_create_tushare_client", lambda _token: fake_client)

    provider = TushareProvider()

    assert [bar.tradeDate for bar in provider.get_bars("600519", "WEEKLY")] == [
        "2024-12-31",
        "2025-01-31",
    ]
    assert [bar.tradeDate for bar in provider.get_bars("600519", "MONTHLY")] == [
        "2024-12-31",
        "2025-01-31",
    ]


def test_tushare_provider_reads_minute_bars_with_timestamp(monkeypatch):
    minute_frame = pd.DataFrame(
        {
            "trade_time": ["2025-01-02 09:31:00", "2025-01-02 09:30:00"],
            "open": [10.1, 10.0],
            "high": [10.2, 10.1],
            "low": [10.0, 9.9],
            "close": [10.15, 10.05],
            "vol": [100.0, 90.0],
            "amount": [1015.0, 904.5],
        }
    )
    fake_client = FakeProClient(
        stock_basic_frame=pd.DataFrame(
            {
                "ts_code": ["600519.SH"],
                "symbol": ["600519"],
                "name": ["Moutai"],
                "industry": ["Liquor"],
            }
        ),
        daily_frames={},
        adj_factor_frames={},
        daily_basic_frames={},
        index_daily_frames={},
        minute_frames={"1min": minute_frame},
    )
    monkeypatch.setenv("TUSHARE_TOKEN", "token-1")
    monkeypatch.setattr(tushare_module, "_create_tushare_client", lambda _token: fake_client)

    bars = TushareProvider().get_bars(
        "600519",
        "MINUTE_1",
        start_date="2025-01-02 09:30:00",
        end_date="2025-01-02 10:00:00",
        adjust="qfq",
    )

    assert [bar.tradeDate for bar in bars] == [
        "2025-01-02 09:30:00",
        "2025-01-02 09:31:00",
    ]


def test_tushare_provider_builds_market_snapshot(monkeypatch):
    fake_client = FakeProClient(
        stock_basic_frame=pd.DataFrame(
            {
                "ts_code": ["600519.SH", "000001.SZ"],
                "symbol": ["600519", "000001"],
                "name": ["Moutai", "PingAn"],
                "industry": ["Liquor", "Bank"],
            }
        ),
        daily_frames={
            "20260706": pd.DataFrame(
                {
                    "ts_code": ["600519.SH", "000001.SZ"],
                    "trade_date": ["20260706", "20260706"],
                    "open": [100.0, 10.0],
                    "high": [103.0, 10.5],
                    "low": [99.0, 9.8],
                    "close": [102.0, 10.3],
                    "pre_close": [100.0, 10.0],
                    "change": [2.0, 0.3],
                    "pct_chg": [2.0, 3.0],
                    "vol": [1000.0, 2000.0],
                    "amount": [102000.0, 20600.0],
                }
            )
        },
        adj_factor_frames={},
        daily_basic_frames={
            "20260706": pd.DataFrame(
                {
                    "ts_code": ["600519.SH", "000001.SZ"],
                    "trade_date": ["20260706", "20260706"],
                    "close": [102.0, 10.3],
                    "turnover_rate": [1.1, 0.8],
                    "turnover_rate_f": [1.4, 1.0],
                    "volume_ratio": [1.2, 0.9],
                    "total_mv": [2_000_000.0, 300_000.0],
                    "circ_mv": [1_800_000.0, 280_000.0],
                    "limit_status": ["U", None],
                }
            )
        },
        index_daily_frames={},
        stk_limit_frames={
            "20260706": pd.DataFrame(
                {
                    "trade_date": ["20260706", "20260706"],
                    "ts_code": ["600519.SH", "000001.SZ"],
                    "up_limit": [112.2, 11.33],
                    "down_limit": [91.8, 9.27],
                }
            )
        },
    )

    monkeypatch.setenv("TUSHARE_TOKEN", "token-1")
    monkeypatch.setattr(tushare_module, "_create_tushare_client", lambda _token: fake_client)

    snapshot = TushareProvider().get_market_snapshot("2026-07-06")

    assert snapshot[0].stockCode == "600519"
    assert snapshot[0].stockName == "Moutai"
    assert snapshot[0].tradeDate == "2026-07-06"
    assert snapshot[0].changePercent == 2.0
    assert snapshot[0].turnoverRate == 1.1
    assert snapshot[0].marketCap == 2_000_000.0
    assert snapshot[0].limitStatus == "U"
    assert snapshot[0].upLimit == 112.2


def test_tushare_provider_rejects_unknown_stock_code(monkeypatch):
    fake_client = FakeProClient(
        stock_basic_frame=pd.DataFrame(
            {"ts_code": ["600519.SH"], "symbol": ["600519"], "name": ["Moutai"], "industry": ["Liquor"]}
        ),
        daily_frames={},
        adj_factor_frames={},
        daily_basic_frames={},
        index_daily_frames={},
    )

    monkeypatch.setenv("TUSHARE_TOKEN", "token-1")
    monkeypatch.setattr(tushare_module, "_create_tushare_client", lambda _token: fake_client)

    with pytest.raises(InvalidSymbolError, match="Unknown stock code"):
        TushareProvider().get_stock_profile("000001")


def test_tushare_provider_requires_token(monkeypatch):
    monkeypatch.delenv("TUSHARE_TOKEN", raising=False)

    with pytest.raises(DataProviderConfigurationError, match="TUSHARE_TOKEN"):
        TushareProvider().get_stock_profile("600519")

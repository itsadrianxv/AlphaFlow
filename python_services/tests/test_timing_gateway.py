"""Timing gateway unit tests."""

from __future__ import annotations

import threading
import time

import pytest

from app.data_providers.contracts import DailyBar, StockProfile
from app.data_providers.errors import DataUnavailableError
from app.gateway.common import GatewayError
from app.gateway.timing_gateway import SIGNAL_BENCHMARK_CODES, TimingGateway
from app.services.timing_indicators import timing_indicators_service


def _sample_bars(stock_code: str) -> list[DailyBar]:
    import pandas as pd

    dates = pd.date_range("2025-01-02", periods=280, freq="B")
    bars: list[DailyBar] = []
    for index, trade_date in enumerate(dates):
        close = 10 + index * 0.05
        bars.append(
            DailyBar(
                stockCode=stock_code,
                tradeDate=trade_date.strftime("%Y-%m-%d"),
                open=close - 0.02,
                close=close,
                high=close + 0.08,
                low=close - 0.08,
                volume=900_000 + index * 5_000,
                amount=(900_000 + index * 5_000) * close,
                turnoverRate=1.1,
            )
        )
    return bars


class FakeSignalProvider:
    provider_name = "tushare"

    def __init__(self) -> None:
        self.profile_calls: list[str] = []
        self.bar_calls: list[dict[str, str | None]] = []
        self.benchmark_codes: list[str] = []

    def get_stock_profile(self, stock_code: str) -> StockProfile:
        self.profile_calls.append(stock_code)
        return StockProfile(
            stockCode=stock_code,
            tsCode=f"{stock_code}.SH",
            stockName=f"Stock-{stock_code}",
            market="SH",
            sector="主板",
            industry="",
        )

    def get_daily_bars(
        self,
        stock_code: str,
        start_date: str | None = None,
        end_date: str | None = None,
        adjust: str = "qfq",
    ) -> list[DailyBar]:
        self.bar_calls.append(
            {
                "stock_code": stock_code,
                "start_date": start_date,
                "end_date": end_date,
                "adjust": adjust,
            }
        )
        if stock_code in SIGNAL_BENCHMARK_CODES:
            self.benchmark_codes.append(stock_code)
        return _sample_bars(stock_code)


class FakeMarketContextProvider(FakeSignalProvider):
    def get_market_snapshot(self, as_of_date: str | None = None):
        del as_of_date
        return []


def test_get_signal_batch_reuses_benchmark_histories() -> None:
    signal_provider = FakeSignalProvider()
    gateway = TimingGateway(
        signal_data_provider=signal_provider,
        market_context_provider=FakeMarketContextProvider(),
    )

    response = gateway.get_signal_batch(
        request_id="req-1",
        stock_codes=["600519", "000001"],
        as_of_date="2025-12-31",
        lookback_days=None,
    )

    assert [item.stockCode for item in response.data.items] == ["600519", "000001"]
    assert signal_provider.profile_calls[:2] == ["600519", "000001"]
    assert signal_provider.bar_calls[:3] == [
        {
            "stock_code": "510300",
            "start_date": "20240907",
            "end_date": "2025-12-31",
            "adjust": "qfq",
        },
        {
            "stock_code": "510500",
            "start_date": "20240907",
            "end_date": "2025-12-31",
            "adjust": "qfq",
        },
        {
            "stock_code": "159915",
            "start_date": "20240907",
            "end_date": "2025-12-31",
            "adjust": "qfq",
        },
    ]
    assert signal_provider.benchmark_codes == list(SIGNAL_BENCHMARK_CODES)


def test_get_signal_batch_fetches_stocks_concurrently(monkeypatch) -> None:
    signal_provider = FakeSignalProvider()
    gateway = TimingGateway(
        signal_data_provider=signal_provider,
        market_context_provider=FakeMarketContextProvider(),
    )
    active = 0
    max_active = 0
    lock = threading.Lock()
    original = gateway._get_signal_result

    def slow_get_signal_result(**kwargs):
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        try:
            time.sleep(0.05)
            return original(**kwargs)
        finally:
            with lock:
                active -= 1

    monkeypatch.setattr(gateway, "_get_signal_result", slow_get_signal_result)

    response = gateway.get_signal_batch(
        request_id="req-concurrent",
        stock_codes=["600519", "000001"],
        as_of_date="2025-12-31",
        lookback_days=None,
    )

    assert [item.stockCode for item in response.data.items] == ["600519", "000001"]
    assert max_active == 2


def test_get_evidence_batch_fetches_stocks_concurrently(monkeypatch) -> None:
    signal_provider = FakeSignalProvider()
    gateway = TimingGateway(
        signal_data_provider=signal_provider,
        market_context_provider=FakeMarketContextProvider(),
    )
    active = 0
    max_active = 0
    lock = threading.Lock()
    original = gateway._build_evidence_data

    def slow_build_evidence_data(**kwargs):
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        try:
            time.sleep(0.05)
            return original(**kwargs)
        finally:
            with lock:
                active -= 1

    monkeypatch.setattr(gateway, "_build_evidence_data", slow_build_evidence_data)

    response = gateway.get_evidence_batch(
        request_id="req-concurrent-evidence",
        stock_codes=["600519", "000001"],
        as_of_date="2025-12-31",
        timeframes=["DAILY"],
        indicator_ids=["trend.close_above_ema20"],
        lookback_days=120,
    )

    assert [item.stockCode for item in response.data.items] == ["600519", "000001"]
    assert max_active == 2


def test_evidence_history_never_returns_future_evidence() -> None:
    signal_provider = FakeSignalProvider()
    gateway = TimingGateway(
        signal_data_provider=signal_provider,
        market_context_provider=FakeMarketContextProvider(),
    )

    response = gateway.get_evidence_history(
        request_id="history-1",
        stock_codes=["600519"],
        start_date="2025-06-01",
        end_date="2025-10-31",
        timeframes=["DAILY"],
        indicator_ids=["trend.close_above_ema20"],
        lookback_days=120,
        sample_every_trading_days=20,
    )

    assert len(response.data.items) == 1
    assert response.data.items[0].timeline
    for evidence in response.data.items[0].timeline:
        assert all(feature.asOfDate <= evidence.asOfDate for feature in evidence.features)


def test_get_signal_returns_bars_when_requested() -> None:
    signal_provider = FakeSignalProvider()
    gateway = TimingGateway(
        signal_data_provider=signal_provider,
        market_context_provider=FakeMarketContextProvider(),
    )

    response = gateway.get_signal(
        request_id="req-1",
        stock_code="600519",
        as_of_date="2025-12-31",
        lookback_days=None,
        include_bars=True,
    )

    assert response.data.bars is not None
    assert len(response.data.bars) == 260
    assert response.data.bars[0].tradeDate == "2025-01-02"


def test_build_bars_drops_non_finite_required_values_and_nulls_optional_values() -> None:
    import pandas as pd

    history = pd.DataFrame(
        {
            "日期": ["2026-07-27", "2026-07-28"],
            "开盘": [float("inf"), 10.0],
            "最高": [11.0, 11.0],
            "最低": [9.0, 9.0],
            "收盘": [10.5, 10.5],
            "成交量": [1_000.0, 1_000.0],
            "成交额": [10_000.0, float("-inf")],
            "换手率": [1.0, float("inf")],
        },
    )

    normalized = timing_indicators_service.normalize_history(history)
    bars = timing_indicators_service.build_bars(normalized)

    assert len(bars) == 1
    assert bars[0].tradeDate == "2026-07-28"
    assert bars[0].amount is None
    assert bars[0].turnoverRate is None


def test_get_bars_without_explicit_start_retries_with_unbounded_start() -> None:
    class FlakySignalProvider(FakeSignalProvider):
        def get_daily_bars(
            self,
            stock_code: str,
            start_date: str | None = None,
            end_date: str | None = None,
            adjust: str = "qfq",
        ) -> list[DailyBar]:
            self.bar_calls.append(
                {
                    "stock_code": stock_code,
                    "start_date": start_date,
                    "end_date": end_date,
                    "adjust": adjust,
                }
            )
            if start_date is not None:
                raise DataUnavailableError(
                    f"Daily bars not found for {stock_code}",
                    provider=self.provider_name,
                )
            return _sample_bars(stock_code)

    signal_provider = FlakySignalProvider()
    gateway = TimingGateway(
        signal_data_provider=signal_provider,
        market_context_provider=FakeMarketContextProvider(),
    )

    response = gateway.get_bars(
        request_id="req-1",
        stock_code="600519",
        start=None,
        end="2025-12-31",
        timeframe="DAILY",
        adjust="qfq",
    )

    assert len(response.data.bars) == 280
    assert signal_provider.bar_calls == [
        {
            "stock_code": "600519",
            "start_date": "20240907",
            "end_date": "2025-12-31",
            "adjust": "qfq",
        },
        {
            "stock_code": "600519",
            "start_date": None,
            "end_date": "2025-12-31",
            "adjust": "qfq",
        },
    ]


def test_get_bars_with_explicit_start_does_not_retry() -> None:
    class MissingBarsSignalProvider(FakeSignalProvider):
        def get_daily_bars(
            self,
            stock_code: str,
            start_date: str | None = None,
            end_date: str | None = None,
            adjust: str = "qfq",
        ) -> list[DailyBar]:
            self.bar_calls.append(
                {
                    "stock_code": stock_code,
                    "start_date": start_date,
                    "end_date": end_date,
                    "adjust": adjust,
                }
            )
            raise DataUnavailableError(
                f"Daily bars not found for {stock_code}",
                provider=self.provider_name,
            )

    signal_provider = MissingBarsSignalProvider()
    gateway = TimingGateway(
        signal_data_provider=signal_provider,
        market_context_provider=FakeMarketContextProvider(),
    )

    with pytest.raises(GatewayError, match="Daily bars not found"):
        gateway.get_bars(
            request_id="req-1",
            stock_code="600519",
            start="2025-01-01",
            end="2025-12-31",
            timeframe="DAILY",
            adjust="qfq",
        )

    assert signal_provider.bar_calls == [
        {
            "stock_code": "600519",
            "start_date": "20250101",
            "end_date": "2025-12-31",
            "adjust": "qfq",
        }
    ]

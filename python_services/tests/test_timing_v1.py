"""Tests for timing v1 bars, signal context, and market context endpoints."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
import time
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.contracts.timing import TimingSignalBatchRequest
from app.data_providers.contracts import DailyBar, MarketSnapshotRow, StockProfile
from app.data_providers.errors import DataUnavailableError
from app.gateway.timing_gateway import TimingGateway
from app.main import app
from app.routers import timing_v1

client = TestClient(app)


def test_timing_batch_route_does_not_block_event_loop(monkeypatch) -> None:
    class SlowGateway:
        def get_signal_batch(self, **_params):
            time.sleep(0.15)
            return {"status": "ok"}

    monkeypatch.setattr(timing_v1, "timing_gateway", SlowGateway())
    request = SimpleNamespace(state=SimpleNamespace(request_id="request-slow"))
    body = TimingSignalBatchRequest(stockCodes=["601138"])

    async def run_scenario() -> float:
        started_at = time.perf_counter()
        request_task = asyncio.create_task(
            timing_v1.get_stock_signal_batch(request, body),
        )
        await asyncio.sleep(0.02)
        event_loop_delay = time.perf_counter() - started_at
        await request_task
        return event_loop_delay

    assert asyncio.run(run_scenario()) < 0.08


def _sample_bars(stock_code: str = "600519") -> list[DailyBar]:
    import pandas as pd

    dates = pd.date_range(end="2026-07-06", periods=280, freq="B")
    bars: list[DailyBar] = []
    for index, value in enumerate(dates):
        base_close = 10 + index * 0.05
        bars.append(
            DailyBar(
                stockCode=stock_code,
                tradeDate=value.strftime("%Y-%m-%d"),
                open=base_close - 0.05,
                close=base_close,
                high=base_close + 0.12,
                low=base_close - 0.15,
                volume=1_000_000 + (index * 8_000),
                amount=(1_000_000 + (index * 8_000)) * base_close,
                turnoverRate=1.2 + (index % 5) * 0.1,
            )
        )
    return bars


@dataclass
class FakeDataProvider:
    fail_codes: set[str] | None = None
    snapshot_rows: list[MarketSnapshotRow] | None = None
    raw_frames: dict[str, object] | None = None

    provider_name = "tushare"

    def get_stock_profile(self, stock_code: str) -> StockProfile:
        name = {"600519": "Moutai", "000001": "PingAn"}.get(stock_code, stock_code)
        return StockProfile(
            stockCode=stock_code,
            tsCode=f"{stock_code}.SH",
            stockName=name,
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
        del start_date, end_date, adjust
        if self.fail_codes and stock_code in self.fail_codes:
            raise DataUnavailableError("upstream unavailable", provider=self.provider_name)
        return _sample_bars(stock_code)

    def get_market_snapshot(self, as_of_date: str | None = None) -> list[MarketSnapshotRow]:
        del as_of_date
        return self.snapshot_rows or []

    def get_raw_frame(self, dataset: str, **_params):
        import pandas as pd

        frame = (self.raw_frames or {}).get(dataset)
        return frame.copy() if isinstance(frame, pd.DataFrame) else pd.DataFrame()


@pytest.fixture
def install_gateway(monkeypatch):
    def _install(provider: FakeDataProvider):
        import app.routers.timing_v1 as timing_router

        monkeypatch.setattr(
            timing_router,
            "timing_gateway",
            TimingGateway(data_provider=provider),
        )

    return _install


def test_get_timing_bars_success(install_gateway) -> None:
    install_gateway(FakeDataProvider())

    response = client.get("/api/v1/timing/stocks/600519/bars")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["provider"] == "tushare"
    assert payload["data"]["stockCode"] == "600519"
    assert payload["data"]["stockName"] == "Moutai"
    assert payload["data"]["timeframe"] == "DAILY"
    assert len(payload["data"]["bars"]) == 280


def test_get_timing_bars_accepts_tushare_stock_code(install_gateway) -> None:
    install_gateway(FakeDataProvider())

    response = client.get("/api/v1/timing/stocks/600519.SH/bars")

    assert response.status_code == 200
    assert response.json()["data"]["stockCode"] == "600519"


@pytest.mark.parametrize(
    "timeframe",
    [
        "DAILY",
        "WEEKLY",
        "MONTHLY",
        "MINUTE_60",
        "MINUTE_30",
        "MINUTE_15",
        "MINUTE_1",
    ],
)
def test_get_timing_bars_serializes_non_finite_optional_values_as_null(
    install_gateway,
    timeframe: str,
) -> None:
    class MissingOptionalBarsProvider(FakeDataProvider):
        def get_bars(
            self,
            stock_code: str,
            timeframe: str = "DAILY",
            start_date: str | None = None,
            end_date: str | None = None,
            adjust: str = "qfq",
        ) -> list[DailyBar]:
            del start_date, end_date, adjust
            trade_date = (
                "2026-07-28 10:00:00"
                if timeframe.startswith("MINUTE_")
                else "2026-07-28"
            )
            return [
                DailyBar(
                    stockCode=stock_code,
                    tradeDate=trade_date,
                    open=10.0,
                    high=11.0,
                    low=9.0,
                    close=10.5,
                    volume=1_000.0,
                    amount=float("inf"),
                    turnoverRate=float("nan"),
                ),
            ]

    install_gateway(MissingOptionalBarsProvider())

    response = client.get(
        "/api/v1/timing/stocks/002475/bars",
        params={"timeframe": timeframe, "adjust": "qfq"},
    )

    assert response.status_code == 200
    bar = response.json()["data"]["bars"][0]
    assert bar["amount"] is None
    assert bar["turnoverRate"] is None


def test_get_timing_signal_success(install_gateway) -> None:
    install_gateway(FakeDataProvider())

    response = client.get("/api/v1/timing/stocks/600519/signals")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["provider"] == "tushare"
    assert payload["data"]["stockCode"] == "600519"
    assert payload["data"]["barsCount"] == 280
    assert payload["data"]["indicators"]["ema20"] > 0
    assert payload["data"]["signalContext"]["composite"]["direction"] in {
        "bullish",
        "neutral",
        "bearish",
    }
    assert len(payload["data"]["signalContext"]["engines"]) == 6


def test_get_timing_signal_includes_bars_when_requested(install_gateway) -> None:
    install_gateway(FakeDataProvider())

    response = client.get(
        "/api/v1/timing/stocks/600519/signals",
        params={"includeBars": "true"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["data"]["bars"]) == 280


def test_get_timing_signal_batch_reports_partial_errors(install_gateway) -> None:
    install_gateway(FakeDataProvider(fail_codes={"000001"}))

    response = client.post(
        "/api/v1/timing/stocks/signals/batch",
        json={"stockCodes": ["600519", "000001"]},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["provider"] == "tushare"
    assert len(payload["data"]["items"]) == 1
    assert payload["data"]["items"][0]["stockCode"] == "600519"
    assert len(payload["data"]["errors"]) == 1
    assert payload["data"]["errors"][0]["stockCode"] == "000001"
    assert any(warning["code"] == "partial_results" for warning in payload["meta"]["warnings"])


def test_get_timing_evidence_batch_returns_normalized_audit_inputs(install_gateway) -> None:
    import pandas as pd

    trade_date = "20260706"
    install_gateway(FakeDataProvider(raw_frames={
        "stk_factor_pro": pd.DataFrame({
            "ts_code": ["600519.SH"], "trade_date": [trade_date],
            "close": [47.9], "close_qfq": [23.95], "dmi_adx_qfq": [28.0],
            "rsi_qfq_12": [55.0], "macd_qfq": [0.8], "volume_ratio": [1.6],
        }),
        "cyq_perf": pd.DataFrame({
            "ts_code": ["600519.SH"], "trade_date": [trade_date],
            "cost_15pct": [40.0], "cost_50pct": [44.0], "weight_avg": [45.0],
            "winner_rate": [8.0],
        }),
        "stk_nineturn": pd.DataFrame({
            "ts_code": ["600519.SH"], "trade_date": [trade_date],
            "freq": ["daily"], "down_count": [8.0],
        }),
        "stk_auction_o": pd.DataFrame({
            "ts_code": ["600519.SH"], "trade_date": [trade_date],
            "close": [48.0], "vwap": [47.8], "open": [47.5], "high": [48.0],
            "low": [47.5], "vol": [1000.0], "amount": [47800.0],
        }),
    }))

    response = client.post("/api/v1/timing/stocks/evidence/batch", json={
        "stockCodes": ["600519"],
        "asOfDate": "2026-07-06",
        "timeframes": ["DAILY", "WEEKLY"],
        "indicatorIds": [
            "trend.close_above_ema20", "trend.adx", "chip.close_above_weighted_cost",
            "reversal.nine_down_count", "auction.close_above_vwap",
        ],
    })

    assert response.status_code == 200
    assert response.json()["data"]["items"], response.json()["data"]["errors"]
    item = response.json()["data"]["items"][0]
    features = {feature["indicatorId"]: feature for feature in item["features"]}
    assert features["trend.adx"]["value"] == 28.0
    assert features["trend.close_above_ema20"]["asOfDate"] == "2026-07-03"
    assert features["reversal.nine_down_count"]["value"] == 8.0
    assert features["auction.close_above_vwap"]["warnings"]
    assert features["chip.close_above_weighted_cost"]["normalizedValue"] == 22.5
    assert len(item["inputHash"]) == 64
    assert {entry["dataset"] for entry in item["dataManifest"]} >= {
        "bars", "stk_factor_pro", "cyq_perf", "stk_nineturn", "stk_auction_o",
    }
    weekly_manifest = next(
        entry for entry in item["dataManifest"] if entry.get("timeframe") == "WEEKLY"
    )
    assert weekly_manifest["completeness"] == "OBSERVATION_ONLY"


def test_get_timing_bars_rejects_invalid_timeframe() -> None:
    response = client.get(
        "/api/v1/timing/stocks/600519/bars",
        params={"timeframe": "INTRADAY"},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_timeframe"


def test_get_market_context_success(install_gateway) -> None:
    install_gateway(
        FakeDataProvider(
            snapshot_rows=[
                MarketSnapshotRow(
                    stockCode="600519",
                    stockName="Moutai",
                    industry="Liquor",
                    tradeDate="2026-07-06",
                    open=100.0,
                    high=103.0,
                    low=99.0,
                    close=102.0,
                    preClose=100.0,
                    changeAmount=2.0,
                    changePercent=2.5,
                    volume=1000.0,
                    amount=102000.0,
                    turnoverRate=1.1,
                    turnoverRateFree=1.4,
                    volumeRatio=1.2,
                    marketCap=2_000_000.0,
                    floatMarketCap=1_800_000.0,
                ),
                MarketSnapshotRow(
                    stockCode="000001",
                    stockName="PingAn",
                    industry="Bank",
                    tradeDate="2026-07-06",
                    open=10.0,
                    high=10.5,
                    low=9.8,
                    close=10.3,
                    preClose=10.0,
                    changeAmount=0.3,
                    changePercent=-1.6,
                    volume=2000.0,
                    amount=20600.0,
                    turnoverRate=0.8,
                    turnoverRateFree=1.0,
                    volumeRatio=0.9,
                    marketCap=300_000.0,
                    floatMarketCap=280_000.0,
                ),
                MarketSnapshotRow(
                    stockCode="300750",
                    stockName="CATL",
                    industry="Battery",
                    tradeDate="2026-07-06",
                    open=200.0,
                    high=210.0,
                    low=198.0,
                    close=209.0,
                    preClose=198.0,
                    changeAmount=11.0,
                    changePercent=5.8,
                    volume=3000.0,
                    amount=627000.0,
                    turnoverRate=2.4,
                    turnoverRateFree=2.9,
                    volumeRatio=1.5,
                    marketCap=900_000.0,
                    floatMarketCap=850_000.0,
                    limitStatus="D",
                    downLimit=208.5,
                ),
            ]
        )
    )

    response = client.get("/api/v1/timing/market/context")

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["provider"] == "tushare"
    assert payload["data"]["asOfDate"] == "2026-07-06"
    assert payload["data"]["latestBreadth"]["totalCount"] == 3
    assert len(payload["data"]["indexes"]) == 4
    assert payload["data"]["features"]["benchmarkStrength"] >= 0
    assert payload["data"]["availability"]["daily"] is True
    assert payload["data"]["availability"]["dailyBasic"] is True
    assert payload["data"]["latestVolatility"]["limitDownLikeCount"] >= 1
    assert "latestLeadership" in payload["data"]

"""A 股概念热力图快照测试。"""

from __future__ import annotations

from unittest.mock import patch

import pandas as pd
from fastapi.testclient import TestClient

from app.data_providers.contracts import MarketSnapshotRow
from app.gateway.common import gateway_cache
from app.gateway.market_gateway import MarketGateway
from app.infrastructure.cache.memory_cache import MemoryCache
from app.jobs.refresh_market_heatmap import RefreshMarketHeatmapJob
from app.main import app
from app.providers.tushare.client import TushareProviderClient


class FakeHeatmapProvider:
    provider_name = "tushare"

    def get_raw_frame(self, dataset: str, **params: str) -> pd.DataFrame:
        if dataset == "ths_index":
            return pd.DataFrame(
                [
                    {"ts_code": "885001.TI", "name": "算力", "count": 2, "exchange": "A", "type": "N"},
                    {"ts_code": "885002.TI", "name": "机器人", "count": 2, "exchange": "A", "type": "N"},
                ]
            )
        if dataset == "ths_hot":
            assert params == {"market": "概念板块", "is_new": "N"}
            return pd.DataFrame(
                [
                    {"trade_date": "20260723", "ts_code": "885001.TI", "rank": 1, "hot": 120},
                    {"trade_date": "20260724", "ts_code": "885001.TI", "rank": 1, "hot": 100},
                    {"trade_date": "20260724", "ts_code": "885001.TI", "rank": 2, "hot": 90},
                    {"trade_date": "20260724", "ts_code": "885002.TI", "rank": 3, "hot": 80},
                ]
            )
        if dataset == "ths_member":
            if params["ts_code"] == "885001.TI":
                return pd.DataFrame([
                    {"con_code": "000001.SZ", "con_name": "平安银行"},
                    {"con_code": "999999.SZ", "con_name": "非 A 股"},
                ])
            return pd.DataFrame([
                {"con_code": "000001.SZ", "con_name": "平安银行"},
                {"con_code": "300024.SZ", "con_name": "机器人"},
            ])
        if dataset == "rt_min":
            return pd.DataFrame([
                {"ts_code": "000001.SZ", "close": 11.0, "pre_close": 10.0},
                {"ts_code": "300024.SZ", "close": 9.5, "pre_close": 10.0},
            ])
        return pd.DataFrame()

    def get_market_snapshot(self):
        return [
            MarketSnapshotRow(
                stockCode="000001", stockName="平安银行", industry="银行", tradeDate="2026-07-23",
                open=None, high=None, low=None, close=10, preClose=10, changeAmount=0,
                changePercent=0, volume=None, amount=None, turnoverRate=None,
                turnoverRateFree=None, volumeRatio=None, marketCap=10000, floatMarketCap=8000,
            ),
            MarketSnapshotRow(
                stockCode="300024", stockName="机器人", industry="机械", tradeDate="2026-07-23",
                open=None, high=None, low=None, close=10, preClose=10, changeAmount=0,
                changePercent=-2, volume=None, amount=None, turnoverRate=None,
                turnoverRateFree=None, volumeRatio=None, marketCap=2000, floatMarketCap=1500,
            ),
        ]


class LargeConceptHeatmapProvider:
    provider_name = "tushare"

    def get_raw_frame(self, dataset: str, **params: str) -> pd.DataFrame:
        if dataset == "ths_index":
            return pd.DataFrame([
                {"ts_code": "885001.TI", "name": "大概念", "exchange": "A", "type": "N"}
            ])
        if dataset == "ths_hot":
            return pd.DataFrame([
                {"trade_date": "20260724", "ts_code": "885001.TI", "rank": 1, "hot": 100}
            ])
        if dataset == "ths_member":
            return pd.DataFrame([
                {"con_code": f"{index:06d}.SZ", "con_name": f"股票 {index}"}
                for index in range(1, 102)
            ])
        return pd.DataFrame()

    def get_market_snapshot(self):
        return [
            MarketSnapshotRow(
                stockCode=f"{index:06d}", stockName=f"股票 {index}", industry=None,
                tradeDate="2026-07-24", open=None, high=None, low=None, close=10,
                preClose=10, changeAmount=0, changePercent=1, volume=None, amount=None,
                turnoverRate=None, turnoverRateFree=None, volumeRatio=None,
                marketCap=index, floatMarketCap=index,
            )
            for index in range(1, 102)
        ]


def test_heatmap_snapshot_sorts_concepts_retains_cross_concept_stocks_and_uses_intraday_change() -> None:
    client = TushareProviderClient(provider=FakeHeatmapProvider())

    snapshot = client.get_market_heatmap_snapshot(limit=15, prefer_intraday=True)

    assert [item["conceptName"] for item in snapshot["concepts"]] == ["算力", "机器人"]
    assert snapshot["tradeDate"] == "2026-07-24"
    assert len({item["conceptCode"] for item in snapshot["concepts"]}) == 2
    assert snapshot["priceSource"] == "rt_min"
    assert snapshot["concepts"][0]["stocks"] == [
        {"stockCode": "000001", "stockName": "平安银行", "marketCap": 10000, "changePercent": 10.0}
    ]
    assert snapshot["concepts"][1]["marketCap"] == 12000
    assert snapshot["concepts"][1]["changePercent"] == 7.5


def test_heatmap_snapshot_limits_each_concept_to_top_100_stocks_by_market_cap() -> None:
    client = TushareProviderClient(provider=LargeConceptHeatmapProvider())

    snapshot = client.get_market_heatmap_snapshot(limit=15)

    concept = snapshot["concepts"][0]
    assert len(concept["stocks"]) == 100
    assert concept["stocks"][0]["stockCode"] == "000101"
    assert concept["stocks"][-1]["stockCode"] == "000002"
    assert concept["marketCap"] == sum(range(2, 102))


class FakeHeatmapClient:
    provider_name = "tushare"

    def get_market_heatmap_snapshot(self, limit: int, prefer_intraday: bool):
        return {
            "tradeDate": "2026-07-24",
            "marketCapAsOf": "2026-07-23",
            "priceSource": "rt_min" if prefer_intraday else "daily",
            "concepts": [
                {
                    "conceptCode": f"885{index:03d}.TI",
                    "conceptName": f"概念 {index}",
                    "hotRank": index,
                    "hotScore": 100 - index,
                    "marketCap": 1000,
                    "changePercent": 1.0,
                    "stocks": [],
                }
                for index in range(1, limit + 1)
            ],
        }


def test_gateway_returns_requested_concept_count_from_cached_fifteen_concept_snapshot() -> None:
    gateway = MarketGateway(provider_client=FakeHeatmapClient())
    gateway._cache = MemoryCache()

    response = gateway.get_heatmap_snapshot(request_id="test", concept_limit=8)

    assert len(response.data.concepts) == 8
    assert response.data.concepts[0].conceptName == "概念 1"


def test_heatmap_endpoint_accepts_supported_query_limits() -> None:
    client = TestClient(app)
    sample = FakeHeatmapClient().get_market_heatmap_snapshot(
        limit=15,
        prefer_intraday=False,
    )

    with patch(
        "app.providers.tushare.client.TushareProviderClient.get_market_heatmap_snapshot",
        return_value=sample,
    ):
        for concept_limit in (8, 15):
            gateway_cache.clear()
            response = client.get(
                "/api/v1/market/heatmap",
                params={"conceptLimit": concept_limit},
            )

            assert response.status_code == 200
            assert len(response.json()["data"]["concepts"]) == concept_limit


class ClosedMarketProviderClient:
    def is_a_share_trading_day(self, _trading_date) -> bool:
        return False


def test_refresh_job_skips_non_trading_day() -> None:
    job = RefreshMarketHeatmapJob(
        provider_client=ClosedMarketProviderClient(),
        now_fn=lambda: pd.Timestamp("2026-07-26 11:35:00", tz="Asia/Shanghai").to_pydatetime(),
    )

    summary = job.run()

    assert summary.stats["skipped"] is True
    assert summary.stats["reason"] == "non_trading_day"

from __future__ import annotations

from datetime import UTC, date, datetime
import json

import pytest
from fastapi.testclient import TestClient

from app.jobs.refresh_screening_stock_universe import RefreshScreeningStockUniverseJob
from app.main import app
from app.services.screening_stock_universe_store import (
    ScreeningStockUniverseStore,
    StockUniverseUnavailableError,
)
from app.services.screening_universe import ScreeningStockSearcher


def _records() -> list[dict[str, str]]:
    return [
        {"stockCode": "600519", "stockName": "贵州茅台", "market": "SH"},
        {"stockCode": "000001", "stockName": "平安银行", "market": "SZ"},
        {"stockCode": "920001", "stockName": "北交样本", "market": "BJ"},
    ]


def test_refresh_writes_valid_snapshot_atomically(tmp_path) -> None:
    class FakeProvider:
        provider_name = "tushare"

        def is_a_share_trading_day(self, trading_date: date) -> bool:
            return True

        def get_stock_search_universe(self):
            return _records()

    path = tmp_path / "screening_stock_universe.json"
    store = ScreeningStockUniverseStore(path)
    result = RefreshScreeningStockUniverseJob(
        provider=FakeProvider(),
        store=store,
        today_fn=lambda: date(2026, 7, 24),
    ).run()

    payload = json.loads(path.read_text(encoding="utf-8"))
    assert result.stats["recordCount"] == 3
    assert payload["schemaVersion"] == 1
    assert payload["provider"] == "tushare"
    assert payload["tradingDate"] == "2026-07-24"
    assert payload["recordCount"] == 3
    assert payload["records"][0]["stockCode"] == "000001"
    assert not list(tmp_path.glob("*.tmp"))


def test_refresh_skips_non_trading_day_without_fetching(tmp_path) -> None:
    class FakeProvider:
        provider_name = "tushare"

        def is_a_share_trading_day(self, trading_date: date) -> bool:
            return False

        def get_stock_search_universe(self):
            raise AssertionError("非交易日不应调用 stock_basic")

    result = RefreshScreeningStockUniverseJob(
        provider=FakeProvider(),
        store=ScreeningStockUniverseStore(tmp_path / "snapshot.json"),
        today_fn=lambda: date(2026, 7, 25),
    ).run()

    assert result.stats["skipped"] is True
    assert result.stats["reason"] == "non_trading_day"


def test_invalid_refresh_result_preserves_last_successful_snapshot(tmp_path) -> None:
    path = tmp_path / "snapshot.json"
    store = ScreeningStockUniverseStore(path)
    store.replace(
        records=_records(),
        trading_date=date(2026, 7, 24),
        provider="tushare",
        refreshed_at=datetime(2026, 7, 24, tzinfo=UTC),
    )
    previous = path.read_text(encoding="utf-8")

    class FakeProvider:
        provider_name = "tushare"

        def is_a_share_trading_day(self, trading_date: date) -> bool:
            return True

        def get_stock_search_universe(self):
            return []

    with pytest.raises(ValueError, match="刷新结果为空"):
        RefreshScreeningStockUniverseJob(
            provider=FakeProvider(),
            store=store,
            today_fn=lambda: date(2026, 7, 27),
        ).run()

    assert path.read_text(encoding="utf-8") == previous


def test_provider_failure_preserves_last_successful_snapshot(tmp_path) -> None:
    path = tmp_path / "snapshot.json"
    store = ScreeningStockUniverseStore(path)
    store.replace(
        records=_records(),
        trading_date=date(2026, 7, 24),
        provider="tushare",
    )
    previous = path.read_text(encoding="utf-8")

    class FakeProvider:
        provider_name = "tushare"

        def is_a_share_trading_day(self, trading_date: date) -> bool:
            return True

        def get_stock_search_universe(self):
            raise RuntimeError("TuShare 请求失败")

    with pytest.raises(RuntimeError, match="TuShare 请求失败"):
        RefreshScreeningStockUniverseJob(
            provider=FakeProvider(),
            store=store,
            today_fn=lambda: date(2026, 7, 27),
        ).run()

    assert path.read_text(encoding="utf-8") == previous


def test_searcher_reads_snapshot_and_reloads_when_file_changes(tmp_path) -> None:
    store = ScreeningStockUniverseStore(tmp_path / "snapshot.json")
    store.replace(
        records=_records()[:2],
        trading_date=date(2026, 7, 24),
        provider="tushare",
    )
    searcher = ScreeningStockSearcher(universe_loader=store.load_records, ttl_seconds=0)

    assert searcher.search("6005", 20)[0]["matchField"] == "CODE"
    assert searcher.search("平安", 20)[0]["matchField"] == "NAME"

    store.replace(
        records=[{"stockCode": "300750", "stockName": "宁德时代", "market": "SZ"}],
        trading_date=date(2026, 7, 25),
        provider="tushare",
    )
    assert searcher.search("宁德", 20) == [
        {
            "stockCode": "300750",
            "stockName": "宁德时代",
            "market": "SZ",
            "matchField": "NAME",
        }
    ]


def test_searcher_prioritizes_code_matches_over_earlier_name_matches() -> None:
    searcher = ScreeningStockSearcher(
        universe_loader=lambda: [
            {"stockCode": "600519", "stockName": "000 茅台", "market": "SH"},
            {"stockCode": "000001", "stockName": "平安银行", "market": "SZ"},
        ],
        ttl_seconds=300,
    )

    assert searcher.search("000", 20)[0]["stockCode"] == "000001"


def test_missing_snapshot_is_unavailable(tmp_path) -> None:
    with pytest.raises(StockUniverseUnavailableError, match="尚未首次刷新"):
        ScreeningStockUniverseStore(tmp_path / "missing.json").load_records()


def test_search_endpoint_returns_service_unavailable_before_first_refresh(monkeypatch, tmp_path) -> None:
    store = ScreeningStockUniverseStore(tmp_path / "missing.json")
    monkeypatch.setattr(
        "app.routers.screening_v1.get_stock_searcher",
        lambda: ScreeningStockSearcher(universe_loader=store.load_records, ttl_seconds=0),
    )

    response = TestClient(app).get(
        "/api/v1/screening/stocks/search",
        params={"keyword": "茅台", "limit": 20},
    )

    assert response.status_code == 503
    assert response.json()["detail"] == "筛选股票池尚未首次刷新"

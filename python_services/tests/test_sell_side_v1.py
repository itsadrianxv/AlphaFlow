from __future__ import annotations

import pandas as pd

from app.routers import sell_side_v1


def test_paged_raw_reads_all_report_pages(monkeypatch):
    calls: list[int] = []

    def fake_raw(_dataset: str, **params: str):
        offset = int(params["offset"])
        calls.append(offset)
        size = 3000 if offset == 0 else 2
        return pd.DataFrame({"ts_code": ["600000.SH"] * size})

    monkeypatch.setattr(sell_side_v1, "_raw", fake_raw)

    result = sell_side_v1._paged_raw("report_rc", start_date="20260101")

    assert len(result) == 3002
    assert calls == [0, 3000]


def test_chip_positions_applies_qfq_factor(monkeypatch):
    class Profile:
        tsCode = "600000.SH"
        stockName = "浦发银行"

    class Bar:
        def __init__(self, close: float):
            self.close = close

    class Provider:
        def get_stock_profile(self, _code: str):
            return Profile()

        def get_daily_bars(self, _code: str, **params):
            return [Bar(20.0 if params["adjust"] == "qfq" else 10.0)]

    cyq = pd.DataFrame([
        {"trade_date": "20260720", "cost_15pct": 8, "cost_50pct": 10, "cost_85pct": 12, "weight_avg": 10, "winner_rate": 50},
        {"trade_date": "20260725", "cost_15pct": 9, "cost_50pct": 11, "cost_85pct": 13, "weight_avg": 11, "winner_rate": 60},
    ])
    monkeypatch.setattr(sell_side_v1, "get_default_data_provider", lambda: Provider())
    monkeypatch.setattr(sell_side_v1, "_raw", lambda *_args, **_kwargs: cyq)

    result = __import__("asyncio").run(sell_side_v1.chip_positions(sell_side_v1.ChipPositionsRequest(stockCodes=["600000"])))

    item = result["data"]["items"][0]
    assert item["close"] == 20
    assert item["cost50"] == 22
    assert item["weightAvgChange5d"] == 2

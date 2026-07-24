import pandas as pd

from app.providers.tushare.client import TushareProviderClient


class FakeTushareRawProvider:
    provider_name = "tushare"

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, str]]] = []

    def get_raw_frame(self, dataset: str, **params: str) -> pd.DataFrame:
        self.calls.append((dataset, params))
        if dataset == "ths_index":
            return pd.DataFrame(
                [
                    {"ts_code": "885001.TI", "name": "算力概念", "count": 2, "exchange": "A", "type": "N"},
                    {"ts_code": "885002.TI", "name": "机器人概念", "count": 1, "exchange": "A", "type": "N"},
                ]
            )
        if dataset == "ths_hot":
            return pd.DataFrame(
                [
                    {"trade_date": "20260724", "ts_code": "885002.TI", "ts_name": "机器人概念", "rank": 2, "pct_change": 3.0, "current_price": 1200, "hot": 80, "rank_time": "2026-07-24 14:00:00", "rank_reason": "机器人加速"},
                    {"trade_date": "20260724", "ts_code": "885001.TI", "ts_name": "算力概念", "rank": 1, "pct_change": 5.0, "current_price": 1300, "hot": 100, "rank_time": "2026-07-24 14:00:00", "rank_reason": "算力走强"},
                ]
            )
        if dataset == "ths_daily":
            return pd.DataFrame(
                [
                    {"trade_date": f"202607{day:02d}", "pct_change": 1.0, "turnover_rate": 4.0}
                    for day in range(20, 25)
                ]
            )
        if dataset == "ths_member":
            code = params["ts_code"]
            return pd.DataFrame(
                [{"ts_code": code, "con_code": "603019.SH" if code == "885001.TI" else "300024.SZ", "con_name": "中科曙光" if code == "885001.TI" else "机器人"}]
            )
        if dataset == "limit_list_ths":
            limit_type = params["limit_type"]
            if limit_type == "连板池":
                return pd.DataFrame([{"ts_code": "603019.SH", "name": "中科曙光", "limit_type": limit_type, "tag": "3天2板", "status": "换手板", "lu_desc": "算力", "limit_order": 20_000_000, "limit_amount": 30_000_000, "turnover_rate": 12.0}])
            if limit_type == "炸板池":
                return pd.DataFrame([{"ts_code": "300024.SZ", "name": "机器人", "limit_type": limit_type, "tag": "首板", "status": "炸板", "lu_desc": "机器人", "limit_order": 0, "limit_amount": 0, "turnover_rate": 8.0}])
            return pd.DataFrame()
        return pd.DataFrame()


def test_hot_concept_boards_call_all_ths_special_topic_apis() -> None:
    provider = FakeTushareRawProvider()
    client = TushareProviderClient(provider=provider)

    boards = client.get_hot_concept_boards(limit=5)

    assert [board["theme"] for board in boards] == ["算力概念", "机器人概念"]
    assert boards[0]["candidateStocks"][0]["stockCode"] == "603019"
    assert boards[0]["candidateStocks"][0]["limitType"] == "连板池"
    assert boards[1]["marketEvidence"]["brokenLimitCount"] == 1
    datasets = [dataset for dataset, _ in provider.calls]
    assert "ths_index" in datasets
    assert "ths_hot" in datasets
    assert datasets.count("ths_daily") == 2
    assert datasets.count("ths_member") == 2
    assert datasets.count("limit_list_ths") == 5


def test_theme_interfaces_only_return_current_ths_hot_concept_boards() -> None:
    client = TushareProviderClient(provider=FakeTushareRawProvider())

    concepts = client.get_theme_concepts(theme="算力", limit=5)
    candidates = client.get_theme_candidates(theme="算力概念", limit=10)
    unknown = client.get_theme_candidates(theme="未知主题", limit=10)

    assert concepts["matchedBy"] == "ths_index"
    assert concepts["concepts"][0]["code"] == "885001.TI"
    assert candidates[0]["stockCode"] == "603019"
    assert unknown == []

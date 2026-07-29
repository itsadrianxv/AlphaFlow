import pandas as pd
import pytest

from app.services import schedule_capability_catalog as catalog


def test_catalog_excludes_realtime_and_includes_trade_calendar():
    ids = {item["id"] for item in catalog.list_schedule_capabilities()}
    assert "tushare.rt_min" not in ids
    assert "tushare.trade_cal" in ids


def test_query_rejects_unknown_dataset_and_large_window():
    with pytest.raises(ValueError, match="白名单"):
        catalog.query_tushare_dataset("not_real", {}, 10)
    with pytest.raises(ValueError, match="日期跨度"):
        catalog.query_tushare_dataset("moneyflow", {"start_date": "20250101", "end_date": "20260701"}, 10)


def test_query_forces_fields_and_bounds_rows(monkeypatch):
    class Provider:
        def get_raw_frame(self, dataset, **params):
            assert dataset == "moneyflow"
            assert "fields" in params
            return pd.DataFrame([{"ts_code": "000001.SZ"}, {"ts_code": "000002.SZ"}])

    monkeypatch.setattr(catalog, "get_default_data_provider", lambda: Provider())
    result = catalog.query_tushare_dataset("moneyflow", {"trade_date": "20260725"}, 1)
    assert len(result["rows"]) == 1
    assert result["truncated"] is True

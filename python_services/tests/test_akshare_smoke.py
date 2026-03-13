import os

import akshare as ak
import pytest


pytestmark = pytest.mark.skipif(
    os.getenv("RUN_AKSHARE_SMOKE") != "1",
    reason="Set RUN_AKSHARE_SMOKE=1 to execute live AkShare smoke tests",
)


def test_stock_zh_a_hist_smoke():
    df = ak.stock_zh_a_hist(
        symbol="000001",
        period="daily",
        start_date="20250101",
        end_date="20250301",
        adjust="qfq",
    )

    assert not df.empty
    assert "日期" in df.columns


def test_stock_board_concept_name_em_smoke():
    df = ak.stock_board_concept_name_em()

    assert not df.empty
    assert "板块名称" in df.columns


def test_stock_board_concept_cons_em_smoke():
    catalog = ak.stock_board_concept_name_em()
    concept_code = str(catalog.iloc[0]["板块代码"])
    df = ak.stock_board_concept_cons_em(symbol=concept_code)

    assert "代码" in df.columns


def test_stock_news_em_smoke():
    df = ak.stock_news_em(symbol="300308")

    assert "新闻标题" in df.columns

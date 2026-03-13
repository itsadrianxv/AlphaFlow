from unittest.mock import patch

import pandas as pd

from app.providers.akshare.client import AkShareProviderClient


@patch("app.providers.akshare.client.ak.stock_zh_a_hist")
def test_get_stock_bars_normalizes_start_and_end_dates(mock_hist):
    mock_hist.return_value = pd.DataFrame(
        {
            "日期": ["2025-01-02"],
            "开盘": [10.0],
            "收盘": [10.5],
            "最高": [10.8],
            "最低": [9.9],
            "成交量": [1000],
        }
    )

    client = AkShareProviderClient()
    client.get_stock_bars(
        stock_code="600519",
        start_date="2025-01-01",
        end_date="2025-03-01",
        adjust="qfq",
    )

    mock_hist.assert_called_once_with(
        symbol="600519",
        period="daily",
        start_date="20250101",
        end_date="20250301",
        adjust="qfq",
    )

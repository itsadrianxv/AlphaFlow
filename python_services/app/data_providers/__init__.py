"""统一数据 provider 入口。"""

from functools import lru_cache

from app.data_providers.contracts import (
    DataProvider,
    DailyBar,
    FinancialMetricPoint,
    HsgtFlowSnapshot,
    MacroSnapshot,
    MarketSnapshotRow,
    StockProfile,
)
from app.data_providers.tushare_provider import TushareProvider


@lru_cache(maxsize=1)
def get_default_data_provider() -> DataProvider:
    """返回默认统一数据 provider。"""
    return TushareProvider()


__all__ = [
    "DataProvider",
    "DailyBar",
    "FinancialMetricPoint",
    "HsgtFlowSnapshot",
    "MacroSnapshot",
    "MarketSnapshotRow",
    "StockProfile",
    "TushareProvider",
    "get_default_data_provider",
]

"""统一数据 provider 入口。"""

from app.data_providers.contracts import (
    DailyBar,
    FinancialMetricPoint,
    HsgtFlowSnapshot,
    MacroSnapshot,
    MarketSnapshotRow,
    StockProfile,
)
from app.data_providers.tushare_provider import TushareProvider

__all__ = [
    "DailyBar",
    "FinancialMetricPoint",
    "HsgtFlowSnapshot",
    "MacroSnapshot",
    "MarketSnapshotRow",
    "StockProfile",
    "TushareProvider",
]

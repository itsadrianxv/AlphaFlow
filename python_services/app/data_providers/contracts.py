"""统一数据 provider 的稳定数据结构与接口约定。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol

import pandas as pd


Timeframe = Literal[
    "DAILY",
    "WEEKLY",
    "MONTHLY",
    "MINUTE_60",
    "MINUTE_30",
    "MINUTE_15",
    "MINUTE_1",
]


@dataclass(frozen=True)
class StockProfile:
    stockCode: str
    tsCode: str
    stockName: str
    market: str
    sector: str
    industry: str


@dataclass(frozen=True)
class DailyBar:
    stockCode: str
    tradeDate: str
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    volume: float | None
    amount: float | None
    turnoverRate: float | None = None


@dataclass(frozen=True)
class MarketSnapshotRow:
    stockCode: str
    stockName: str
    industry: str
    tradeDate: str
    open: float | None
    high: float | None
    low: float | None
    close: float | None
    preClose: float | None
    changeAmount: float | None
    changePercent: float | None
    volume: float | None
    amount: float | None
    turnoverRate: float | None
    turnoverRateFree: float | None
    volumeRatio: float | None
    marketCap: float | None
    floatMarketCap: float | None
    limitStatus: str | None = None
    upLimit: float | None = None
    downLimit: float | None = None


@dataclass(frozen=True)
class FinancialMetricPoint:
    stockCode: str
    metricId: str
    period: str
    endDate: str
    value: float | None


@dataclass(frozen=True)
class MacroSnapshot:
    asOf: str
    gdpYoY: float | None
    m2YoY: float | None
    socialFinancingIncrement: float | None
    manufacturingPmi: float | None


@dataclass(frozen=True)
class HsgtFlowSnapshot:
    asOf: str
    northboundNetAmount: float | None
    southboundNetAmount: float | None


class DataProvider(Protocol):
    provider_name: str

    def get_stock_universe(self) -> list[StockProfile]:
        """返回当前 A 股股票池。"""

    def get_stock_profile(self, stock_code: str) -> StockProfile:
        """返回单只股票基础资料。"""

    def search_stocks(self, keyword: str, limit: int = 20) -> list[StockProfile]:
        """按代码、名称或行业搜索股票。"""

    def get_daily_bars(
        self,
        stock_code: str,
        start_date: str | None = None,
        end_date: str | None = None,
        adjust: str = "qfq",
    ) -> list[DailyBar]:
        """返回个股日线行情。"""

    def get_bars(
        self,
        stock_code: str,
        timeframe: Timeframe = "DAILY",
        start_date: str | None = None,
        end_date: str | None = None,
        adjust: str = "qfq",
    ) -> list[DailyBar]:
        """返回指定周期的个股行情。"""

    def get_bars_many(
        self,
        stock_codes: list[str],
        timeframe: Timeframe = "DAILY",
        start_date: str | None = None,
        end_date: str | None = None,
        adjust: str = "qfq",
        limit_bars: int = 120,
    ) -> dict[str, list[DailyBar]]:
        """批量返回多个股票的指定周期行情。"""

    def get_market_snapshot(self, as_of_date: str | None = None) -> list[MarketSnapshotRow]:
        """返回指定日期附近的全市场行情快照。"""

    def get_latest_metrics(
        self,
        stock_codes: list[str],
        metric_ids: list[str],
    ) -> dict[str, dict[str, float | None]]:
        """返回最新截面指标。"""

    def get_metric_series(
        self,
        stock_codes: list[str],
        metric_ids: list[str],
        periods: list[str],
    ) -> dict[str, dict[str, list[FinancialMetricPoint]]]:
        """返回财务指标序列。"""

    def get_macro_snapshot(self) -> MacroSnapshot:
        """返回宏观快照。"""

    def get_hsgt_flow_snapshot(self) -> HsgtFlowSnapshot:
        """返回沪深港通资金流快照。"""


class RawFrameProvider(Protocol):
    def get_raw_frame(self, dataset: str, **params: str) -> pd.DataFrame:
        """按 TuShare dataset 名称读取原始 DataFrame，仅供迁移期诊断使用。"""

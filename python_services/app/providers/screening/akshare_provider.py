"""AkShare-backed screening provider."""

from __future__ import annotations

from typing import Any

from app.providers.screening.base import ScreeningDataProvider
from app.services.akshare_adapter import AkShareAdapter


class AkShareScreeningProvider(ScreeningDataProvider):
    provider_name = "akshare"

    def get_all_stock_codes(self) -> list[str]:
        return AkShareAdapter.get_all_stock_codes()

    def get_stock_batch(self, stock_codes: list[str]) -> list[dict[str, Any]]:
        return AkShareAdapter.get_stocks_by_codes(stock_codes)

    def get_indicator_history(
        self,
        stock_code: str,
        indicator: str,
        years: int,
    ) -> list[dict[str, Any]]:
        return AkShareAdapter.get_indicator_history(stock_code, indicator, years)

    def get_available_industries(self) -> list[str]:
        return AkShareAdapter.get_available_industries()

    def resolve_stock_metadata(self, stock_codes: list[str]) -> dict[str, dict[str, str]]:
        snapshot = self.get_stock_batch(stock_codes)
        return {
            item["code"]: {
                "stockName": item.get("name", item["code"]),
                "market": "SH" if str(item["code"]).startswith("6") else "SZ",
            }
            for item in snapshot
        }

    def query_latest_metrics(
        self,
        stock_codes: list[str],
        indicator_ids: list[str],
    ) -> dict[str, dict[str, float | None]]:
        field_map = {
            "pe_ttm": "pe",
            "pb": "pb",
            "market_cap": "marketCap",
            "float_market_cap": "floatMarketCap",
            "total_shares": "totalShares",
            "float_a_shares": "floatAShares",
        }
        snapshot = self.get_stock_batch(stock_codes)
        latest = {stock_code: {} for stock_code in stock_codes}
        for item in snapshot:
            code = item["code"]
            latest[code] = {
                indicator_id: item.get(field_map[indicator_id])
                for indicator_id in indicator_ids
                if indicator_id in field_map
            }
        return latest

    def query_series_metrics(
        self,
        stock_codes: list[str],
        indicator_ids: list[str],
        periods: list[str],
    ) -> dict[str, dict[str, dict[str, float | None]]]:
        history_map = {
            "roe_report": "ROE",
            "revenue": "REVENUE",
            "net_profit_parent": "NET_PROFIT",
        }
        result = {
            stock_code: {
                indicator_id: {period: None for period in periods}
                for indicator_id in indicator_ids
            }
            for stock_code in stock_codes
        }
        for stock_code in stock_codes:
            for indicator_id in indicator_ids:
                history_indicator = history_map.get(indicator_id)
                if history_indicator is None:
                    continue
                history = self.get_indicator_history(stock_code, history_indicator, len(periods) + 2)
                history_by_period = {
                    point["date"][:4]: point.get("value")
                    for point in history
                    if str(point.get("date", "")).endswith("12-31")
                }
                for period in periods:
                    result[stock_code][indicator_id][period] = history_by_period.get(period)
        return result

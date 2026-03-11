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

"""Provider protocol used by legacy screening endpoints."""

from __future__ import annotations

from typing import Any, Protocol


class ScreeningDataProvider(Protocol):
    """Minimal contract required by legacy `/api/stocks/*` routes."""

    provider_name: str

    def get_all_stock_codes(self) -> list[str]:
        """Return the current screening universe as plain six-digit stock codes."""

    def get_stock_batch(self, stock_codes: list[str]) -> list[dict[str, Any]]:
        """Return stock snapshots for the requested stock codes."""

    def get_indicator_history(
        self,
        stock_code: str,
        indicator: str,
        years: int,
    ) -> list[dict[str, Any]]:
        """Return ascending historical points for the requested indicator."""

    def get_available_industries(self) -> list[str]:
        """Return the available industry names for the current universe."""

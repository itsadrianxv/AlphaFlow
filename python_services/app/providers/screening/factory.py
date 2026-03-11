"""Factory and fallback composition for screening providers."""

from __future__ import annotations

from functools import lru_cache
import logging
import os
from typing import Any

import pandas as pd

from app.providers.screening.akshare_provider import AkShareScreeningProvider
from app.providers.screening.base import ScreeningDataProvider
from app.providers.screening.ifind_provider import IFindScreeningProvider

LOGGER = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    raw_value = os.getenv(name)
    if raw_value is None:
        return default

    return raw_value.strip().lower() not in {"0", "false", "no", "off"}


def _chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def _now_timestamp() -> float:
    return pd.Timestamp.utcnow().timestamp()


class FallbackScreeningProvider(ScreeningDataProvider):
    """Primary provider with optional AkShare fallback and field enrichment."""

    provider_name = "screening-fallback"

    def __init__(
        self,
        *,
        primary: ScreeningDataProvider,
        fallback: ScreeningDataProvider | None = None,
    ) -> None:
        self._primary = primary
        self._fallback = fallback
        self._industries_cache: tuple[list[str], float] | None = None

    def get_all_stock_codes(self) -> list[str]:
        try:
            return self._primary.get_all_stock_codes()
        except Exception as exc:  # noqa: BLE001
            return self._use_fallback("get_all_stock_codes", exc)

    def get_stock_batch(self, stock_codes: list[str]) -> list[dict[str, Any]]:
        try:
            primary_items = self._primary.get_stock_batch(stock_codes)
        except Exception as exc:  # noqa: BLE001
            return self._use_fallback("get_stock_batch", exc, stock_codes)

        if not primary_items and self._fallback is not None:
            LOGGER.warning(
                "primary screening provider returned empty batch, falling back",
                extra={
                    "primary": self._primary.provider_name,
                    "fallback": self._fallback.provider_name,
                    "stock_count": len(stock_codes),
                },
            )
            return self._fallback.get_stock_batch(stock_codes)

        if self._fallback is None:
            return primary_items

        missing_codes = self._find_codes_needing_enrichment(primary_items, stock_codes)
        if not missing_codes:
            return primary_items

        try:
            fallback_items = self._fallback.get_stock_batch(missing_codes)
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning(
                "fallback enrichment skipped because secondary provider failed",
                extra={"fallback": self._fallback.provider_name, "error": str(exc)},
            )
            return primary_items

        return self._merge_stock_batches(primary_items, fallback_items, stock_codes)

    def get_indicator_history(
        self,
        stock_code: str,
        indicator: str,
        years: int,
    ) -> list[dict[str, Any]]:
        try:
            return self._primary.get_indicator_history(stock_code, indicator, years)
        except Exception as exc:  # noqa: BLE001
            return self._use_fallback(
                "get_indicator_history",
                exc,
                stock_code,
                indicator,
                years,
            )

    def get_available_industries(self) -> list[str]:
        cached = self._read_industries_cache()
        if cached is not None:
            return cached

        try:
            industries = self._derive_industries_from_universe()
        except Exception as exc:  # noqa: BLE001
            if self._fallback is None:
                raise
            LOGGER.warning(
                "industry derivation failed, using fallback provider directly",
                extra={"fallback": self._fallback.provider_name, "error": str(exc)},
            )
            industries = self._fallback.get_available_industries()

        self._industries_cache = (industries, _now_timestamp())
        return industries

    def _derive_industries_from_universe(self) -> list[str]:
        stock_codes = self.get_all_stock_codes()
        snapshot_reader = self._fallback or self

        industries: set[str] = set()
        for chunk in _chunked(stock_codes, 120):
            for item in snapshot_reader.get_stock_batch(chunk):
                industry = str(item.get("industry") or "").strip()
                if industry and industry != "未知":
                    industries.add(industry)

        return sorted(industries)

    def _use_fallback(
        self,
        method_name: str,
        error: Exception,
        *args: Any,
    ):
        if self._fallback is None:
            raise error

        LOGGER.warning(
            "primary screening provider failed, using fallback provider",
            extra={
                "primary": self._primary.provider_name,
                "fallback": self._fallback.provider_name,
                "method": method_name,
                "error": str(error),
            },
        )
        fallback_method = getattr(self._fallback, method_name)
        return fallback_method(*args)

    def _find_codes_needing_enrichment(
        self,
        primary_items: list[dict[str, Any]],
        requested_codes: list[str],
    ) -> list[str]:
        primary_map = {
            str(item.get("code") or "").strip(): item
            for item in primary_items
            if str(item.get("code") or "").strip()
        }

        missing_codes: list[str] = []
        for stock_code in requested_codes:
            item = primary_map.get(stock_code)
            if item is None:
                missing_codes.append(stock_code)
                continue

            if (
                not str(item.get("industry") or "").strip()
                or str(item.get("industry") or "").strip() == "未知"
                or not str(item.get("sector") or "").strip()
                or item.get("roe") is None
                or item.get("pe") is None
                or item.get("pb") is None
                or item.get("marketCap") is None
                or item.get("floatMarketCap") is None
            ):
                missing_codes.append(stock_code)

        return missing_codes

    def _merge_stock_batches(
        self,
        primary_items: list[dict[str, Any]],
        fallback_items: list[dict[str, Any]],
        requested_codes: list[str],
    ) -> list[dict[str, Any]]:
        merged_by_code = {
            str(item.get("code") or "").strip(): {**item}
            for item in primary_items
            if str(item.get("code") or "").strip()
        }
        fallback_by_code = {
            str(item.get("code") or "").strip(): item
            for item in fallback_items
            if str(item.get("code") or "").strip()
        }

        for stock_code, fallback_item in fallback_by_code.items():
            primary_item = merged_by_code.get(stock_code)
            if primary_item is None:
                merged_by_code[stock_code] = {**fallback_item}
                continue

            for field_name in ("name", "industry", "sector"):
                current_value = str(primary_item.get(field_name) or "").strip()
                if not current_value or current_value == "未知":
                    fallback_value = str(fallback_item.get(field_name) or "").strip()
                    if fallback_value:
                        primary_item[field_name] = fallback_value

            for field_name in (
                "roe",
                "pe",
                "pb",
                "eps",
                "revenue",
                "netProfit",
                "debtRatio",
                "marketCap",
                "floatMarketCap",
            ):
                if primary_item.get(field_name) is None and fallback_item.get(field_name) is not None:
                    primary_item[field_name] = fallback_item.get(field_name)

        return [
            merged_by_code[stock_code]
            for stock_code in requested_codes
            if stock_code in merged_by_code
        ]

    def _read_industries_cache(self) -> list[str] | None:
        if self._industries_cache is None:
            return None
        industries, cached_at = self._industries_cache
        if _now_timestamp() - cached_at > 300:
            return None
        return industries


@lru_cache(maxsize=1)
def get_screening_provider() -> ScreeningDataProvider:
    primary_provider_name = os.getenv("SCREENING_PRIMARY_PROVIDER", "ifind").strip().lower()
    enable_fallback = _env_bool("SCREENING_ENABLE_AKSHARE_FALLBACK", True)

    akshare_provider = AkShareScreeningProvider()
    if primary_provider_name == "akshare":
        return akshare_provider

    primary_provider = IFindScreeningProvider()
    fallback_provider = akshare_provider if enable_fallback else None
    return FallbackScreeningProvider(primary=primary_provider, fallback=fallback_provider)

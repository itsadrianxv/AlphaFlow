"""Cached stock universe search for the screening workbench."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class StockSearchMatch:
    stockCode: str
    stockName: str
    market: str
    matchField: str


class ScreeningStockSearcher:
    def __init__(
        self,
        *,
        universe_loader: Callable[[], list[dict[str, str]]],
        ttl_seconds: int = 300,
        now_fn: Callable[[], float] | None = None,
    ) -> None:
        self._universe_loader = universe_loader
        self._ttl_seconds = ttl_seconds
        self._now_fn = now_fn or (lambda: __import__("time").time())
        self._cache: tuple[float, list[dict[str, str]]] | None = None

    def search(self, keyword: str, limit: int) -> list[dict[str, str]]:
        normalized = keyword.strip().lower()
        if not normalized:
            return []

        code_matches: list[dict[str, str]] = []
        name_matches: list[dict[str, str]] = []
        for item in self._get_universe():
            stock_code = item["stockCode"]
            stock_name = item["stockName"]
            market = item.get("market", "")

            if normalized in stock_code.lower():
                code_matches.append(
                    StockSearchMatch(
                        stockCode=stock_code,
                        stockName=stock_name,
                        market=market,
                        matchField="CODE",
                    ).__dict__
                )
                continue

            if normalized in stock_name.lower():
                name_matches.append(
                    StockSearchMatch(
                        stockCode=stock_code,
                        stockName=stock_name,
                        market=market,
                        matchField="NAME",
                    ).__dict__
                )

        return [*code_matches, *name_matches][:limit]

    def get_universe(self) -> list[dict[str, str]]:
        return list(self._get_universe())

    @staticmethod
    def resolve_mentions(
        text: str, records: list[dict[str, str]]
    ) -> list[dict[str, str]]:
        normalized_text = text.strip().lower()
        if not normalized_text:
            return []

        matches = [
            {
                "stockCode": item["stockCode"],
                "stockName": item["stockName"],
            }
            for item in records
            if item["stockName"].strip().lower() in normalized_text
        ]
        return sorted(
            matches,
            key=lambda item: (-len(item["stockName"]), item["stockCode"]),
        )

    def _get_universe(self) -> list[dict[str, str]]:
        cached = self._cache
        now = self._now_fn()

        if cached and now - cached[0] < self._ttl_seconds:
            return cached[1]

        loaded = self._universe_loader()
        self._cache = (now, loaded)
        return loaded

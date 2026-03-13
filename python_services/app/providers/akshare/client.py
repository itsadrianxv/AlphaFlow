"""Provider client backed by AkShare adapters and strict intelligence loaders."""

from __future__ import annotations

import re

import akshare as ak
import pandas as pd

from app.gateway.common import GatewayError
from app.services.akshare_adapter import AkShareAdapter
from app.services.intelligence_data_adapter import IntelligenceDataAdapter


class AkShareProviderClient:
    provider_name = "akshare"

    def get_all_stock_codes(self) -> list[str]:
        return AkShareAdapter.get_all_stock_codes()

    def get_stock_universe(self) -> list[dict]:
        return AkShareAdapter.get_stock_universe()

    def get_stock_snapshot(self, stock_code: str) -> dict:
        items = AkShareAdapter.get_stocks_by_codes([stock_code])
        if not items:
            raise GatewayError(
                code="stock_not_found",
                message=f"未找到股票 {stock_code}",
                status_code=404,
                provider=self.provider_name,
            )

        return items[0]

    def get_stock_batch(self, stock_codes: list[str]) -> list[dict]:
        return AkShareAdapter.get_stocks_by_codes(stock_codes)

    def get_stock_bars(
        self,
        *,
        stock_code: str,
        start_date: str | None,
        end_date: str | None,
        adjust: str,
    ) -> pd.DataFrame:
        try:
            frame = ak.stock_zh_a_hist(
                symbol=stock_code,
                period="daily",
                start_date=_normalize_ymd(start_date) or "19700101",
                end_date=_normalize_ymd(end_date) or "20500101",
                adjust=adjust,
            )
        except Exception as exc:  # noqa: BLE001
            raise GatewayError(
                code="bars_unavailable",
                message=f"{stock_code} 日线行情获取失败: {exc}",
                status_code=503,
                provider=self.provider_name,
            ) from exc

        if frame.empty:
            raise GatewayError(
                code="bars_not_found",
                message=f"未找到 {stock_code} 的日线行情",
                status_code=404,
                provider=self.provider_name,
            )

        return frame

    def get_theme_candidates(self, theme: str, limit: int) -> list[dict]:
        return IntelligenceDataAdapter.get_candidates_strict(theme=theme, limit=limit)

    def get_theme_news(self, theme: str, days: int, limit: int) -> list[dict]:
        return IntelligenceDataAdapter.get_theme_news_strict(
            theme=theme,
            days=days,
            limit=limit,
        )

    def get_theme_concepts(self, theme: str, limit: int) -> dict:
        return IntelligenceDataAdapter.match_theme_concepts(theme=theme, limit=limit)

    def get_stock_evidence(self, stock_code: str, concept: str | None) -> dict:
        return IntelligenceDataAdapter.get_company_evidence_strict(
            stock_code=stock_code,
            concept=concept,
        )

    def get_stock_research_pack(self, stock_code: str, concept: str | None) -> dict:
        return IntelligenceDataAdapter.get_company_research_pack_strict(
            stock_code=stock_code,
            concept=concept,
        )

    def get_concept_catalog(self) -> list[dict]:
        try:
            df = ak.stock_board_concept_name_em()
        except Exception as exc:  # noqa: BLE001
            raise GatewayError(
                code="concept_catalog_unavailable",
                message=f"概念板块列表获取失败: {exc}",
                status_code=503,
                provider=self.provider_name,
            ) from exc

        items: list[dict] = []
        for _, row in df.iterrows():
            items.append(
                {
                    "conceptName": str(row.get("板块名称") or "").strip(),
                    "conceptCode": str(row.get("板块代码") or "").strip(),
                    "leadingStock": str(row.get("领涨股票") or "").strip(),
                    "changePercent": _safe_float(row.get("涨跌幅")),
                    "upCount": _safe_int(row.get("上涨家数")),
                    "downCount": _safe_int(row.get("下跌家数")),
                }
            )
        return [item for item in items if item["conceptName"]]

    def get_concept_constituents(
        self,
        concept_name: str,
        concept_code: str | None = None,
    ) -> list[dict]:
        symbol = concept_code.strip() if concept_code else concept_name

        try:
            df = ak.stock_board_concept_cons_em(symbol=symbol)
        except Exception as exc:  # noqa: BLE001
            raise GatewayError(
                code="concept_constituents_unavailable",
                message=f"概念成分股获取失败: {concept_name}: {exc}",
                status_code=503,
                provider=self.provider_name,
            ) from exc

        items: list[dict] = []
        for _, row in df.iterrows():
            items.append(
                {
                    "conceptName": concept_name,
                    "stockCode": str(row.get("代码") or "").strip(),
                    "stockName": str(row.get("名称") or "").strip(),
                    "latestPrice": _safe_float(row.get("最新价")),
                    "changePercent": _safe_float(row.get("涨跌幅")),
                    "turnoverRate": _safe_float(row.get("换手率")),
                }
            )
        return [item for item in items if item["stockCode"]]


def _normalize_ymd(value: str | None) -> str | None:
    if not value:
        return None

    matched = re.search(r"(\d{4})-?(\d{2})-?(\d{2})", value)
    if not matched:
        return None

    return "".join(matched.groups())


def _safe_float(value: object) -> float | None:
    if value is None:
        return None

    try:
        return float(str(value).replace("%", "").strip())
    except (TypeError, ValueError):
        return None


def _safe_int(value: object) -> int | None:
    if value is None:
        return None

    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None

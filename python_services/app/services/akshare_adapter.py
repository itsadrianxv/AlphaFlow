"""AkShare data adapter shared by screening and intelligence services."""

from __future__ import annotations

from datetime import datetime
import re
from typing import Any

import akshare as ak
import pandas as pd


class AkShareAdapter:
    """Thin wrapper around AkShare that normalizes column names and payloads."""

    @staticmethod
    def get_stock_universe() -> list[dict[str, Any]]:
        try:
            spot_df = ak.stock_zh_a_spot_em()
        except Exception as exc:  # noqa: BLE001
            raise Exception(f"获取全市场股票快照失败: {exc}") from exc

        if spot_df.empty:
            return []

        return [_map_spot_row(row) for _, row in spot_df.iterrows()]

    @staticmethod
    def get_all_stock_codes() -> list[str]:
        try:
            return [
                item["code"]
                for item in AkShareAdapter.get_stock_universe()
                if item.get("code")
            ]
        except Exception as exc:  # noqa: BLE001
            raise Exception(f"获取股票代码列表失败: {exc}") from exc

    @staticmethod
    def get_stocks_by_codes(codes: list[str]) -> list[dict[str, Any]]:
        normalized_codes = {
            normalized
            for normalized in (_normalize_stock_code(code) for code in codes)
            if normalized
        }
        if not normalized_codes:
            return []

        try:
            spot_df = ak.stock_zh_a_spot_em()
        except Exception as exc:  # noqa: BLE001
            raise Exception(f"批量查询股票数据失败: {exc}") from exc

        if spot_df.empty or "代码" not in spot_df.columns:
            return []

        working_df = spot_df.copy()
        working_df["__normalized_code__"] = working_df["代码"].map(_normalize_stock_code)
        filtered_df = working_df[
            working_df["__normalized_code__"].isin(normalized_codes)
        ]

        return [_map_spot_row(row) for _, row in filtered_df.iterrows()]

    @staticmethod
    def get_indicator_history(
        code: str,
        indicator: str,
        years: int,
    ) -> list[dict[str, Any]]:
        indicator_map = {
            "ROE": "净资产收益率",
            "PE": "市盈率",
            "PB": "市净率",
            "EPS": "每股收益",
            "REVENUE": "营业收入",
            "NET_PROFIT": "净利润",
            "DEBT_RATIO": "资产负债率",
        }

        try:
            df = ak.stock_financial_analysis_indicator(symbol=code)
        except Exception as exc:  # noqa: BLE001
            raise Exception(f"查询股票 {code} 的 {indicator} 历史数据失败: {exc}") from exc

        if df.empty:
            return []

        indicator_column = indicator_map.get(indicator, indicator)
        trimmed_df = df.head(max(years, 1) * 4)

        results: list[dict[str, Any]] = []
        for _, row in trimmed_df.iterrows():
            results.append(
                {
                    "date": str(row.get("日期") or ""),
                    "value": _safe_float(row.get(indicator_column)),
                    "isEstimated": False,
                }
            )

        return results

    @staticmethod
    def get_available_industries() -> list[str]:
        try:
            df = ak.stock_board_industry_name_em()
        except Exception as exc:  # noqa: BLE001
            raise Exception(f"获取行业列表失败: {exc}") from exc

        if df.empty or "板块名称" not in df.columns:
            return []

        return [
            str(item).strip()
            for item in df["板块名称"].tolist()
            if str(item).strip()
        ]


def _safe_float(value: Any) -> float | None:
    if value is None or pd.isna(value):
        return None

    text = str(value).strip().replace(",", "")
    if not text:
        return None
    if text.endswith("%"):
        text = text[:-1]

    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _normalize_stock_code(value: Any) -> str:
    if value is None:
        return ""

    matched = re.search(r"(\d{6})", str(value).upper())
    return matched.group(1) if matched else ""


def _map_spot_row(row: pd.Series) -> dict[str, Any]:
    code = _normalize_stock_code(row.get("代码"))
    return {
        "code": code,
        "name": str(row.get("名称") or "").strip(),
        "industry": str(row.get("行业") or row.get("所处行业") or "未知").strip() or "未知",
        "sector": str(row.get("板块") or "主板").strip() or "主板",
        "roe": _safe_float(row.get("ROE")),
        "pe": _safe_float(row.get("市盈率-动态") or row.get("市盈率")),
        "pb": _safe_float(row.get("市净率")),
        "eps": _safe_float(row.get("每股收益")),
        "revenue": _safe_float(row.get("营业收入")),
        "netProfit": _safe_float(row.get("净利润")),
        "debtRatio": _safe_float(row.get("资产负债率")),
        "marketCap": _safe_float(row.get("总市值")),
        "floatMarketCap": _safe_float(row.get("流通市值")),
        "turnoverRate": _safe_float(row.get("换手率")),
        "changePercent": _safe_float(row.get("涨跌幅")),
        "dataDate": datetime.now().strftime("%Y-%m-%d"),
    }

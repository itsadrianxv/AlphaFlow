"""TuShare-backed screening provider."""

from __future__ import annotations

from datetime import date, timedelta
from importlib.util import find_spec
import math
import os
from typing import Any

import pandas as pd

from app.providers.screening.base import ScreeningDataProvider

_UNIVERSE_CACHE_TTL_SECONDS = 86_400
_DAILY_BASIC_CACHE_TTL_SECONDS = 21_600
_SERIES_CACHE_TTL_SECONDS = 3_600

_LATEST_FIELD_SPECS: dict[str, str] = {
    "pe_ttm": "pe_ttm",
    "pb": "pb",
    "market_cap": "total_mv",
    "float_market_cap": "circ_mv",
    "total_shares": "total_share",
    "float_a_shares": "float_share",
}

_SERIES_FIELD_SPECS: dict[str, tuple[str, str]] = {
    "roe_report": ("fina_indicator", "roe"),
    "eps_report": ("fina_indicator", "eps"),
    "revenue": ("income", "total_revenue"),
    "net_profit_parent": ("income", "n_income_attr_p"),
}

_LEGACY_HISTORY_MAP = {
    "ROE": "roe_report",
    "EPS": "eps_report",
    "REVENUE": "revenue",
    "NET_PROFIT": "net_profit_parent",
    "DEBT_RATIO": "asset_liability_ratio",
    "roe_report": "roe_report",
    "eps_report": "eps_report",
    "revenue": "revenue",
    "net_profit_parent": "net_profit_parent",
    "asset_liability_ratio": "asset_liability_ratio",
}


def _create_tushare_client(token: str):
    if find_spec("tushare") is None:
        raise RuntimeError("tushare SDK is not installed")

    import tushare as ts  # pragma: no cover - runtime dependency

    return ts.pro_api(token)


def _now_timestamp() -> float:
    return pd.Timestamp.utcnow().timestamp()


class TushareScreeningProvider(ScreeningDataProvider):
    provider_name = "tushare"

    def __init__(self, *, token: str | None = None) -> None:
        self._token = token
        self._client = None
        self._universe_cache: tuple[float, dict[str, dict[str, str]]] | None = None
        self._daily_basic_cache: tuple[float, str, dict[str, dict[str, Any]]] | None = None
        self._series_cache: dict[tuple[str, str], tuple[float, pd.DataFrame]] = {}

    def get_all_stock_codes(self) -> list[str]:
        return list(self._load_universe_map().keys())

    def get_stock_batch(self, stock_codes: list[str]) -> list[dict[str, Any]]:
        normalized_codes = self._normalize_requested_codes(stock_codes)
        if not normalized_codes:
            return []

        metadata_map = self.resolve_stock_metadata(normalized_codes)
        latest_metrics = self.query_latest_metrics(
            normalized_codes,
            list(_LATEST_FIELD_SPECS.keys()),
        )

        stocks: list[dict[str, Any]] = []
        for stock_code in normalized_codes:
            metadata = metadata_map.get(stock_code, {})
            latest_snapshot = latest_metrics.get(stock_code, {})
            latest_series = self._get_latest_series_snapshot(stock_code)
            if not metadata and not latest_snapshot and not latest_series:
                continue

            stocks.append(
                {
                    "code": stock_code,
                    "name": metadata.get("stockName", stock_code),
                    "industry": metadata.get("industry", ""),
                    "sector": metadata.get("sector", self._infer_sector(stock_code)),
                    "roe": latest_series.get("roe_report"),
                    "pe": latest_snapshot.get("pe_ttm"),
                    "pb": latest_snapshot.get("pb"),
                    "eps": latest_series.get("eps_report"),
                    "revenue": latest_series.get("revenue"),
                    "netProfit": latest_series.get("net_profit_parent"),
                    "debtRatio": latest_series.get("asset_liability_ratio"),
                    "marketCap": latest_snapshot.get("market_cap"),
                    "floatMarketCap": latest_snapshot.get("float_market_cap"),
                    "totalShares": latest_snapshot.get("total_shares"),
                    "floatAShares": latest_snapshot.get("float_a_shares"),
                    "dataDate": self._latest_daily_trade_date(),
                }
            )

        return stocks

    def get_indicator_history(
        self,
        stock_code: str,
        indicator: str,
        years: int,
    ) -> list[dict[str, Any]]:
        metric_id = _LEGACY_HISTORY_MAP.get(indicator, indicator)
        if metric_id not in {*_SERIES_FIELD_SPECS.keys(), "asset_liability_ratio"}:
            raise ValueError(f"Unsupported indicator history: {indicator}")

        normalized_code = self._normalize_stock_code(stock_code)
        if not normalized_code:
            raise ValueError(f"Invalid stock code: {stock_code}")

        if metric_id == "asset_liability_ratio":
            frame = self._load_series_frame("balancesheet", normalized_code)
        else:
            dataset, _field = _SERIES_FIELD_SPECS[metric_id]
            frame = self._load_series_frame(dataset, normalized_code)

        annual_rows = self._sort_frame_by_end_date(frame)
        annual_rows = annual_rows[annual_rows["end_date"].str.endswith("1231")]
        annual_rows = annual_rows.tail(years)

        history_points: list[dict[str, Any]] = []
        for _, row in annual_rows.iterrows():
            end_date = str(row["end_date"])
            value = self._resolve_series_metric_value(normalized_code, metric_id, end_date)
            history_points.append(
                {
                    "date": f"{end_date[:4]}-{end_date[4:6]}-{end_date[6:8]}",
                    "value": value,
                    "isEstimated": False,
                }
            )
        return history_points

    def get_available_industries(self) -> list[str]:
        universe_map = self._load_universe_map()
        industries = {
            record["industry"]
            for record in universe_map.values()
            if record.get("industry")
        }
        return sorted(industries)

    def resolve_stock_metadata(self, stock_codes: list[str]) -> dict[str, dict[str, str]]:
        universe_map = self._load_universe_map()
        metadata: dict[str, dict[str, str]] = {}
        for stock_code in self._normalize_requested_codes(stock_codes):
            record = universe_map.get(stock_code)
            if record is None:
                continue
            metadata[stock_code] = {
                "stockName": record["name"],
                "market": record["market"],
                "industry": record["industry"],
                "sector": self._infer_sector(stock_code),
            }
        return metadata

    def query_latest_metrics(
        self,
        stock_codes: list[str],
        indicator_ids: list[str],
    ) -> dict[str, dict[str, float | None]]:
        snapshot_map = self._load_daily_basic_map()
        results = {stock_code: {} for stock_code in self._normalize_requested_codes(stock_codes)}
        for stock_code in results:
            row = snapshot_map.get(stock_code, {})
            metric_values: dict[str, float | None] = {}
            for indicator_id in indicator_ids:
                field_name = _LATEST_FIELD_SPECS.get(indicator_id)
                if field_name is None:
                    continue
                metric_values[indicator_id] = self._normalize_latest_metric(indicator_id, row.get(field_name))
            results[stock_code] = metric_values
        return results

    def query_series_metrics(
        self,
        stock_codes: list[str],
        indicator_ids: list[str],
        periods: list[str],
    ) -> dict[str, dict[str, dict[str, float | None]]]:
        results = {
            stock_code: {
                indicator_id: {period: None for period in periods}
                for indicator_id in indicator_ids
            }
            for stock_code in self._normalize_requested_codes(stock_codes)
        }

        for stock_code in results:
            for indicator_id in indicator_ids:
                for period in periods:
                    end_date = self._period_to_end_date(period)
                    results[stock_code][indicator_id][period] = self._resolve_series_metric_value(
                        stock_code,
                        indicator_id,
                        end_date,
                    )

        return results

    def _get_client(self):
        if self._client is not None:
            return self._client

        token = self._token or os.getenv("TUSHARE_TOKEN", "").strip()
        if not token:
            raise RuntimeError("Missing TUSHARE_TOKEN")

        self._client = _create_tushare_client(token)
        return self._client

    def _load_universe_map(self) -> dict[str, dict[str, str]]:
        cached = self._universe_cache
        if cached is not None and _now_timestamp() - cached[0] <= _UNIVERSE_CACHE_TTL_SECONDS:
            return cached[1]

        frame = self._get_client().stock_basic(
            exchange="",
            list_status="L",
            fields="ts_code,symbol,name,industry",
        )
        universe_map: dict[str, dict[str, str]] = {}
        for _, row in frame.iterrows():
            stock_code = self._normalize_stock_code(row.get("symbol"))
            if not stock_code:
                continue
            universe_map[stock_code] = {
                "ts_code": str(row.get("ts_code") or "").strip(),
                "name": str(row.get("name") or stock_code).strip(),
                "industry": str(row.get("industry") or "").strip(),
                "market": self._infer_market(stock_code),
            }
        self._universe_cache = (_now_timestamp(), universe_map)
        return universe_map

    def _load_daily_basic_map(self) -> dict[str, dict[str, Any]]:
        cached = self._daily_basic_cache
        if cached is not None and _now_timestamp() - cached[0] <= _DAILY_BASIC_CACHE_TTL_SECONDS:
            return cached[2]

        client = self._get_client()
        chosen_trade_date = ""
        snapshot_map: dict[str, dict[str, Any]] = {}
        for trade_date in self._today_trade_dates():
            frame = client.daily_basic(
                trade_date=trade_date,
                fields="ts_code,pe_ttm,pb,total_mv,circ_mv,total_share,float_share",
            )
            if frame is None or frame.empty:
                continue
            chosen_trade_date = trade_date
            for _, row in frame.iterrows():
                stock_code = self._normalize_stock_code(row.get("ts_code"))
                if stock_code:
                    snapshot_map[stock_code] = {
                        field_name: row.get(field_name)
                        for field_name in (
                            "pe_ttm",
                            "pb",
                            "total_mv",
                            "circ_mv",
                            "total_share",
                            "float_share",
                        )
                    }
            if snapshot_map:
                break

        self._daily_basic_cache = (_now_timestamp(), chosen_trade_date, snapshot_map)
        return snapshot_map

    def _load_series_frame(self, dataset: str, stock_code: str) -> pd.DataFrame:
        ts_code = self._lookup_ts_code(stock_code)
        cache_key = (dataset, ts_code)
        cached = self._series_cache.get(cache_key)
        if cached is not None and _now_timestamp() - cached[0] <= _SERIES_CACHE_TTL_SECONDS:
            return cached[1]

        client = self._get_client()
        loader = getattr(client, dataset)
        try:
            frame = loader(ts_code=ts_code)
        except Exception:  # noqa: BLE001
            frame = pd.DataFrame()
        if frame is None:
            frame = pd.DataFrame()
        frame = frame.copy()
        if "end_date" in frame.columns:
            frame["end_date"] = frame["end_date"].astype(str)
        self._series_cache[cache_key] = (_now_timestamp(), frame)
        return frame

    def _get_latest_series_snapshot(self, stock_code: str) -> dict[str, float | None]:
        latest_end_date = self._latest_available_report_end_date(stock_code)
        if latest_end_date is None:
            return {
                "roe_report": None,
                "eps_report": None,
                "revenue": None,
                "net_profit_parent": None,
                "asset_liability_ratio": None,
            }
        return {
            "roe_report": self._resolve_series_metric_value(stock_code, "roe_report", latest_end_date),
            "eps_report": self._resolve_series_metric_value(stock_code, "eps_report", latest_end_date),
            "revenue": self._resolve_series_metric_value(stock_code, "revenue", latest_end_date),
            "net_profit_parent": self._resolve_series_metric_value(stock_code, "net_profit_parent", latest_end_date),
            "asset_liability_ratio": self._resolve_series_metric_value(stock_code, "asset_liability_ratio", latest_end_date),
        }

    def _latest_available_report_end_date(self, stock_code: str) -> str | None:
        fina_frame = self._sort_frame_by_end_date(self._load_series_frame("fina_indicator", stock_code))
        income_frame = self._sort_frame_by_end_date(self._load_series_frame("income", stock_code))
        for frame in (fina_frame, income_frame):
            if not frame.empty:
                return str(frame.iloc[0]["end_date"])
        return None

    def _resolve_series_metric_value(
        self,
        stock_code: str,
        indicator_id: str,
        end_date: str,
    ) -> float | None:
        if indicator_id == "asset_liability_ratio":
            return self._resolve_asset_liability_ratio(stock_code, end_date)

        dataset_field = _SERIES_FIELD_SPECS.get(indicator_id)
        if dataset_field is None:
            return None

        dataset, field_name = dataset_field
        frame = self._load_series_frame(dataset, stock_code)
        matched = frame[frame["end_date"].astype(str) == end_date]
        if matched.empty:
            return None
        raw_value = matched.iloc[0].get(field_name)
        if indicator_id in {"roe_report"}:
            return self._normalize_ratio(raw_value)
        if indicator_id in {"revenue", "net_profit_parent"}:
            return self._normalize_amount(raw_value)
        return self._safe_float(raw_value)

    def _resolve_asset_liability_ratio(self, stock_code: str, end_date: str) -> float | None:
        fina_frame = self._load_series_frame("fina_indicator", stock_code)
        matched_fina = fina_frame[fina_frame["end_date"].astype(str) == end_date]
        if not matched_fina.empty:
            for candidate in ("debt_to_assets", "assets_to_eqt"):
                if candidate not in matched_fina.columns:
                    continue
                value = self._normalize_ratio(matched_fina.iloc[0].get(candidate))
                if value is not None:
                    return value

        balance_frame = self._load_series_frame("balancesheet", stock_code)
        matched_balance = balance_frame[balance_frame["end_date"].astype(str) == end_date]
        if matched_balance.empty:
            return None

        total_assets = self._safe_float(matched_balance.iloc[0].get("total_assets"))
        total_liab = self._safe_float(matched_balance.iloc[0].get("total_liab"))
        if total_assets in {None, 0} or total_liab is None:
            return None
        return total_liab / total_assets

    def _latest_daily_trade_date(self) -> str:
        daily_basic_cache = self._daily_basic_cache
        if daily_basic_cache is None:
            self._load_daily_basic_map()
            daily_basic_cache = self._daily_basic_cache
        if daily_basic_cache is None or not daily_basic_cache[1]:
            return date.today().strftime("%Y-%m-%d")
        trade_date = daily_basic_cache[1]
        return f"{trade_date[:4]}-{trade_date[4:6]}-{trade_date[6:8]}"

    def _lookup_ts_code(self, stock_code: str) -> str:
        record = self._load_universe_map().get(stock_code)
        if record is None:
            raise ValueError(f"Unknown stock code: {stock_code}")
        return record["ts_code"]

    def _normalize_latest_metric(self, indicator_id: str, value: Any) -> float | None:
        numeric_value = self._safe_float(value)
        if numeric_value is None:
            return None
        if indicator_id in {"market_cap", "float_market_cap"}:
            return numeric_value / 10_000
        if indicator_id in {"total_shares", "float_a_shares"}:
            return numeric_value * 10_000
        return numeric_value

    def _sort_frame_by_end_date(self, frame: pd.DataFrame) -> pd.DataFrame:
        if frame.empty or "end_date" not in frame.columns:
            return frame.copy()
        return frame.assign(end_date=frame["end_date"].astype(str)).sort_values("end_date", ascending=False)

    def _period_to_end_date(self, period: str) -> str:
        if len(period) == 4 and period.isdigit():
            return f"{period}1231"
        if len(period) == 6 and period[:4].isdigit() and period[4] == "Q":
            quarter = period[5]
            quarter_map = {"1": "0331", "2": "0630", "3": "0930", "4": "1231"}
            if quarter in quarter_map:
                return f"{period[:4]}{quarter_map[quarter]}"
        return period.replace("-", "")

    def _today_trade_dates(self) -> list[str]:
        today = date.today()
        return [
            (today - timedelta(days=offset)).strftime("%Y%m%d")
            for offset in range(0, 8)
        ]

    def _normalize_requested_codes(self, stock_codes: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for stock_code in stock_codes:
            code = self._normalize_stock_code(stock_code)
            if code and code not in seen:
                normalized.append(code)
                seen.add(code)
        return normalized

    def _normalize_stock_code(self, raw_code: Any) -> str:
        text = str(raw_code or "").strip().upper()
        if "." in text:
            text = text.split(".", 1)[0]
        if not text.isdigit() or len(text) != 6:
            return ""
        return text

    def _safe_float(self, value: Any) -> float | None:
        if value is None:
            return None
        if isinstance(value, float) and math.isnan(value):
            return None
        text = str(value).strip()
        if not text or text.lower() in {"nan", "none", "null", "--"}:
            return None
        try:
            return float(text.replace(",", ""))
        except ValueError:
            return None

    def _normalize_ratio(self, value: Any) -> float | None:
        numeric_value = self._safe_float(value)
        if numeric_value is None:
            return None
        return numeric_value / 100 if abs(numeric_value) > 1 else numeric_value

    def _normalize_amount(self, value: Any) -> float | None:
        numeric_value = self._safe_float(value)
        if numeric_value is None:
            return None
        return numeric_value / 100_000_000

    def _infer_market(self, stock_code: str) -> str:
        if stock_code.startswith("6"):
            return "SH"
        if stock_code.startswith(("4", "8", "920")):
            return "BJ"
        return "SZ"

    def _infer_sector(self, stock_code: str) -> str:
        if stock_code.startswith(("688", "689")):
            return "科创板"
        if stock_code.startswith(("300", "301", "302")):
            return "创业板"
        if stock_code.startswith(("4", "8", "920")):
            return "北交所"
        return "主板"

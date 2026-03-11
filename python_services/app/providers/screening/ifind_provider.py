"""iFinD-backed screening provider."""

from __future__ import annotations

from datetime import date
import logging
import math
import os
import re
from typing import Any

import pandas as pd

from app.providers.screening.base import ScreeningDataProvider

try:
    from iFinDPy import THS_BD, THS_DR, THS_DS, THS_RQ, THS_iFinDLogin

    IFIND_AVAILABLE = True
except ImportError:  # pragma: no cover - runtime-dependent
    THS_BD = THS_DR = THS_DS = THS_RQ = THS_iFinDLogin = None
    IFIND_AVAILABLE = False

LOGGER = logging.getLogger(__name__)

_UNIVERSE_BLOCK_ID = "001005001"
_UNIVERSE_FIELDS = "ths_stock_code_stock,ths_stock_short_name_stock"
_STATEMENT_PARAM = "101"
_UNIVERSE_CACHE_TTL_SECONDS = 300

_CODE_COLUMN_ALIASES = {
    "code",
    "stockcode",
    "thscode",
    "thsstockcode",
    "thsstockcodestock",
    "p03291f002",
}
_TIME_COLUMN_ALIASES = {"time", "date", "tradedate", "reportdate", "datetime"}

_BATCH_FIELD_SPECS: dict[str, tuple[str, str]] = {
    "name": ("ths_stock_short_name_stock", ""),
    "roe": ("ths_roe_ttm_stock", _STATEMENT_PARAM),
    "pe": ("ths_pe_ttm_stock", _STATEMENT_PARAM),
    "pb": ("ths_pb_latest_stock", _STATEMENT_PARAM),
    "eps": ("ths_eps_ttm_stock", _STATEMENT_PARAM),
    "revenue": ("ths_revenue_stock", _STATEMENT_PARAM),
    "netProfit": ("ths_np_atoopc_stock", _STATEMENT_PARAM),
    "debtRatio": ("ths_asset_liab_ratio_stock", _STATEMENT_PARAM),
    "totalShares": ("ths_total_shares_stock", ""),
    "floatAShares": ("ths_float_ashare_stock", ""),
}

_HISTORY_FIELD_SPECS: dict[str, tuple[str, str]] = {
    "ROE": ("ths_roe_stock", _STATEMENT_PARAM),
    "REVENUE": ("ths_revenue_stock", _STATEMENT_PARAM),
    "NET_PROFIT": ("ths_np_atoopc_stock", _STATEMENT_PARAM),
}


class IFindScreeningProvider(ScreeningDataProvider):
    provider_name = "ifind"

    def __init__(
        self,
        *,
        username: str | None = None,
        password: str | None = None,
    ) -> None:
        self._username = username
        self._password = password
        self._is_logged_in = False
        self._universe_cache: tuple[float, list[str]] | None = None

    def get_all_stock_codes(self) -> list[str]:
        cached_codes = self._read_universe_cache()
        if cached_codes is not None:
            return cached_codes

        self._ensure_login()
        result = THS_DR(_UNIVERSE_BLOCK_ID, _UNIVERSE_FIELDS, f"block:{_UNIVERSE_BLOCK_ID}")
        frame = self._extract_frame(self._ensure_success(result, "THS_DR"))

        if frame.empty:
            raise RuntimeError("iFinD 未返回沪深 A 股成分股数据")

        code_column = self._find_first_matching_column(frame, _CODE_COLUMN_ALIASES)
        if code_column is None:
            raise RuntimeError("iFinD 板块成分返回缺少股票代码列")

        codes: list[str] = []
        seen: set[str] = set()
        for raw_code in frame[code_column].tolist():
            stock_code = self._normalize_stock_code(raw_code)
            if not stock_code or stock_code in seen:
                continue
            if stock_code[0] not in {"0", "3", "6"}:
                continue
            seen.add(stock_code)
            codes.append(stock_code)

        if not codes:
            raise RuntimeError("iFinD 沪深 A 股股票池为空")

        self._universe_cache = (_now_timestamp(), codes)
        return codes

    def get_stock_batch(self, stock_codes: list[str]) -> list[dict[str, Any]]:
        normalized_codes = self._normalize_requested_codes(stock_codes)
        if not normalized_codes:
            return []

        self._ensure_login()

        field_maps: dict[str, dict[str, Any]] = {}
        for logical_field, (indicator, params) in _BATCH_FIELD_SPECS.items():
            try:
                field_maps[logical_field] = self._query_batch_basic_data(
                    normalized_codes,
                    indicator,
                    params,
                )
            except Exception as exc:  # noqa: BLE001
                LOGGER.warning(
                    "iFinD batch field query failed",
                    extra={
                        "provider": self.provider_name,
                        "indicator": indicator,
                        "error": str(exc),
                    },
                )
                field_maps[logical_field] = {}

        latest_price_map: dict[str, Any] = {}
        try:
            latest_price_map = self._query_batch_realtime_data(
                normalized_codes,
                "latest",
            )
        except Exception as exc:  # noqa: BLE001
            LOGGER.warning(
                "iFinD realtime latest query failed",
                extra={"provider": self.provider_name, "error": str(exc)},
            )

        data_date = self._today().strftime("%Y-%m-%d")
        stocks: list[dict[str, Any]] = []
        for stock_code in normalized_codes:
            name = self._clean_text(field_maps["name"].get(stock_code))
            roe = self._normalize_ratio(field_maps["roe"].get(stock_code))
            pe = self._safe_float(field_maps["pe"].get(stock_code))
            pb = self._safe_float(field_maps["pb"].get(stock_code))
            eps = self._safe_float(field_maps["eps"].get(stock_code))
            revenue = self._normalize_amount(field_maps["revenue"].get(stock_code))
            net_profit = self._normalize_amount(field_maps["netProfit"].get(stock_code))
            debt_ratio = self._normalize_ratio(field_maps["debtRatio"].get(stock_code))
            latest_price = self._safe_float(latest_price_map.get(stock_code))
            total_shares = self._safe_float(field_maps["totalShares"].get(stock_code))
            float_a_shares = self._safe_float(field_maps["floatAShares"].get(stock_code))

            if (
                not name
                and all(
                    value is None
                    for value in (
                        roe,
                        pe,
                        pb,
                        eps,
                        revenue,
                        net_profit,
                        debt_ratio,
                        latest_price,
                        total_shares,
                        float_a_shares,
                    )
                )
            ):
                continue

            stocks.append(
                {
                    "code": stock_code,
                    "name": name or stock_code,
                    "industry": "未知",
                    "sector": self._infer_sector(stock_code),
                    "roe": roe,
                    "pe": pe,
                    "pb": pb,
                    "eps": eps,
                    "revenue": revenue,
                    "netProfit": net_profit,
                    "debtRatio": debt_ratio,
                    "marketCap": self._compute_market_cap(latest_price, total_shares),
                    "floatMarketCap": self._compute_market_cap(latest_price, float_a_shares),
                    "dataDate": data_date,
                }
            )

        return stocks

    def get_indicator_history(
        self,
        stock_code: str,
        indicator: str,
        years: int,
    ) -> list[dict[str, Any]]:
        normalized_code = self._normalize_stock_code(stock_code)
        field_spec = _HISTORY_FIELD_SPECS.get(indicator)
        if not normalized_code:
            raise ValueError(f"无效股票代码: {stock_code}")
        if field_spec is None:
            raise ValueError(f"iFinD 暂不支持指标历史数据: {indicator}")

        self._ensure_login()
        field_name, field_param = field_spec
        today = self._today()
        start_date = date(today.year - years - 1, 1, 1).strftime("%Y-%m-%d")
        end_date = today.strftime("%Y-%m-%d")

        result = THS_DS(
            self._to_ifind_code(normalized_code),
            field_name,
            field_param,
            "Interval:Y,Fill:Blank,Days:Alldays",
            start_date,
            end_date,
        )
        frame = self._extract_frame(self._ensure_success(result, "THS_DS"))

        if frame.empty:
            raise RuntimeError(f"iFinD 未返回 {normalized_code} 的 {indicator} 历史数据")

        date_column = self._find_first_matching_column(frame, _TIME_COLUMN_ALIASES)
        value_column = self._select_value_column(frame, [field_name])
        if date_column is None or value_column is None:
            raise RuntimeError(f"iFinD 历史数据结构无法解析: {indicator}")

        history_points: list[dict[str, Any]] = []
        for _, row in frame.iterrows():
            parsed_date = self._parse_date(row.get(date_column))
            if parsed_date is None:
                continue

            raw_value = row.get(value_column)
            if indicator == "ROE":
                value = self._normalize_ratio(raw_value)
            elif indicator in {"REVENUE", "NET_PROFIT"}:
                value = self._normalize_amount(raw_value)
            else:
                value = self._safe_float(raw_value)

            history_points.append(
                {
                    "date": parsed_date.strftime("%Y-%m-%d"),
                    "value": value,
                    "isEstimated": False,
                }
            )

        history_points.sort(key=lambda item: item["date"])
        if len(history_points) > years:
            history_points = history_points[-years:]

        return history_points

    def get_available_industries(self) -> list[str]:
        industries: set[str] = set()
        stock_codes = self.get_all_stock_codes()
        for chunk in _chunked(stock_codes, 120):
            for item in self.get_stock_batch(chunk):
                industry = str(item.get("industry") or "").strip()
                if industry and industry != "未知":
                    industries.add(industry)
        return sorted(industries)

    def _ensure_login(self) -> None:
        if self._is_logged_in:
            return

        if not IFIND_AVAILABLE or THS_iFinDLogin is None:
            raise RuntimeError("iFinDPy 未安装，无法启用 iFinD 数据源")

        username = self._username or os.getenv("IFIND_USERNAME")
        password = self._password or os.getenv("IFIND_PASSWORD")
        if not username or not password:
            raise RuntimeError("缺少 IFIND_USERNAME 或 IFIND_PASSWORD")

        result = THS_iFinDLogin(username, password)
        error_code = result if isinstance(result, int) else getattr(result, "errorcode", None)
        if error_code not in {0, -201}:
            raise RuntimeError(f"iFinD 登录失败: {getattr(result, 'errmsg', error_code)}")

        self._is_logged_in = True

    def _query_batch_basic_data(
        self,
        stock_codes: list[str],
        indicator: str,
        params: str,
    ) -> dict[str, Any]:
        codes = ",".join(self._to_ifind_code(code) for code in stock_codes)
        result = THS_BD(codes, indicator, params)
        return self._extract_code_value_map(
            self._ensure_success(result, "THS_BD"),
            stock_codes,
            preferred_value_columns=[indicator],
        )

    def _query_batch_realtime_data(
        self,
        stock_codes: list[str],
        indicator: str,
    ) -> dict[str, Any]:
        codes = ",".join(self._to_ifind_code(code) for code in stock_codes)
        try:
            result = THS_RQ(codes, indicator)
        except TypeError:
            result = THS_RQ(codes, indicator, "")
        return self._extract_code_value_map(
            self._ensure_success(result, "THS_RQ"),
            stock_codes,
            preferred_value_columns=[indicator],
        )

    def _extract_code_value_map(
        self,
        raw: Any,
        stock_codes: list[str],
        *,
        preferred_value_columns: list[str],
    ) -> dict[str, Any]:
        payload = getattr(raw, "data", raw)
        if isinstance(payload, dict):
            mapping = self._extract_code_value_map_from_dict(
                payload,
                stock_codes,
                preferred_value_columns,
            )
            if mapping:
                return mapping

        frame = self._extract_frame(raw)
        if frame.empty:
            return {}

        frame.columns = [str(column) for column in frame.columns]
        code_column = self._find_first_matching_column(frame, _CODE_COLUMN_ALIASES)
        value_column = self._select_value_column(frame, preferred_value_columns)

        if code_column is not None:
            if value_column is None:
                remaining_columns = [
                    column for column in frame.columns if column != code_column
                ]
                value_column = remaining_columns[0] if remaining_columns else None
            if value_column is None:
                return {}

            values: dict[str, Any] = {}
            for _, row in frame.iterrows():
                normalized_code = self._normalize_stock_code(row.get(code_column))
                if normalized_code:
                    values[normalized_code] = row.get(value_column)
            return values

        indexed_values: dict[str, Any] = {}
        if value_column is not None:
            for index_value, row in frame.iterrows():
                normalized_code = self._normalize_stock_code(index_value)
                if normalized_code:
                    indexed_values[normalized_code] = row.get(value_column)
        if indexed_values:
            return indexed_values

        if len(frame) == 1:
            row = frame.iloc[0]
            values = {}
            for column in frame.columns:
                normalized_code = self._normalize_stock_code(column)
                if normalized_code:
                    values[normalized_code] = row.get(column)
            if values:
                return values

        if frame.shape[0] == len(stock_codes):
            value_column = value_column or (frame.columns[0] if len(frame.columns) == 1 else None)
            if value_column is None:
                return {}
            return {
                code: frame.iloc[index][value_column]
                for index, code in enumerate(stock_codes)
            }

        return {}

    def _extract_code_value_map_from_dict(
        self,
        payload: dict[str, Any],
        stock_codes: list[str],
        preferred_value_columns: list[str],
    ) -> dict[str, Any]:
        normalized_codes = [self._normalize_stock_code(code) for code in stock_codes]
        normalized_code_set = {code for code in normalized_codes if code}

        direct_values: dict[str, Any] = {}
        for key, value in payload.items():
            normalized_key = self._normalize_stock_code(key)
            if normalized_key and normalized_key in normalized_code_set:
                direct_values[normalized_key] = value
        if direct_values:
            return direct_values

        code_values = payload.get("thscode") or payload.get("THSCODE")
        if isinstance(code_values, list):
            value_series = None
            for candidate in preferred_value_columns:
                if candidate in payload:
                    value_series = payload[candidate]
                    break
            if value_series is None:
                remaining_keys = [key for key in payload if key not in {"thscode", "THSCODE"}]
                if len(remaining_keys) == 1:
                    value_series = payload[remaining_keys[0]]
            if isinstance(value_series, list):
                return {
                    self._normalize_stock_code(code): value
                    for code, value in zip(code_values, value_series, strict=False)
                    if self._normalize_stock_code(code)
                }

        return {}

    def _ensure_success(self, result: Any, source: str) -> Any:
        error_code = getattr(result, "errorcode", 0)
        if error_code not in {0, -201}:
            error_message = getattr(result, "errmsg", "unknown error")
            raise RuntimeError(f"{source} 调用失败: {error_code} {error_message}")
        return result

    def _extract_frame(self, raw: Any) -> pd.DataFrame:
        if isinstance(raw, pd.DataFrame):
            return raw.copy()

        payload = getattr(raw, "data", raw)
        if isinstance(payload, pd.DataFrame):
            return payload.copy()
        if isinstance(payload, dict):
            try:
                return pd.DataFrame(payload)
            except ValueError:
                return pd.DataFrame()
        if isinstance(payload, list):
            return pd.DataFrame(payload)

        try:
            return pd.DataFrame(payload)
        except (TypeError, ValueError):
            return pd.DataFrame()

    def _find_first_matching_column(
        self,
        frame: pd.DataFrame,
        aliases: set[str],
    ) -> str | None:
        for column in frame.columns:
            if self._normalize_column_name(column) in aliases:
                return column
        return None

    def _select_value_column(
        self,
        frame: pd.DataFrame,
        preferred_value_columns: list[str],
    ) -> str | None:
        normalized_preferred = {
            self._normalize_column_name(column) for column in preferred_value_columns
        }
        for column in frame.columns:
            if self._normalize_column_name(column) in normalized_preferred:
                return column

        remaining_columns = [
            column
            for column in frame.columns
            if self._normalize_column_name(column) not in _CODE_COLUMN_ALIASES
            and self._normalize_column_name(column) not in _TIME_COLUMN_ALIASES
        ]
        if len(remaining_columns) == 1:
            return remaining_columns[0]
        return None

    def _normalize_requested_codes(self, stock_codes: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for stock_code in stock_codes:
            code = self._normalize_stock_code(stock_code)
            if code and code not in seen:
                seen.add(code)
                normalized.append(code)
        return normalized

    def _normalize_stock_code(self, raw_code: Any) -> str:
        text = str(raw_code or "").strip().upper()
        if not text:
            return ""

        match = re.search(r"(\d{6})", text)
        if not match:
            return ""

        return match.group(1)

    def _to_ifind_code(self, stock_code: str) -> str:
        normalized = str(stock_code).strip().upper()
        if "." in normalized:
            return normalized

        if normalized.startswith(("0", "3")):
            exchange = "SZ"
        elif normalized.startswith(("4", "8")):
            exchange = "BJ"
        else:
            exchange = "SH"
        return f"{normalized}.{exchange}"

    def _normalize_column_name(self, raw_name: Any) -> str:
        return re.sub(r"[^0-9a-z]", "", str(raw_name or "").strip().lower())

    def _safe_float(self, value: Any) -> float | None:
        if value is None:
            return None
        if isinstance(value, float) and math.isnan(value):
            return None

        text = str(value).strip()
        if not text or text.lower() in {"nan", "none", "null", "--"}:
            return None

        text = text.replace(",", "").replace("%", "")
        try:
            return float(text)
        except ValueError:
            return None

    def _normalize_ratio(self, value: Any) -> float | None:
        numeric_value = self._safe_float(value)
        if numeric_value is None:
            return None
        if abs(numeric_value) > 1:
            return numeric_value / 100
        return numeric_value

    def _normalize_amount(self, value: Any) -> float | None:
        numeric_value = self._safe_float(value)
        if numeric_value is None:
            return None
        if abs(numeric_value) >= 1_000_000:
            return numeric_value / 100_000_000
        return numeric_value

    def _compute_market_cap(
        self,
        latest_price: float | None,
        shares: float | None,
    ) -> float | None:
        if latest_price is None or shares is None:
            return None
        market_cap = latest_price * shares / 100_000_000
        return round(market_cap, 4)

    def _clean_text(self, value: Any) -> str:
        text = str(value or "").strip()
        if not text or text.lower() in {"nan", "none", "null", "--"}:
            return ""
        return text

    def _parse_date(self, value: Any) -> date | None:
        if value is None:
            return None
        try:
            parsed = pd.to_datetime(value)
        except (TypeError, ValueError):
            return None
        if pd.isna(parsed):
            return None
        return parsed.date()

    def _infer_sector(self, stock_code: str) -> str:
        if stock_code.startswith(("688", "689")):
            return "科创板"
        if stock_code.startswith(("300", "301", "302")):
            return "创业板"
        if stock_code.startswith(("4", "8")):
            return "北交所"
        return "主板"

    def _read_universe_cache(self) -> list[str] | None:
        if self._universe_cache is None:
            return None
        cached_at, cached_codes = self._universe_cache
        if _now_timestamp() - cached_at > _UNIVERSE_CACHE_TTL_SECONDS:
            return None
        return cached_codes

    def _today(self) -> date:
        return date.today()


def _chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def _now_timestamp() -> float:
    return pd.Timestamp.utcnow().timestamp()

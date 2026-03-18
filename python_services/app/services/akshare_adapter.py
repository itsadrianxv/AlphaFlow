"""Shared AkShare loaders used by screening, market, timing, and intelligence."""

from __future__ import annotations

from collections.abc import Callable
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass
from datetime import date, datetime
from http.client import RemoteDisconnected
from io import StringIO
import logging
import re
import threading
import time
from typing import Any, TypeVar

import akshare as ak
import pandas as pd
import requests
from requests import exceptions as requests_exceptions

from app.policies.retry_policy import RetryPolicy, retry_sync
from app.services.ths_concept_catalog import (
    clear_ths_concept_catalog_cache,
    load_ths_concept_catalog_frame,
)

_T = TypeVar("_T")

_SPOT_CACHE_TTL_SECONDS = 30
_SPOT_STALE_TTL_SECONDS = 120
_SINA_SPOT_CACHE_TTL_SECONDS = 15 * 60
_SINA_SPOT_STALE_TTL_SECONDS = 2 * 60 * 60
_ETF_SPOT_CACHE_TTL_SECONDS = 30
_STOCK_CODE_CACHE_TTL_SECONDS = 24 * 60 * 60
_FINANCIAL_SNAPSHOT_CACHE_TTL_SECONDS = 24 * 60 * 60
_HISTORY_FRAME_CACHE_TTL_SECONDS = 6 * 60 * 60
_INDIVIDUAL_INFO_CACHE_TTL_SECONDS = 24 * 60 * 60
_CONCEPT_CACHE_TTL_SECONDS = 24 * 60 * 60
_THS_REQUEST_TIMEOUT_SECONDS = 15
_THS_CONCEPT_RETRY_POLICY = RetryPolicy(
    max_attempts=2,
    base_delay_ms=250,
    multiplier=2.0,
    max_delay_ms=1200,
    jitter_ratio=0.1,
)
_THS_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)
_THS_PAGE_INFO_PATTERN = re.compile(r'<span class="page_info">\s*(\d+)\s*/\s*(\d+)\s*</span>')
_THS_CONCEPT_COLUMN_RENAMES = {
    "name": "name",
    "code": "code",
}
_THS_CONSTITUENT_COLUMN_RENAMES = {
    "现价": "最新价",
    "涨跌幅(%)": "涨跌幅",
    "换手(%)": "换手率",
}
_TRANSIENT_THS_ERROR_MARKERS = (
    "connection aborted",
    "remote end closed connection without response",
    "connection reset by peer",
    "read timed out",
    "connect timeout",
    "temporarily unavailable",
    "temporary failure",
    "chunkedencodingerror",
    "protocolerror",
)
_PARTIAL_THS_PAGE_ERROR_MARKERS = (
    "no tables found",
    "ssl",
    "eof occurred in violation of protocol",
    "unexpected eof",
)


@dataclass
class _CacheEntry:
    value: Any
    expires_at: float
    stale_until: float | None = None


@dataclass
class _CachedFetchResult:
    value: Any
    is_stale: bool


@dataclass
class _SpotFrameResult:
    frame: pd.DataFrame
    data_quality: str
    warnings: list[str]


_CACHE_LOCK = threading.Lock()
_CACHE: dict[str, _CacheEntry] = {}
LOGGER = logging.getLogger(__name__)


class AkShareAdapter:
    """Thin wrapper around AkShare with shared TTL caches and normalized payloads."""

    @staticmethod
    def clear_caches() -> None:
        with _CACHE_LOCK:
            _CACHE.clear()
        clear_ths_concept_catalog_cache()

    @staticmethod
    def get_a_share_spot_frame(stock_codes: list[str] | None = None) -> pd.DataFrame:
        result = _load_a_share_spot_result(stock_codes=stock_codes)
        return _apply_frame_metadata(
            result.frame,
            data_quality=result.data_quality,
            warnings=result.warnings,
        )

    @staticmethod
    def get_etf_spot_frame() -> pd.DataFrame:
        return _get_cached_dataframe(
            cache_key="etf-spot",
            ttl_seconds=_ETF_SPOT_CACHE_TTL_SECONDS,
            fetch_fn=ak.fund_etf_spot_em,
            error_prefix="获取 ETF 快照失败",
        )

    @staticmethod
    def get_stock_code_name_frame() -> pd.DataFrame:
        return _get_cached_dataframe(
            cache_key="stock-code-name",
            ttl_seconds=_STOCK_CODE_CACHE_TTL_SECONDS,
            fetch_fn=_load_stock_code_name_frame,
            error_prefix="failed to load stock code table",
        )

    @staticmethod
    def get_latest_financial_snapshot_frame() -> pd.DataFrame:
        return _get_cached_dataframe(
            cache_key="latest-financial-snapshot",
            ttl_seconds=_FINANCIAL_SNAPSHOT_CACHE_TTL_SECONDS,
            fetch_fn=_load_latest_financial_snapshot_frame,
            error_prefix="获取最新财务快照失败",
        )

    @staticmethod
    def get_concept_catalog_frame() -> pd.DataFrame:
        return load_ths_concept_catalog_frame()

    @staticmethod
    def get_live_concept_catalog_frame() -> pd.DataFrame:
        return _fetch_live_concept_catalog_frame_ths()

    @staticmethod
    def get_concept_constituents_frame(
        concept_name: str,
        concept_code: str | None = None,
    ) -> pd.DataFrame:
        concept_symbol = (concept_code or concept_name).strip()
        return _get_cached_dataframe(
            cache_key=f"concept-constituents:{concept_symbol}",
            ttl_seconds=_CONCEPT_CACHE_TTL_SECONDS,
            fetch_fn=lambda: _load_concept_constituents_frame_ths(
                concept_name,
                concept_code=concept_code,
            ),
            error_prefix=f"获取概念成分股失败: {concept_name}",
        )

    @staticmethod
    def get_stock_universe() -> list[dict[str, Any]]:
        spot_df = AkShareAdapter.get_a_share_spot_frame()
        if spot_df.empty:
            return []

        financial_warnings: list[str] = []
        try:
            financial_by_code = _build_financial_index(
                AkShareAdapter.get_latest_financial_snapshot_frame()
            )
        except Exception:
            financial_by_code = {}
            financial_warnings = ["financial_snapshot_unavailable"]
        data_quality = _get_frame_data_quality(spot_df)
        warnings = _get_frame_warnings(spot_df)
        if financial_warnings:
            data_quality = "partial"
            warnings = list(dict.fromkeys([*warnings, *financial_warnings]))

        results: list[dict[str, Any]] = []
        for _, row in spot_df.iterrows():
            code = _normalize_stock_code(row.get("代码"))
            if not code:
                continue
            mapped = _map_a_share_row(
                spot_row=row,
                financial_row=financial_by_code.get(code),
                industry_override=None,
            )
            mapped["dataQuality"] = data_quality
            mapped["warnings"] = list(warnings)
            results.append(mapped)

        return results

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
        normalized_codes = _normalize_requested_codes(codes)
        if not normalized_codes:
            return []

        try:
            spot_df = AkShareAdapter.get_a_share_spot_frame(stock_codes=normalized_codes)
        except Exception as exc:  # noqa: BLE001
            raise Exception(f"批量查询股票数据失败: {exc}") from exc

        if spot_df.empty or "代码" not in spot_df.columns:
            return []

        financial_warnings: list[str] = []
        try:
            financial_by_code = _build_financial_index(
                AkShareAdapter.get_latest_financial_snapshot_frame()
            )
        except Exception:
            financial_by_code = {}
            financial_warnings = ["financial_snapshot_unavailable"]
        data_quality = _get_frame_data_quality(spot_df)
        warnings = _get_frame_warnings(spot_df)
        if financial_warnings:
            data_quality = "partial"
            warnings = list(dict.fromkeys([*warnings, *financial_warnings]))
        working_df = spot_df.copy()
        working_df["__normalized_code__"] = working_df["代码"].map(_normalize_stock_code)

        results_by_code: dict[str, dict[str, Any]] = {}
        for _, row in working_df.iterrows():
            code = _normalize_stock_code(row.get("__normalized_code__"))
            if code not in normalized_codes:
                continue

            financial_row = financial_by_code.get(code)
            industry_override = None
            if not _pick_financial_text(financial_row, ("所处行业", "行业")):
                industry_override = _get_individual_industry(code)

            mapped = _map_a_share_row(
                spot_row=row,
                financial_row=financial_row,
                industry_override=industry_override,
            )
            mapped["dataQuality"] = data_quality
            mapped["warnings"] = list(warnings)
            results_by_code[code] = mapped

        return [results_by_code[code] for code in normalized_codes if code in results_by_code]

    @staticmethod
    def get_etf_by_code(code: str) -> dict[str, Any] | None:
        normalized_code = _normalize_stock_code(code)
        if not normalized_code:
            return None

        spot_df = AkShareAdapter.get_etf_spot_frame()
        if spot_df.empty:
            return None

        code_column = _find_column(spot_df, ("代码", "code"))
        if not code_column:
            return None

        matched = spot_df[spot_df[code_column].astype(str).map(_normalize_stock_code) == normalized_code]
        if matched.empty:
            return None

        return _map_etf_row(matched.iloc[0])

    @staticmethod
    def get_etf_batch(codes: list[str]) -> list[dict[str, Any]]:
        normalized_codes = _normalize_requested_codes(codes)
        if not normalized_codes:
            return []

        spot_df = AkShareAdapter.get_etf_spot_frame()
        if spot_df.empty:
            return []

        code_column = _find_column(spot_df, ("代码", "code"))
        if not code_column:
            return []

        working_df = spot_df.copy()
        working_df["__normalized_code__"] = working_df[code_column].astype(str).map(
            _normalize_stock_code
        )

        results_by_code: dict[str, dict[str, Any]] = {}
        for _, row in working_df.iterrows():
            code = _normalize_stock_code(row.get("__normalized_code__"))
            if code not in normalized_codes:
                continue
            results_by_code[code] = _map_etf_row(row)

        return [results_by_code[code] for code in normalized_codes if code in results_by_code]

    @staticmethod
    def get_indicator_history(
        code: str,
        indicator: str,
        years: int,
    ) -> list[dict[str, Any]]:
        normalized_code = _normalize_stock_code(code)
        if not normalized_code:
            return []

        normalized_years = max(years, 1)
        try:
            if indicator == "ROE":
                history = _load_em_indicator_history(
                    normalized_code,
                    indicator_names=("净资产收益率", "ROE"),
                    years=normalized_years,
                )
                return history or _load_sina_indicator_history(
                    normalized_code,
                    indicator_names=("净资产收益率", "ROE"),
                    years=normalized_years,
                )

            if indicator == "EPS":
                history = _load_em_indicator_history(
                    normalized_code,
                    indicator_names=("每股收益", "EPS"),
                    years=normalized_years,
                )
                return history or _load_sina_indicator_history(
                    normalized_code,
                    indicator_names=("每股收益", "EPS"),
                    years=normalized_years,
                )

            if indicator == "REVENUE":
                history = _load_ths_metric_history(
                    normalized_code,
                    dataset="benefit",
                    metric_names=("营业总收入", "营业收入", "总营收"),
                    years=normalized_years,
                )
                return history or _load_sina_indicator_history(
                    normalized_code,
                    indicator_names=("营业收入", "营业总收入"),
                    years=normalized_years,
                )

            if indicator == "NET_PROFIT":
                history = _load_ths_metric_history(
                    normalized_code,
                    dataset="benefit",
                    metric_names=("净利润", "归母净利润"),
                    years=normalized_years,
                )
                return history or _load_sina_indicator_history(
                    normalized_code,
                    indicator_names=("净利润",),
                    years=normalized_years,
                )

            if indicator == "DEBT_RATIO":
                history = _load_debt_ratio_history(
                    normalized_code,
                    years=normalized_years,
                )
                return history or _load_sina_indicator_history(
                    normalized_code,
                    indicator_names=("资产负债率",),
                    years=normalized_years,
                )

            if indicator == "PE":
                return _load_sina_indicator_history(
                    normalized_code,
                    indicator_names=("市盈率",),
                    years=normalized_years,
                )

            if indicator == "PB":
                return _load_sina_indicator_history(
                    normalized_code,
                    indicator_names=("市净率",),
                    years=normalized_years,
                )

            return _load_sina_indicator_history(
                normalized_code,
                indicator_names=(indicator,),
                years=normalized_years,
            )
        except Exception as exc:  # noqa: BLE001
            raise Exception(
                f"查询股票 {normalized_code} 的 {indicator} 历史数据失败: {exc}"
            ) from exc

    @staticmethod
    def get_available_industries() -> list[str]:
        try:
            financial_df = AkShareAdapter.get_latest_financial_snapshot_frame()
            industry_column = _find_column(financial_df, ("所处行业", "行业"))
            if industry_column:
                industries = sorted(
                    {
                        str(item).strip()
                        for item in financial_df[industry_column].tolist()
                        if str(item).strip()
                    }
                )
                if industries:
                    return industries

            df = _get_cached_dataframe(
                cache_key="board-industries",
                ttl_seconds=_CONCEPT_CACHE_TTL_SECONDS,
                fetch_fn=ak.stock_board_industry_name_em,
                error_prefix="获取行业列表失败",
            )
        except Exception as exc:  # noqa: BLE001
            raise Exception(f"获取行业列表失败: {exc}") from exc

        if df.empty:
            return []

        name_column = _find_column(df, ("板块名称", "行业", "名称"))
        if not name_column:
            return []

        return sorted(
            {
                str(item).strip()
                for item in df[name_column].tolist()
                if str(item).strip()
            }
        )


def _clone_cached_value(value: _T) -> _T:
    if isinstance(value, pd.DataFrame):
        return value.copy(deep=True)
    if isinstance(value, dict):
        return dict(value)  # type: ignore[return-value]
    if isinstance(value, list):
        return list(value)  # type: ignore[return-value]
    return value


def _get_cached_value(
    *,
    cache_key: str,
    ttl_seconds: int,
    fetch_fn: Callable[[], _T],
) -> _T:
    fresh = _read_cached_value(cache_key=cache_key, allow_stale=False)
    if fresh is not None:
        return fresh.value

    value = fetch_fn()
    _write_cached_value(cache_key=cache_key, value=value, ttl_seconds=ttl_seconds)

    return _clone_cached_value(value)


def _get_cached_dataframe(
    *,
    cache_key: str,
    ttl_seconds: int,
    fetch_fn: Callable[[], pd.DataFrame],
    error_prefix: str,
) -> pd.DataFrame:
    try:
        return _get_cached_value(
            cache_key=cache_key,
            ttl_seconds=ttl_seconds,
            fetch_fn=fetch_fn,
        )
    except Exception as exc:  # noqa: BLE001
        raise Exception(f"{error_prefix}: {exc}") from exc


def _get_cached_dataframe_with_stale(
    *,
    cache_key: str,
    ttl_seconds: int,
    stale_ttl_seconds: int,
    fetch_fn: Callable[[], pd.DataFrame],
    error_prefix: str,
) -> _CachedFetchResult:
    try:
        return _get_cached_value_with_stale(
            cache_key=cache_key,
            ttl_seconds=ttl_seconds,
            stale_ttl_seconds=stale_ttl_seconds,
            fetch_fn=fetch_fn,
        )
    except Exception as exc:  # noqa: BLE001
        raise Exception(f"{error_prefix}: {exc}") from exc


def _get_cached_value_with_stale(
    *,
    cache_key: str,
    ttl_seconds: int,
    stale_ttl_seconds: int,
    fetch_fn: Callable[[], _T],
) -> _CachedFetchResult:
    fresh = _read_cached_value(cache_key=cache_key, allow_stale=False)
    if fresh is not None:
        return fresh

    stale = _read_cached_value(cache_key=cache_key, allow_stale=True)
    try:
        value = fetch_fn()
    except Exception:
        if stale is not None:
            return stale
        raise

    _write_cached_value(
        cache_key=cache_key,
        value=value,
        ttl_seconds=ttl_seconds,
        stale_ttl_seconds=stale_ttl_seconds,
    )
    return _CachedFetchResult(value=_clone_cached_value(value), is_stale=False)


def _read_cached_value(*, cache_key: str, allow_stale: bool) -> _CachedFetchResult | None:
    now = time.time()
    with _CACHE_LOCK:
        cached = _CACHE.get(cache_key)
        if cached is None:
            return None

        if cached.expires_at >= now:
            return _CachedFetchResult(
                value=_clone_cached_value(cached.value),
                is_stale=False,
            )

        stale_until = cached.stale_until or cached.expires_at
        if allow_stale and stale_until >= now:
            return _CachedFetchResult(
                value=_clone_cached_value(cached.value),
                is_stale=True,
            )

        if stale_until < now:
            _CACHE.pop(cache_key, None)

    return None


def _write_cached_value(
    *,
    cache_key: str,
    value: Any,
    ttl_seconds: int,
    stale_ttl_seconds: int | None = None,
) -> None:
    now = time.time()
    stale_until = now + ttl_seconds + stale_ttl_seconds if stale_ttl_seconds is not None else None
    with _CACHE_LOCK:
        _CACHE[cache_key] = _CacheEntry(
            value=_clone_cached_value(value),
            expires_at=now + ttl_seconds,
            stale_until=stale_until,
        )


def _load_latest_financial_snapshot_frame() -> pd.DataFrame:
    for report_date in _candidate_report_dates(limit=12):
        frame = _get_cached_dataframe(
            cache_key=f"financial-snapshot:{report_date}",
            ttl_seconds=_FINANCIAL_SNAPSHOT_CACHE_TTL_SECONDS,
            fetch_fn=lambda report_date=report_date: ak.stock_yjbb_em(date=report_date),
            error_prefix=f"获取财务快照失败: {report_date}",
        )
        if not frame.empty:
            return frame

    return pd.DataFrame()


def _load_stock_code_name_frame() -> pd.DataFrame:
    errors: list[str] = []

    try:
        frame = ak.stock_info_a_code_name()
        if not frame.empty:
            return frame
        errors.append("stock_info_a_code_name returned empty frame")
    except Exception as exc:  # noqa: BLE001
        errors.append(f"stock_info_a_code_name: {exc}")

    exchange_loaders: tuple[tuple[str, Callable[[], pd.DataFrame]], ...] = (
        ("stock_info_sh_name_code", ak.stock_info_sh_name_code),
        ("stock_info_sz_name_code", ak.stock_info_sz_name_code),
        ("stock_info_bj_name_code", ak.stock_info_bj_name_code),
    )
    exchange_frames: list[pd.DataFrame] = []
    for loader_name, fetch_fn in exchange_loaders:
        try:
            frame = fetch_fn()
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{loader_name}: {exc}")
            continue
        if frame.empty:
            errors.append(f"{loader_name} returned empty frame")
            continue
        exchange_frames.append(frame)

    if exchange_frames:
        return pd.concat(exchange_frames, ignore_index=True, sort=False)

    if errors:
        raise Exception("; ".join(errors))

    return pd.DataFrame()


def _fetch_live_concept_catalog_frame_ths() -> pd.DataFrame:
    frame = _retry_ths_concept_fetch(
        operation_name="stock_board_concept_name_ths",
        fetch_fn=ak.stock_board_concept_name_ths,
    )
    if frame.empty:
        return frame

    normalized = frame.rename(columns=_THS_CONCEPT_COLUMN_RENAMES).copy()
    if "name" in normalized.columns:
        normalized["name"] = normalized["name"].map(
            lambda value: str(value).strip()
        )
    if "code" in normalized.columns:
        normalized["code"] = normalized["code"].map(
            lambda value: str(value).strip()
        )

    return normalized


def _load_a_share_spot_result(stock_codes: list[str] | None = None) -> _SpotFrameResult:
    errors: list[str] = []

    try:
        em_result = _get_cached_dataframe_with_stale(
            cache_key="a-share-spot:em",
            ttl_seconds=_SPOT_CACHE_TTL_SECONDS,
            stale_ttl_seconds=_SPOT_STALE_TTL_SECONDS,
            fetch_fn=_load_em_a_share_spot_frame,
            error_prefix="获取全市场股票快照失败",
        )
        warnings = ["spot_snapshot_stale"] if em_result.is_stale else []
        return _SpotFrameResult(
            frame=em_result.value,
            data_quality="complete",
            warnings=warnings,
        )
    except Exception as exc:  # noqa: BLE001
        errors.append(str(exc))

    try:
        sina_result = _get_cached_dataframe_with_stale(
            cache_key="a-share-spot:sina",
            ttl_seconds=_SINA_SPOT_CACHE_TTL_SECONDS,
            stale_ttl_seconds=_SINA_SPOT_STALE_TTL_SECONDS,
            fetch_fn=_load_sina_a_share_spot_frame,
            error_prefix="获取新浪全市场股票快照失败",
        )
        warnings = ["spot_snapshot_sina_fallback"]
        if sina_result.is_stale:
            warnings.append("spot_snapshot_stale")
        return _SpotFrameResult(
            frame=sina_result.value,
            data_quality="partial",
            warnings=warnings,
        )
    except Exception as exc:  # noqa: BLE001
        errors.append(str(exc))

    normalized_codes = _normalize_requested_codes(stock_codes or [])
    if normalized_codes:
        partial_frame = _build_partial_a_share_spot_frame(normalized_codes)
        if not partial_frame.empty:
            return _SpotFrameResult(
                frame=partial_frame,
                data_quality="partial",
                warnings=["spot_snapshot_partial"],
            )

    detail = "; ".join(error for error in errors if error)
    raise Exception(detail or "获取全市场股票快照失败")


def _load_em_a_share_spot_frame() -> pd.DataFrame:
    frame = ak.stock_zh_a_spot_em()
    if frame.empty:
        raise ValueError("stock_zh_a_spot_em returned empty frame")
    return frame


def _load_sina_a_share_spot_frame() -> pd.DataFrame:
    with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
        frame = ak.stock_zh_a_spot()
    if frame.empty:
        raise ValueError("stock_zh_a_spot returned empty frame")
    return _normalize_sina_a_share_spot_frame(frame)


def _normalize_sina_a_share_spot_frame(frame: pd.DataFrame) -> pd.DataFrame:
    normalized = frame.copy()
    if "代码" in normalized.columns:
        normalized["代码"] = normalized["代码"].map(_normalize_stock_code)
    if "名称" in normalized.columns:
        normalized["名称"] = normalized["名称"].map(lambda value: str(value or "").strip())

    for column in ("行业", "市盈率", "市净率", "总市值", "流通市值", "换手率", "涨跌幅"):
        if column not in normalized.columns:
            normalized[column] = None

    return normalized


def _build_partial_a_share_spot_frame(stock_codes: list[str]) -> pd.DataFrame:
    code_name_map = _build_code_name_index()

    try:
        financial_by_code = _build_financial_index(
            AkShareAdapter.get_latest_financial_snapshot_frame()
        )
    except Exception:  # noqa: BLE001
        financial_by_code = {}

    rows: list[dict[str, Any]] = []
    for code in stock_codes:
        financial_row = financial_by_code.get(code)
        stock_name = (
            code_name_map.get(code)
            or _pick_financial_text(financial_row, ("股票简称", "名称", "简称"))
            or code
        )
        industry = (
            _pick_financial_text(financial_row, ("所处行业", "行业"))
            or _get_individual_industry(code)
            or "未知"
        )
        rows.append(
            {
                "代码": code,
                "名称": stock_name,
                "行业": industry,
                "市盈率": None,
                "市净率": None,
                "总市值": None,
                "流通市值": None,
                "换手率": None,
                "涨跌幅": None,
            }
        )

    return pd.DataFrame(rows)


def _build_code_name_index() -> dict[str, str]:
    try:
        frame = AkShareAdapter.get_stock_code_name_frame()
    except Exception:  # noqa: BLE001
        return {}

    if frame.empty:
        return {}

    code_column = _find_column(frame, ("代码", "证券代码", "code"))
    name_column = _find_column(frame, ("名称", "证券简称", "name", "简称"))
    if not code_column or not name_column:
        return {}

    code_name_map: dict[str, str] = {}
    for _, row in frame.iterrows():
        code = _normalize_stock_code(row.get(code_column))
        name = str(row.get(name_column) or "").strip()
        if code and name and code not in code_name_map:
            code_name_map[code] = name
    return code_name_map


def _load_concept_constituents_frame_ths(
    concept_name: str,
    concept_code: str | None = None,
) -> pd.DataFrame:
    resolved_code = _resolve_ths_concept_code(
        concept_name=concept_name,
        concept_code=concept_code,
    )
    if not resolved_code:
        raise ValueError(f"未找到概念板块代码: {concept_name}")

    operation_name = f"ths_concept_constituents:{concept_name}"
    first_page_html = _retry_ths_concept_fetch(
        operation_name=f"{operation_name}:page:1",
        fetch_fn=lambda: _fetch_ths_concept_detail_html(
            concept_code=resolved_code,
            page=1,
        ),
    )
    first_page_table = _parse_ths_concept_constituent_table(first_page_html)
    if first_page_table.empty:
        raise ValueError(
            f"No tables found for THS concept constituents page 1: {concept_name}"
        )

    page_count = _extract_ths_page_count(first_page_html)
    frames = [first_page_table]
    failed_page: int | None = None

    for page in range(2, page_count + 1):
        try:
            html = _fetch_ths_concept_detail_html(
                concept_code=resolved_code,
                page=page,
            )
            table = _parse_ths_concept_constituent_table(html)
            if table.empty:
                raise ValueError("No tables found")
        except Exception as exc:  # noqa: BLE001
            if not _is_tolerable_followup_ths_page_error(exc):
                raise
            failed_page = page
            break

        frames.append(table)

    combined = pd.concat(frames, ignore_index=True)
    if "代码" in combined.columns:
        combined = combined.drop_duplicates(subset=["代码"], keep="first")
    combined = combined.reset_index(drop=True)

    if failed_page is not None:
        LOGGER.warning(
            "THS concept constituents partial result for %s: stop at page %s, kept %s rows",
            concept_name,
            failed_page,
            len(combined),
        )

    return combined


def _resolve_ths_concept_code(
    *,
    concept_name: str,
    concept_code: str | None,
) -> str:
    normalized_code = str(concept_code or "").strip()
    if normalized_code:
        return normalized_code

    catalog = AkShareAdapter.get_concept_catalog_frame()
    if catalog.empty:
        return ""

    name_column = _find_column(catalog, ("name", "板块名称", "概念名称", "名称"))
    code_column = _find_column(catalog, ("code", "板块代码", "代码"))
    if not name_column or not code_column:
        return ""

    matched = catalog[catalog[name_column].astype(str).str.strip() == concept_name.strip()]
    if matched.empty:
        return ""

    return str(matched.iloc[0].get(code_column) or "").strip()


def _fetch_ths_concept_detail_html(*, concept_code: str, page: int) -> str:
    if page <= 1:
        url = f"https://q.10jqka.com.cn/gn/detail/code/{concept_code}/"
    else:
        url = f"https://q.10jqka.com.cn/gn/detail/code/{concept_code}/page/{page}/"

    response = requests.get(
        url,
        headers={"User-Agent": _THS_USER_AGENT},
        timeout=_THS_REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    if not response.encoding or response.encoding.lower() == "iso-8859-1":
        response.encoding = response.apparent_encoding or "gbk"
    return response.text


def _extract_ths_page_count(html: str) -> int:
    matched = _THS_PAGE_INFO_PATTERN.search(html)
    if not matched:
        return 1

    try:
        return max(1, int(matched.group(2)))
    except ValueError:
        return 1


def _parse_ths_concept_constituent_table(html: str) -> pd.DataFrame:
    frames = pd.read_html(StringIO(html))
    if not frames:
        return pd.DataFrame()

    frame = frames[0].rename(columns=_THS_CONSTITUENT_COLUMN_RENAMES).copy()
    if "代码" in frame.columns:
        frame["代码"] = frame["代码"].map(_format_ths_stock_code)
    return frame


def _retry_ths_concept_fetch(
    *,
    operation_name: str,
    fetch_fn: Callable[[], _T],
) -> _T:
    return retry_sync(
        operation=fetch_fn,
        policy=_THS_CONCEPT_RETRY_POLICY,
        should_retry=_is_transient_ths_error,
        on_retry=lambda attempt, exc, sleep_ms: LOGGER.warning(
            "Transient THS failure for %s (attempt %s/%s): %s; retrying in %.0fms",
            operation_name,
            attempt,
            _THS_CONCEPT_RETRY_POLICY.max_attempts,
            exc,
            sleep_ms,
        ),
    )


def _is_tolerable_followup_ths_page_error(exc: Exception) -> bool:
    if _is_transient_ths_error(exc):
        return True

    for current in _iter_exception_chain(exc):
        message = str(current).lower()
        if any(marker in message for marker in _PARTIAL_THS_PAGE_ERROR_MARKERS):
            return True

    return False


def _is_transient_ths_error(exc: Exception) -> bool:
    transient_types = (
        requests_exceptions.ConnectionError,
        requests_exceptions.Timeout,
        requests_exceptions.ChunkedEncodingError,
        RemoteDisconnected,
    )
    if isinstance(exc, transient_types):
        return True

    for current in _iter_exception_chain(exc):
        if isinstance(current, transient_types):
            return True

        message = str(current).lower()
        if any(marker in message for marker in _TRANSIENT_THS_ERROR_MARKERS):
            return True

    return False


def _iter_exception_chain(exc: Exception):
    current: BaseException | None = exc
    seen: set[int] = set()

    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current

        if current.__cause__ is not None:
            current = current.__cause__
        elif current.__context__ is not None:
            current = current.__context__
        elif len(getattr(current, "args", ())) > 1 and isinstance(
            current.args[1],
            BaseException,
        ):
            current = current.args[1]
        else:
            current = None


def _candidate_report_dates(limit: int) -> list[str]:
    quarter_end_map = {1: "0331", 2: "0630", 3: "0930", 4: "1231"}
    today = datetime.now().date()
    current_quarter = ((today.month - 1) // 3) + 1
    current_quarter_index = today.year * 4 + current_quarter - 1

    dates: list[str] = []
    for offset in range(limit):
        quarter_index = current_quarter_index - offset
        year = quarter_index // 4
        quarter = (quarter_index % 4) + 1
        dates.append(f"{year}{quarter_end_map[quarter]}")
    return dates


def _format_ths_stock_code(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""

    digits = re.sub(r"\D", "", text)
    if not digits:
        return ""

    if len(digits) <= 6:
        return digits.zfill(6)

    return digits[-6:]


def _normalize_requested_codes(codes: list[str]) -> list[str]:
    seen: set[str] = set()
    normalized_codes: list[str] = []
    for code in codes:
        normalized = _normalize_stock_code(code)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        normalized_codes.append(normalized)
    return normalized_codes


def _build_financial_index(frame: pd.DataFrame) -> dict[str, pd.Series]:
    code_column = _find_column(frame, ("股票代码", "代码"))
    if frame.empty or not code_column:
        return {}

    indexed: dict[str, pd.Series] = {}
    for _, row in frame.iterrows():
        code = _normalize_stock_code(row.get(code_column))
        if not code:
            continue
        indexed[code] = row
    return indexed


def _pick_financial_text(row: pd.Series | None, keywords: tuple[str, ...]) -> str:
    if row is None:
        return ""

    for keyword in keywords:
        for column in row.index:
            column_name = str(column)
            if keyword in column_name:
                value = str(row.get(column) or "").strip()
                if value:
                    return value
    return ""


def _pick_financial_value(row: pd.Series | None, keywords: tuple[str, ...]) -> float | None:
    if row is None:
        return None

    for column in row.index:
        column_name = str(column)
        if any(keyword in column_name for keyword in keywords):
            numeric = _safe_float(row.get(column))
            if numeric is not None:
                return numeric
    return None


def _apply_frame_metadata(
    frame: pd.DataFrame,
    *,
    data_quality: str,
    warnings: list[str],
) -> pd.DataFrame:
    annotated = frame.copy(deep=True)
    annotated.attrs["data_quality"] = "partial" if data_quality == "partial" else "complete"
    annotated.attrs["warnings"] = list(dict.fromkeys(warnings))
    return annotated


def _get_frame_data_quality(frame: pd.DataFrame) -> str:
    value = str(frame.attrs.get("data_quality") or "").strip().lower()
    return "partial" if value == "partial" else "complete"


def _get_frame_warnings(frame: pd.DataFrame) -> list[str]:
    raw_warnings = frame.attrs.get("warnings")
    if not isinstance(raw_warnings, list):
        return []
    normalized = [str(item).strip() for item in raw_warnings if str(item).strip()]
    return list(dict.fromkeys(normalized))


def _map_a_share_row(
    *,
    spot_row: pd.Series,
    financial_row: pd.Series | None,
    industry_override: str | None,
) -> dict[str, Any]:
    code = _normalize_stock_code(spot_row.get("代码"))
    name = str(spot_row.get("名称") or "").strip()
    industry = (
        industry_override
        or _pick_financial_text(financial_row, ("所处行业", "行业"))
        or "未知"
    )

    return {
        "code": code,
        "name": name,
        "industry": industry,
        "sector": _infer_sector(code),
        "roe": _pick_financial_value(financial_row, ("净资产收益率", "ROE")),
        "pe": _safe_float(spot_row.get("市盈率-动态") or spot_row.get("市盈率")),
        "pb": _safe_float(spot_row.get("市净率")),
        "eps": _pick_financial_value(financial_row, ("每股收益", "EPS")),
        "revenue": _pick_financial_value(
            financial_row,
            ("营业总收入-营业总收入", "营业总收入", "营业收入"),
        ),
        "netProfit": _pick_financial_value(
            financial_row,
            ("净利润-净利润", "净利润", "归母净利润"),
        ),
        "debtRatio": _pick_financial_value(financial_row, ("资产负债率",)),
        "marketCap": _safe_float(spot_row.get("总市值")),
        "floatMarketCap": _safe_float(spot_row.get("流通市值")),
        "turnoverRate": _safe_float(spot_row.get("换手率")),
        "changePercent": _safe_float(spot_row.get("涨跌幅")),
        "dataDate": datetime.now().strftime("%Y-%m-%d"),
        "securityType": "equity",
        "market": "CN-A",
    }


def _map_etf_row(row: pd.Series) -> dict[str, Any]:
    code = _normalize_stock_code(row.get("代码"))
    return {
        "code": code,
        "name": str(row.get("名称") or "").strip(),
        "industry": "ETF",
        "sector": "ETF",
        "roe": None,
        "pe": None,
        "pb": None,
        "eps": None,
        "revenue": None,
        "netProfit": None,
        "debtRatio": None,
        "marketCap": _safe_float(row.get("总市值")),
        "floatMarketCap": _safe_float(row.get("流通市值")),
        "turnoverRate": _safe_float(row.get("换手率")),
        "changePercent": _safe_float(row.get("涨跌幅")),
        "dataDate": datetime.now().strftime("%Y-%m-%d"),
        "securityType": "etf",
        "market": "CN-ETF",
    }


def _infer_sector(code: str) -> str:
    if code.startswith("68"):
        return "科创板"
    if code.startswith("30"):
        return "创业板"
    if code.startswith(("4", "8")):
        return "北交所"
    return "主板"


def _get_individual_industry(code: str) -> str:
    info = _get_cached_value(
        cache_key=f"individual-info:{code}",
        ttl_seconds=_INDIVIDUAL_INFO_CACHE_TTL_SECONDS,
        fetch_fn=lambda: _load_individual_info(code),
    )
    return str(info.get("industry") or "").strip()


def _load_individual_info(code: str) -> dict[str, Any]:
    try:
        frame = ak.stock_individual_info_em(symbol=code)
    except Exception:
        return {}

    if frame.empty or not {"item", "value"}.issubset(frame.columns):
        return {}

    info: dict[str, Any] = {}
    for _, row in frame.iterrows():
        key = str(row.get("item") or "").strip()
        value = row.get("value")
        if not key:
            continue
        if "行业" in key:
            info["industry"] = str(value).strip()
    return info


def _load_em_indicator_history(
    code: str,
    *,
    indicator_names: tuple[str, ...],
    years: int,
) -> list[dict[str, Any]]:
    frame = _get_cached_dataframe(
        cache_key=f"history:em:{code}",
        ttl_seconds=_HISTORY_FRAME_CACHE_TTL_SECONDS,
        fetch_fn=lambda: ak.stock_financial_analysis_indicator_em(symbol=_to_secucode(code)),
        error_prefix=f"获取东方财富财务分析指标失败: {code}",
    )
    if frame.empty:
        return []

    date_column = _find_column(frame, ("REPORT_DATE", "报告期", "日期"))
    value_column = _find_column(frame, indicator_names)
    return _build_history_from_frame(
        frame=frame,
        date_column=date_column,
        value_column=value_column,
        years=years,
    )


def _load_sina_indicator_history(
    code: str,
    *,
    indicator_names: tuple[str, ...],
    years: int,
) -> list[dict[str, Any]]:
    frame = _get_cached_dataframe(
        cache_key=f"history:sina:{code}",
        ttl_seconds=_HISTORY_FRAME_CACHE_TTL_SECONDS,
        fetch_fn=lambda: ak.stock_financial_analysis_indicator(symbol=code),
        error_prefix=f"获取新浪财务分析指标失败: {code}",
    )
    if frame.empty:
        return []

    date_column = _find_column(frame, ("日期", "REPORT_DATE", "报告期"))
    value_column = _find_column(frame, indicator_names)
    return _build_history_from_frame(
        frame=frame,
        date_column=date_column,
        value_column=value_column,
        years=years,
    )


def _load_ths_metric_history(
    code: str,
    *,
    dataset: str,
    metric_names: tuple[str, ...],
    years: int,
) -> list[dict[str, Any]]:
    frame = _load_ths_frame(code=code, dataset=dataset)
    return _build_metric_history_from_ths_frame(
        frame=frame,
        metric_names=metric_names,
        years=years,
    )


def _load_debt_ratio_history(code: str, *, years: int) -> list[dict[str, Any]]:
    frame = _load_ths_frame(code=code, dataset="debt")
    if frame.empty:
        return []

    assets = _build_metric_points_from_ths_frame(
        frame=frame,
        metric_names=("总资产", "资产总计", "资产合计"),
    )
    liabilities = _build_metric_points_from_ths_frame(
        frame=frame,
        metric_names=("总负债", "负债合计", "负债总计"),
    )
    if not assets or not liabilities:
        return []

    results: list[dict[str, Any]] = []
    common_dates = sorted(set(assets).intersection(liabilities))
    for raw_date in common_dates:
        total_assets = assets.get(raw_date)
        total_liabilities = liabilities.get(raw_date)
        if total_assets is None or total_liabilities is None or total_assets <= 0:
            continue
        ratio = round((total_liabilities / total_assets) * 100, 4)
        results.append(
            {
                "date": raw_date.isoformat(),
                "value": ratio,
                "isEstimated": False,
            }
        )

    return _select_recent_points(results, years)


def _load_ths_frame(code: str, *, dataset: str) -> pd.DataFrame:
    dataset_key = dataset.strip().lower()
    if dataset_key == "benefit":
        return _get_cached_dataframe(
            cache_key=f"history:ths-benefit:{code}",
            ttl_seconds=_HISTORY_FRAME_CACHE_TTL_SECONDS,
            fetch_fn=lambda: ak.stock_financial_benefit_new_ths(symbol=code, indicator="按报告期"),
            error_prefix=f"获取同花顺利润表失败: {code}",
        )
    if dataset_key == "debt":
        return _get_cached_dataframe(
            cache_key=f"history:ths-debt:{code}",
            ttl_seconds=_HISTORY_FRAME_CACHE_TTL_SECONDS,
            fetch_fn=lambda: ak.stock_financial_debt_new_ths(symbol=code, indicator="按报告期"),
            error_prefix=f"获取同花顺资产负债表失败: {code}",
        )
    return pd.DataFrame()


def _build_history_from_frame(
    *,
    frame: pd.DataFrame,
    date_column: str | None,
    value_column: str | None,
    years: int,
) -> list[dict[str, Any]]:
    if frame.empty or not date_column or not value_column:
        return []

    results: list[dict[str, Any]] = []
    working = frame[[date_column, value_column]].copy()
    working["__date__"] = pd.to_datetime(working[date_column], errors="coerce").dt.date
    working["__value__"] = working[value_column].map(_safe_float)
    working = working.dropna(subset=["__date__"])
    working = working.drop_duplicates(subset=["__date__"], keep="last")
    working = working.sort_values("__date__")

    for _, row in working.iterrows():
        raw_date = row.get("__date__")
        if not isinstance(raw_date, date):
            continue
        results.append(
            {
                "date": raw_date.isoformat(),
                "value": row.get("__value__"),
                "isEstimated": False,
            }
        )

    return _select_recent_points(results, years)


def _build_metric_history_from_ths_frame(
    *,
    frame: pd.DataFrame,
    metric_names: tuple[str, ...],
    years: int,
) -> list[dict[str, Any]]:
    points = _build_metric_points_from_ths_frame(frame=frame, metric_names=metric_names)
    if not points:
        return []

    results = [
        {
            "date": point_date.isoformat(),
            "value": value,
            "isEstimated": False,
        }
        for point_date, value in sorted(points.items())
    ]
    return _select_recent_points(results, years)


def _build_metric_points_from_ths_frame(
    *,
    frame: pd.DataFrame,
    metric_names: tuple[str, ...],
) -> dict[date, float | None]:
    if frame.empty:
        return {}

    date_column = _find_column(frame, ("report_date", "报告期", "日期"))
    metric_column = _find_column(frame, ("metric_name", "指标名称", "项目"))
    if not date_column or not metric_column:
        return {}

    value_columns = [
        column
        for column in frame.columns
        if str(column)
        not in {
            date_column,
            metric_column,
            "report_name",
            "report_period",
            "quarter_name",
        }
    ]

    ranked_rows: dict[date, tuple[int, float | None]] = {}
    for _, row in frame.iterrows():
        metric_name = str(row.get(metric_column) or "").strip()
        score = _match_metric_name(metric_name, metric_names)
        if score < 0:
            continue

        raw_date = pd.to_datetime(row.get(date_column), errors="coerce")
        if pd.isna(raw_date):
            continue

        numeric_value = _extract_first_numeric_value(row, value_columns)
        point_date = raw_date.date()
        existing = ranked_rows.get(point_date)
        if existing is None or score > existing[0]:
            ranked_rows[point_date] = (score, numeric_value)

    return {
        point_date: value
        for point_date, (_score, value) in ranked_rows.items()
    }


def _match_metric_name(metric_name: str, metric_names: tuple[str, ...]) -> int:
    normalized_metric = _normalize_text(metric_name)
    if not normalized_metric:
        return -1

    best_score = -1
    for metric_name_item in metric_names:
        normalized_name = _normalize_text(metric_name_item)
        if not normalized_name:
            continue
        if normalized_metric == normalized_name:
            best_score = max(best_score, 100)
            continue
        if normalized_name in normalized_metric:
            best_score = max(best_score, 80)
            continue
        if normalized_metric in normalized_name:
            best_score = max(best_score, 60)
    return best_score


def _extract_first_numeric_value(row: pd.Series, value_columns: list[Any]) -> float | None:
    preferred_keywords = (
        "value",
        "本期",
        "期末",
        "金额",
        "数值",
        "值",
    )

    ordered_columns = sorted(
        value_columns,
        key=lambda column: (
            0
            if any(keyword in _normalize_text(str(column)) for keyword in preferred_keywords)
            else 1,
            str(column),
        ),
    )

    for column in ordered_columns:
        numeric = _safe_float(row.get(column))
        if numeric is not None:
            return numeric
    return None


def _select_recent_points(
    points: list[dict[str, Any]],
    years: int,
) -> list[dict[str, Any]]:
    if not points:
        return []

    normalized_years = max(years, 1)
    ordered_points = sorted(points, key=lambda item: str(item.get("date") or ""))
    annual_points = [
        point
        for point in ordered_points
        if str(point.get("date") or "").endswith("-12-31")
    ]
    if len(annual_points) >= normalized_years:
        return annual_points[-normalized_years:]
    return ordered_points[-normalized_years:]


def _to_secucode(code: str) -> str:
    if code.startswith(("60", "68")):
        return f"{code}.SH"
    if code.startswith(("4", "8")):
        return f"{code}.BJ"
    return f"{code}.SZ"


def _find_column(df: pd.DataFrame, keywords: tuple[str, ...]) -> str | None:
    if df.empty:
        return None

    columns = [str(column) for column in df.columns]
    normalized_columns = [_normalize_text(column) for column in columns]
    normalized_keywords = [_normalize_text(keyword) for keyword in keywords if keyword]

    for keyword in normalized_keywords:
        for index, normalized_column in enumerate(normalized_columns):
            if keyword and keyword in normalized_column:
                return columns[index]

    return None


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"[\s_\-]+", "", str(value).strip().lower())


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

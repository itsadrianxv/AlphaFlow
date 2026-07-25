"""Sell-side forecast and chip-position endpoints used by the overview."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import pandas as pd
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.contracts.common import BatchItemError
from app.data_providers import get_default_data_provider
from app.gateway.common import GatewayError, execute_cached, gateway_cache, is_valid_stock_code
from app.policies.cache_policy import get_cache_policy
from app.policies.retry_policy import RetryPolicy

router = APIRouter(prefix="/api/v1/sell-side")


class SellSideRowsRequest(BaseModel):
    startDate: str | None = None
    endDate: str | None = None
    month: str | None = None


class ChipPositionsRequest(BaseModel):
    stockCodes: list[str] = Field(min_length=1, max_length=10)


def _number(row: pd.Series, key: str) -> float | None:
    value = pd.to_numeric(row.get(key), errors="coerce")
    return float(value) if pd.notna(value) else None


def _latest_non_empty(dataset: str, days: int = 14) -> pd.DataFrame:
    end = date.today()
    for offset in range(days + 1):
        day = (end - timedelta(days=offset)).strftime("%Y%m%d")
        frame = _raw(dataset, trade_date=day)
        if not frame.empty:
            return frame
    return pd.DataFrame()


def _money_flow_snapshot() -> dict[str, Any]:
    errors: dict[str, str] = {}
    market_history = pd.DataFrame()
    concepts = pd.DataFrame()
    stocks = pd.DataFrame()
    try:
        market_history = _raw(
            "moneyflow_mkt_dc",
            start_date=(date.today() - timedelta(days=24)).strftime("%Y%m%d"),
            end_date=date.today().strftime("%Y%m%d"),
        ).sort_values("trade_date").tail(10)
    except Exception as exc:  # noqa: BLE001
        errors["market"] = str(exc)
    try:
        concepts = _latest_non_empty("moneyflow_cnt_ths")
    except Exception as exc:  # noqa: BLE001
        errors["concepts"] = str(exc)
    try:
        stocks = _latest_non_empty("moneyflow_ths")
    except Exception as exc:  # noqa: BLE001
        errors["stocks"] = str(exc)

    def market_row(row: pd.Series) -> dict[str, Any]:
        return {
            "tradeDate": str(row.get("trade_date")),
            "closeSh": _number(row, "close_sh"),
            "pctChangeSh": _number(row, "pct_change_sh"),
            "closeSz": _number(row, "close_sz"),
            "pctChangeSz": _number(row, "pct_change_sz"),
            "netAmount": _number(row, "net_amount"),
            "netAmountRate": _number(row, "net_amount_rate"),
            "buyElgAmount": _number(row, "buy_elg_amount"),
            "buyElgAmountRate": _number(row, "buy_elg_amount_rate"),
            "buyLgAmount": _number(row, "buy_lg_amount"),
            "buyLgAmountRate": _number(row, "buy_lg_amount_rate"),
            "buyMdAmount": _number(row, "buy_md_amount"),
            "buyMdAmountRate": _number(row, "buy_md_amount_rate"),
            "buySmAmount": _number(row, "buy_sm_amount"),
            "buySmAmountRate": _number(row, "buy_sm_amount_rate"),
        }

    def concept_row(row: pd.Series) -> dict[str, Any]:
        return {"tsCode": str(row.get("ts_code")), "name": str(row.get("name")), "leadStock": str(row.get("lead_stock")), "pctChange": _number(row, "pct_change"), "netAmount": (_number(row, "net_amount") or 0) * 100_000_000}

    def stock_row(row: pd.Series) -> dict[str, Any]:
        return {"tsCode": str(row.get("ts_code")), "stockCode": str(row.get("ts_code")).split(".")[0], "name": str(row.get("name")), "pctChange": _number(row, "pct_change"), "latest": _number(row, "latest"), "netAmount": (_number(row, "net_amount") or 0) * 10_000, "netD5Amount": ((_number(row, "net_d5_amount") or 0) * 10_000) if _number(row, "net_d5_amount") is not None else None}

    concept_rows = [concept_row(row) for _, row in concepts.iterrows()]
    stock_rows = [stock_row(row) for _, row in stocks.iterrows()]
    concept_rows.sort(key=lambda row: (-row["netAmount"], row["tsCode"]))
    stock_rows.sort(key=lambda row: (-row["netAmount"], row["tsCode"]))
    return {
        "market": {"asOf": str(market_history.iloc[-1]["trade_date"]) if not market_history.empty else None, "history": [market_row(row) for _, row in market_history.iterrows()]},
        "concepts": {"asOf": str(concepts.iloc[0]["trade_date"]) if not concepts.empty else None, "inflows": concept_rows[:3], "outflows": sorted(concept_rows, key=lambda row: (row["netAmount"], row["tsCode"]))[:3]},
        "stocks": {"asOf": str(stocks.iloc[0]["trade_date"]) if not stocks.empty else None, "inflows": stock_rows[:3], "outflows": sorted(stock_rows, key=lambda row: (row["netAmount"], row["tsCode"]))[:3]},
        "errors": errors,
    }


@router.get("/money-flow")
async def money_flow():
    result = execute_cached(
        dataset="money_flow_overview",
        provider="tushare",
        params={"window": 10},
        fetcher=_money_flow_snapshot,
        cache_policy=get_cache_policy("money_flow_overview"),
        retry_policy=RetryPolicy(max_attempts=2),
        cache=gateway_cache,
    )
    return {"data": result.data, "meta": {"asOf": result.as_of, "isStale": result.is_stale, "warnings": [warning.message for warning in result.warnings]}}


def _records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    normalized = frame.replace([float("inf"), float("-inf")], None).astype(object)
    return normalized.where(pd.notna(normalized), None).to_dict(orient="records")


def _raw(dataset: str, **params: str) -> pd.DataFrame:
    provider = get_default_data_provider()
    loader = getattr(provider, "get_raw_frame", None)
    if loader is None:
        raise GatewayError(code="raw_dataset_unavailable", message="当前数据源不支持特色数据接口", status_code=503, provider="tushare")
    return loader(dataset, **params)


def _paged_raw(dataset: str, **params: str) -> pd.DataFrame:
    pages: list[pd.DataFrame] = []
    offset = 0
    while True:
        frame = _raw(dataset, **params, limit="3000", offset=str(offset))
        pages.append(frame)
        if len(frame) < 3000:
            break
        offset += 3000
    return pd.concat(pages, ignore_index=True) if pages else pd.DataFrame()


@router.post("/recommendations")
async def recommendations(body: SellSideRowsRequest):
    if not body.month:
        raise GatewayError(code="month_required", message="month 为必填参数", status_code=400, provider="tushare")
    return {"data": {"items": _records(_raw("broker_recommend", month=body.month))}}


@router.post("/forecasts")
async def forecasts(body: SellSideRowsRequest):
    params = {key: value for key, value in {"start_date": body.startDate, "end_date": body.endDate}.items() if value}
    if not params:
        raise GatewayError(code="date_range_required", message="startDate 或 endDate 至少提供一个", status_code=400, provider="tushare")
    return {"data": {"items": _records(_paged_raw("report_rc", **params))}}


@router.post("/chip-positions")
async def chip_positions(body: ChipPositionsRequest):
    invalid = [code for code in body.stockCodes if not is_valid_stock_code(code)]
    if invalid:
        raise GatewayError(code="invalid_stock_code", message=f"无效股票代码: {', '.join(invalid)}", status_code=400, provider="tushare")
    provider = get_default_data_provider()
    items: list[dict[str, Any]] = []
    errors: list[BatchItemError] = []
    end = date.today()
    start = end - timedelta(days=18)
    for code in body.stockCodes:
        try:
            profile = provider.get_stock_profile(code)
            cyq = _raw("cyq_perf", ts_code=profile.tsCode, start_date=start.strftime("%Y%m%d"), end_date=end.strftime("%Y%m%d"))
            qfq_bars = provider.get_daily_bars(code, start_date=start.strftime("%Y%m%d"), end_date=end.strftime("%Y%m%d"), adjust="qfq")
            raw_bars = provider.get_daily_bars(code, start_date=start.strftime("%Y%m%d"), end_date=end.strftime("%Y%m%d"), adjust="")
            if cyq.empty or not qfq_bars or not raw_bars:
                raise ValueError("筹码或日线数据为空")
            cyq = cyq.sort_values("trade_date")
            latest = cyq.iloc[-1]
            previous = cyq.iloc[max(0, len(cyq) - 6)]
            qfq_close = next((bar.close for bar in reversed(qfq_bars) if bar.close is not None), None)
            raw_close = next((bar.close for bar in reversed(raw_bars) if bar.close is not None), None)
            if qfq_close is None:
                raise ValueError("缺少收盘价")
            factor = float(qfq_close) / float(raw_close) if raw_close else 1.0
            items.append({
                "stockCode": code,
                "stockName": profile.stockName,
                "asOfDate": str(latest["trade_date"]),
                "close": float(qfq_close),
                "cost15": float(latest["cost_15pct"]) * factor,
                "cost50": float(latest["cost_50pct"]) * factor,
                "cost85": float(latest["cost_85pct"]) * factor,
                "weightAvg": float(latest["weight_avg"]) * factor,
                "winnerRate": float(latest["winner_rate"]),
                "winnerRateChange5d": float(latest["winner_rate"]) - float(previous["winner_rate"]),
                "weightAvgChange5d": (float(latest["weight_avg"]) - float(previous["weight_avg"])) * factor,
            })
        except Exception as exc:  # noqa: BLE001
            errors.append(BatchItemError(stockCode=code, code="chip_position_failed", message=str(exc)))
    return {"data": {"items": items, "errors": errors}}

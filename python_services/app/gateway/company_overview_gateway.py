"""Company overview aggregation backed by TuShare raw datasets."""

from __future__ import annotations

from datetime import datetime
import time
from typing import Any

import pandas as pd

from app.data_providers import get_default_data_provider
from app.gateway.common import GatewayError, build_meta, execute_cached, gateway_cache
from app.policies.cache_policy import get_cache_policy
from app.policies.retry_policy import RetryPolicy


def _number(value: Any) -> float | None:
    if value is None or pd.isna(value):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _text(value: Any) -> str | None:
    if value is None or pd.isna(value):
        return None
    normalized = str(value).strip()
    return normalized or None


class CompanyOverviewGateway:
    def __init__(self, provider: Any | None = None) -> None:
        self._provider = provider or get_default_data_provider()
        self._cache = gateway_cache
        self._retry_policy = RetryPolicy()

    def get_overview(self, *, request_id: str, stock_code: str) -> dict[str, Any]:
        started_at = time.perf_counter()
        result = execute_cached(
            dataset="company_overview",
            provider=getattr(self._provider, "provider_name", "tushare"),
            params={"stockCode": stock_code},
            fetcher=lambda: self._build(stock_code),
            cache_policy=get_cache_policy("company_overview"),
            retry_policy=self._retry_policy,
            cache=self._cache,
        )
        return {
            "meta": build_meta(
                request_id=request_id,
                provider=result.provider,
                started_at=started_at,
                cache_hit=result.cache_hit,
                is_stale=result.is_stale,
                warnings=result.warnings,
                as_of=result.as_of,
            ).model_dump(mode="json"),
            "data": result.data,
        }

    def _raw(self, dataset: str, **params: str) -> pd.DataFrame:
        loader = getattr(self._provider, "get_raw_frame", None)
        if loader is None:
            raise GatewayError("raw_dataset_unavailable", "当前数据源不支持公司概况所需数据集", 503, "tushare")
        frame = loader(dataset, **params)
        return frame.copy() if isinstance(frame, pd.DataFrame) else pd.DataFrame()

    def _build(self, stock_code: str) -> dict[str, Any]:
        profile = self._provider.get_stock_profile(stock_code)
        ts_code = profile.tsCode
        company = self._raw("stock_company", ts_code=ts_code)
        company_row = company.iloc[0] if not company.empty else {}
        income = self._dedupe_reports(self._raw("income", ts_code=ts_code))
        cashflow = self._dedupe_reports(self._raw("cashflow", ts_code=ts_code))
        self._dedupe_reports(self._raw("balancesheet", ts_code=ts_code))
        indicator = self._dedupe_reports(self._raw("fina_indicator", ts_code=ts_code))
        daily_basic = self._raw("daily_basic", ts_code=ts_code)
        main_business = self._raw("fina_mainbz", ts_code=ts_code, type="P")
        quarters = self._quarters(income, cashflow, indicator)
        annuals = self._annuals(income, cashflow, indicator)
        latest_basic = (
            daily_basic.sort_values("trade_date", ascending=False).iloc[0]
            if not daily_basic.empty and "trade_date" in daily_basic.columns
            else {}
        )
        return {
            "stockCode": stock_code,
            "tsCode": ts_code,
            "companyName": profile.stockName,
            "exchange": profile.market,
            "updatedAt": datetime.now().isoformat(),
            "profile": {
                "introduction": _text(company_row.get("introduction")),
                "mainBusiness": _text(company_row.get("main_business")),
                "businessScope": _text(company_row.get("business_scope")),
            },
            "financials": {
                "quarters": quarters,
                "annuals": annuals,
                "valuation": {
                    "asOfDate": _text(latest_basic.get("trade_date")),
                    "pe": _number(latest_basic.get("pe_ttm")) or _number(latest_basic.get("pe")),
                    "pb": _number(latest_basic.get("pb")),
                    "ps": _number(latest_basic.get("ps_ttm")) or _number(latest_basic.get("ps")),
                },
            },
            "businesses": self._businesses(main_business),
        }

    def _dedupe_reports(self, frame: pd.DataFrame) -> pd.DataFrame:
        if frame.empty or "end_date" not in frame.columns:
            return pd.DataFrame()
        normalized = frame.copy()
        if "ann_date" in normalized.columns:
            normalized = normalized.sort_values(["end_date", "ann_date"], ascending=False)
        return normalized.drop_duplicates("end_date", keep="first")

    def _point(self, end_date: str, income: pd.Series, cashflow: pd.Series, indicator: pd.Series) -> dict[str, Any]:
        revenue = _number(income.get("revenue")) or _number(income.get("total_revenue"))
        operating_cashflow = _number(cashflow.get("n_cashflow_act"))
        capex = _number(cashflow.get("c_pay_acq_const_fiolta"))
        return {
            "endDate": end_date,
            "revenue": revenue,
            "netProfit": _number(income.get("n_income_attr_p")),
            "deductedNetProfit": _number(income.get("net_after_nr_lp_correct")),
            "grossMargin": _number(indicator.get("grossprofit_margin")) or _number(indicator.get("gross_margin")),
            "netMargin": _number(indicator.get("netprofit_margin")),
            "operatingCashflow": operating_cashflow,
            "freeCashflow": operating_cashflow - capex if operating_cashflow is not None and capex is not None else None,
            "roe": _number(indicator.get("roe")) or _number(indicator.get("roe_waa")),
            "roic": _number(indicator.get("roic")),
        }

    def _quarters(self, income: pd.DataFrame, cashflow: pd.DataFrame, indicator: pd.DataFrame) -> list[dict[str, Any]]:
        income = self._to_single_quarter(
            income,
            ["revenue", "total_revenue", "n_income_attr_p", "net_after_nr_lp_correct"],
        )
        cashflow = self._to_single_quarter(
            cashflow,
            ["n_cashflow_act", "c_pay_acq_const_fiolta"],
        )
        dates = sorted(set(income.get("end_date", pd.Series(dtype=str)).astype(str)), reverse=True)[:8]
        return [self._point(date, self._row(income, date), self._row(cashflow, date), self._row(indicator, date)) for date in dates]

    @staticmethod
    def _to_single_quarter(frame: pd.DataFrame, fields: list[str]) -> pd.DataFrame:
        """TuShare interim statements are cumulative; convert each fiscal year to single quarters."""
        if frame.empty or "end_date" not in frame.columns:
            return frame
        result = frame.copy().sort_values("end_date")
        result["_year"] = result["end_date"].astype(str).str[:4]
        for field in fields:
            if field not in result.columns:
                continue
            values = pd.to_numeric(result[field], errors="coerce")
            result[field] = values.groupby(result["_year"]).diff().fillna(values)
        return result.drop(columns=["_year"])

    def _annuals(self, income: pd.DataFrame, cashflow: pd.DataFrame, indicator: pd.DataFrame) -> list[dict[str, Any]]:
        dates = [date for date in income.get("end_date", pd.Series(dtype=str)).astype(str).tolist() if date.endswith("1231")]
        return [self._point(date, self._row(income, date), self._row(cashflow, date), self._row(indicator, date)) for date in sorted(set(dates), reverse=True)[:5]]

    @staticmethod
    def _row(frame: pd.DataFrame, end_date: str) -> pd.Series:
        if frame.empty or "end_date" not in frame.columns:
            return pd.Series(dtype=object)
        rows = frame[frame["end_date"].astype(str) == end_date]
        return rows.iloc[0] if not rows.empty else pd.Series(dtype=object)

    def _businesses(self, frame: pd.DataFrame) -> list[dict[str, Any]]:
        if frame.empty or "end_date" not in frame.columns:
            return []
        years = sorted({str(date)[:4] for date in frame["end_date"].tolist() if str(date).endswith("1231")}, reverse=True)[:3]
        grouped: dict[str, list[dict[str, Any]]] = {}
        for year in years:
            rows = frame[frame["end_date"].astype(str).str.startswith(year)]
            total = sum(_number(value) or 0 for value in rows.get("bz_sales", pd.Series(dtype=float)))
            for _, row in rows.iterrows():
                name = _text(row.get("bz_item"))
                if not name:
                    continue
                sales, profit, cost = _number(row.get("bz_sales")), _number(row.get("bz_profit")), _number(row.get("bz_cost"))
                grouped.setdefault(name, []).append({"year": year, "revenue": sales, "revenueShare": sales / total * 100 if sales is not None and total else None, "profit": profit, "grossMargin": (profit / sales * 100 if profit is not None and sales else (sales - cost) / sales * 100 if sales and cost is not None else None)})
        items: list[dict[str, Any]] = []
        for name, history in grouped.items():
            history.sort(key=lambda item: item["year"], reverse=True)
            latest, previous = history[0], history[1] if len(history) > 1 else None
            growth = (latest["revenue"] / previous["revenue"] - 1) * 100 if previous and latest["revenue"] is not None and previous["revenue"] else None
            role = "核心主业" if (latest["revenueShare"] or 0) >= 30 else "新业务" if len(history) == 1 else "收缩业务" if growth is not None and growth < 0 else "高增长" if growth is not None and growth >= 25 else "现金牛" if (latest["grossMargin"] or 0) >= 30 else "其他业务"
            items.append({"name": name, "role": role, "revenueGrowth": growth, "history": history})
        return sorted(items, key=lambda item: item["history"][0]["revenue"] or 0, reverse=True)


company_overview_gateway = CompanyOverviewGateway()

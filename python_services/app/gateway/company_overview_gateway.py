"""Company overview aggregation backed by TuShare raw datasets."""

from __future__ import annotations

from datetime import datetime
import time
from typing import Any

import pandas as pd

from app.data_providers import get_default_data_provider
from app.financial_metrics.models import MetricSeriesResult, SeriesQuery
from app.financial_metrics.service import FinancialMetricService, get_financial_metric_service
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
    DEFAULT_METRIC_IDS = (
        "income.total_revenue",
        "income.n_income_attr_p",
        "income.basic_eps",
        "balancesheet.total_assets",
        "balancesheet.total_liab",
        "cashflow.n_cashflow_act",
    )

    def __init__(self, provider: Any | None = None, financial_service: FinancialMetricService | None = None) -> None:
        self._provider = provider or get_default_data_provider()
        self._financial = financial_service or get_financial_metric_service()
        self._cache = gateway_cache
        self._retry_policy = RetryPolicy()

    def get_overview(self, *, request_id: str, stock_code: str, metric_ids: tuple[str, ...] | None = None) -> dict[str, Any]:
        selected_metrics = metric_ids or self.DEFAULT_METRIC_IDS
        started_at = time.perf_counter()
        result = execute_cached(
            dataset="company_overview",
            provider=getattr(self._provider, "provider_name", "tushare"),
            params={"stockCode": stock_code, "metricIds": list(selected_metrics)},
            fetcher=lambda: self._build(stock_code, selected_metrics),
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

    def _build(self, stock_code: str, metric_ids: tuple[str, ...] | None = None) -> dict[str, Any]:
        profile = self._provider.get_stock_profile(stock_code)
        ts_code = profile.tsCode
        company = self._raw("stock_company", ts_code=ts_code)
        company_row = company.iloc[0] if not company.empty else {}
        main_business = self._raw("fina_mainbz", ts_code=ts_code, type="P")
        financials = self._financial_series(stock_code, metric_ids or self.DEFAULT_METRIC_IDS)
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
            "financials": financials,
            "businesses": self._businesses(main_business),
        }

    def _financial_series(self, stock_code: str, metric_ids: tuple[str, ...]) -> dict[str, Any]:
        today = datetime.now()
        annual_periods = tuple(str(year) for year in range(today.year - 5, today.year + 1))
        quarter_periods: list[str] = []
        year, quarter = today.year, (today.month - 1) // 3 + 1
        for offset in range(11, -1, -1):
            absolute = year * 4 + quarter - 1 - offset
            quarter_periods.append(f"{absolute // 4}Q{absolute % 4 + 1}")
        annual = self._financial.get_series(SeriesQuery(
            stock_codes=(stock_code,), metric_ids=metric_ids, periods=annual_periods,
            period_type="ANNUAL", use_case="COMPANY_OVERVIEW",
        ))
        quarterly = self._financial.get_series(SeriesQuery(
            stock_codes=(stock_code,), metric_ids=metric_ids, periods=tuple(quarter_periods),
            period_type="QUARTERLY", use_case="COMPANY_OVERVIEW",
        ))
        return {
            "metrics": [definition.to_dict() for definition in annual.definitions],
            "quarters": self._series_points(quarterly),
            "annuals": self._series_points(annual),
            "warnings": [warning.to_dict() for warning in [*annual.warnings, *quarterly.warnings]],
        }

    @staticmethod
    def _series_points(result: MetricSeriesResult) -> list[dict[str, Any]]:
        if result.frame.empty:
            return []
        pivot = result.frame.pivot_table(index="period", columns="metric_id", values="value", aggfunc="first", dropna=False)
        points = []
        for period in reversed(result.periods):
            if period not in pivot.index:
                continue
            values = {
                definition.id: _number(pivot.loc[period].get(definition.id))
                for definition in result.definitions
            }
            points.append({"endDate": period, "values": values})
        return points

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

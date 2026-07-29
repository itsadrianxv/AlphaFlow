"""C++ worker 调用的全股票池筛选执行服务。"""

from __future__ import annotations

from typing import Any

import pandas as pd

from app.financial_metrics.models import SeriesQuery
from app.financial_metrics.service import FinancialMetricService, get_financial_metric_service
from app.services.screening_formula_engine import SafeFormulaEngine
from app.services.screening_periods import resolve_periods
from app.services.screening_stock_universe_store import ScreeningStockUniverseStore


class ScreeningRunExecutor:
    def __init__(self, financial_service: FinancialMetricService | None = None, universe_store: ScreeningStockUniverseStore | None = None) -> None:
        self._financial = financial_service or get_financial_metric_service()
        self._universe_store = universe_store or ScreeningStockUniverseStore()
        self._formula_engine = SafeFormulaEngine()

    def execute(self, run_id: str, config: dict[str, Any]) -> dict[str, Any]:
        universe_records = self._resolve_universe(dict(config.get("universe") or {}))
        stock_codes = tuple(item["stockCode"] for item in universe_records)
        metric_ids = list(dict.fromkeys(str(value) for value in config.get("indicatorIds", [])))
        formulas = list(config.get("formulas", []))
        for formula in formulas:
            metric_ids.extend(str(value) for value in formula.get("targetIndicators", []))
        metric_ids = list(dict.fromkeys(metric_ids))
        if len(metric_ids) > 30:
            raise ValueError("直接指标与公式依赖合计最多 30 个")
        time_config = dict(config.get("timeConfig") or {})
        periods = tuple(resolve_periods(time_config))
        series = self._financial.get_series(SeriesQuery(
            stock_codes=stock_codes, metric_ids=tuple(metric_ids), periods=periods,
            period_type=time_config["periodType"], use_case="SCREENING",
        ))
        frame = series.frame.copy()
        if frame.empty:
            return self._response(run_id, len(stock_codes), [], series, "PARTIAL")
        pivot = frame.pivot_table(index=["stock_code", "period"], columns="metric_id", values="value", aggfunc="first").reset_index()
        for formula in formulas:
            targets = [str(value) for value in formula.get("targetIndicators", [])]
            expression = str(formula.get("expression", ""))
            pivot[str(formula["id"])] = pivot.apply(
                lambda row: self._formula_engine.evaluate(expression=expression, variables=[self._nullable(row.get(metric_id)) for metric_id in targets]),
                axis=1,
            )
        latest_period = periods[-1]
        latest = pivot[pivot["period"] == latest_period].copy()
        for rule in config.get("filterRules", []):
            metric_id = str(rule.get("metricId", ""))
            if metric_id not in latest:
                latest = latest.iloc[0:0]
                break
            latest = latest[latest[metric_id].apply(lambda value: self._matches(value, str(rule.get("operator")), rule.get("value")))]
        sort_state = config.get("sortState")
        if isinstance(sort_state, dict) and str(sort_state.get("metricId")) in latest:
            latest = latest.sort_values(
                [str(sort_state["metricId"]), "stock_code"],
                ascending=[sort_state.get("direction") != "desc", True], na_position="last",
            )
        else:
            latest = latest.sort_values("stock_code")
        results = [{"stockCode": code, "rank": index} for index, code in enumerate(latest["stock_code"].astype(str).tolist(), start=1)]
        status = "PARTIAL" if series.warnings else "SUCCEEDED"
        return self._response(run_id, len(stock_codes), results, series, status)

    def _resolve_universe(self, universe: dict[str, Any]) -> list[dict[str, str]]:
        records = self._universe_store.load_records()
        kind = universe.get("type")
        if kind == "ALL_A_SHARES":
            return records
        if kind == "INDUSTRY":
            names = {str(value) for value in universe.get("industryNames", [])}
            return [record for record in records if record.get("industry") in names]
        if kind == "STOCKS":
            codes = {str(value) for value in universe.get("stockCodes", [])}
            return [record for record in records if record["stockCode"] in codes]
        raise ValueError("无效的筛选股票池")

    @staticmethod
    def _nullable(value: Any) -> float | None:
        return None if value is None or pd.isna(value) else float(value)

    @staticmethod
    def _matches(candidate: Any, operator: str, expected: Any) -> bool:
        if candidate is None or pd.isna(candidate):
            return False
        try:
            left, right = float(candidate), float(expected)
        except (TypeError, ValueError):
            left, right = str(candidate), str(expected)
        return {">": left > right, ">=": left >= right, "<": left < right, "<=": left <= right, "=": left == right, "!=": left != right}.get(operator, False)

    @staticmethod
    def _response(run_id: str, universe_count: int, results: list[dict[str, Any]], series, status: str) -> dict[str, Any]:
        return {
            "runId": run_id, "status": status, "universeCount": universe_count,
            "totalCount": len(results), "results": results,
            "warnings": [warning.to_dict() for warning in series.warnings],
            "diagnostics": series.diagnostics,
        }

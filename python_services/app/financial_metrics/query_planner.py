"""普通财报接口与 VIP 接口的确定性成本规划。"""

from __future__ import annotations

from collections import defaultdict

from app.financial_metrics.models import MetricDefinition, QueryPlan, QueryStep, SeriesQuery


def _end_date(period: str) -> str:
    if len(period) == 4 and period.isdigit():
        return f"{period}1231"
    if len(period) == 6 and period[4] == "Q":
        return f"{period[:4]}" + {"1": "0331", "2": "0630", "3": "0930", "4": "1231"}[period[5]]
    return period.replace("-", "")


def _raw_periods(query: SeriesQuery, metrics: list[MetricDefinition]) -> tuple[str, ...]:
    periods = {_end_date(period) for period in query.periods}
    if query.period_type == "QUARTERLY" and any(metric.quarter_transform == "cumulative" for metric in metrics):
        for period in query.periods:
            if len(period) != 6 or period[4] != "Q":
                continue
            year, quarter = period[:4], period[5]
            if quarter == "2": periods.add(f"{year}0331")
            if quarter == "3": periods.add(f"{year}0630")
            if quarter == "4": periods.add(f"{year}0930")
    return tuple(sorted(periods))


def build_query_plan(query: SeriesQuery, definitions: tuple[MetricDefinition, ...]) -> QueryPlan:
    grouped: dict[str, list[MetricDefinition]] = defaultdict(list)
    for definition in definitions:
        grouped[definition.dataset].append(definition)
    steps: list[QueryStep] = []
    for dataset, metrics in grouped.items():
        raw_periods = _raw_periods(query, metrics)
        regular_cost, vip_cost = len(query.stock_codes), len(raw_periods)
        if regular_cost == vip_cost:
            strategy = "regular" if query.use_case == "COMPANY_OVERVIEW" else "vip"
        else:
            strategy = "regular" if regular_cost < vip_cost else "vip"
        steps.append(QueryStep(
            dataset=dataset, strategy=strategy, stock_codes=query.stock_codes,
            raw_periods=raw_periods, fields=tuple(sorted({metric.field for metric in metrics})),
        ))
    return QueryPlan(tuple(steps))

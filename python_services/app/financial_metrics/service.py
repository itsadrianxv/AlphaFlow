"""财务指标模块对外 facade。"""

from __future__ import annotations

from functools import lru_cache

import pandas as pd

from app.financial_metrics.catalog import list_metrics as catalog_list_metrics
from app.financial_metrics.catalog import metric_map, search_metrics as catalog_search_metrics
from app.financial_metrics.models import MetricSeriesResult, MetricWarning, SeriesQuery
from app.financial_metrics.normalization import to_metric_frame
from app.financial_metrics.providers import TushareFinancialStatementProvider
from app.financial_metrics.query_planner import build_query_plan


class FinancialMetricService:
    def __init__(self, provider=None) -> None:
        self._provider = provider or TushareFinancialStatementProvider()

    def list_metrics(self):
        return catalog_list_metrics()

    def search_metrics(self, query: str, *, company_type: str | None = None, limit: int = 50):
        return catalog_search_metrics(query, company_type, limit)

    def get_series(self, query: SeriesQuery) -> MetricSeriesResult:
        if not query.stock_codes:
            raise ValueError("stock_codes 不能为空")
        if not query.periods:
            raise ValueError("periods 不能为空")
        if len(query.metric_ids) > 30:
            raise ValueError("单次最多查询 30 个指标")
        definitions_by_id = metric_map()
        unknown = [metric_id for metric_id in query.metric_ids if metric_id not in definitions_by_id]
        if unknown:
            raise ValueError(f"未知财务指标: {', '.join(unknown)}")
        definitions = tuple(definitions_by_id[metric_id] for metric_id in query.metric_ids)
        plan = build_query_plan(query, definitions)
        frames_by_dataset: dict[str, list[pd.DataFrame]] = {}
        warnings: list[MetricWarning] = []
        for step in plan.steps:
            frames, step_warnings = self._provider.execute(step)
            frames_by_dataset[step.dataset] = frames
            warnings.extend(MetricWarning(code="provider_warning", message=message, dataset=step.dataset) for message in step_warnings)
        normalized_frames: list[pd.DataFrame] = []
        for dataset in {definition.dataset for definition in definitions}:
            dataset_definitions = tuple(definition for definition in definitions if definition.dataset == dataset)
            frame, normalization_warnings = to_metric_frame(frames_by_dataset.get(dataset, []), dataset_definitions, query)
            normalized_frames.append(frame)
            warnings.extend(normalization_warnings)
        combined = pd.concat(normalized_frames, ignore_index=True) if normalized_frames else pd.DataFrame()
        if combined.empty and warnings:
            raise RuntimeError("所有财务报表切片均不可用: " + "; ".join(warning.message for warning in warnings[:3]))
        return MetricSeriesResult(
            definitions=definitions, periods=query.periods, frame=combined, warnings=warnings,
            diagnostics={"provider": self._provider.provider_name, "steps": [step.__dict__ for step in plan.steps]},
        )


@lru_cache(maxsize=1)
def get_financial_metric_service() -> FinancialMetricService:
    return FinancialMetricService()

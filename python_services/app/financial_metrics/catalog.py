"""静态财务指标目录。"""

from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path

from app.financial_metrics.models import MetricDefinition


@lru_cache(maxsize=1)
def list_metrics() -> tuple[MetricDefinition, ...]:
    payload = json.loads(Path(__file__).with_name("catalog_data.json").read_text(encoding="utf-8"))
    return tuple(
        MetricDefinition(
            id=item["id"], name=item["name"], description=item["description"],
            dataset=item["dataset"], field=item["field"], statement_name=item["statementName"],
            subcategory=item["subcategory"], value_kind=item["valueKind"],
            canonical_unit=item["canonicalUnit"], display_unit=item["displayUnit"],
            quarter_transform=item["quarterTransform"], period_semantics=item["periodSemantics"],
            applicable_company_types=tuple(item["applicableCompanyTypes"]),
            keywords=tuple(item["keywords"]), default_visible=bool(item["defaultVisible"]),
        )
        for item in payload
    )


def metric_map() -> dict[str, MetricDefinition]:
    return {metric.id: metric for metric in list_metrics()}


def search_metrics(query: str, company_type: str | None = None, limit: int = 50) -> tuple[MetricDefinition, ...]:
    needle = query.strip().casefold()
    if not needle:
        return ()

    def rank(metric: MetricDefinition) -> tuple[int, int, str]:
        candidates = [metric.name.casefold(), metric.id.casefold(), metric.field.casefold(), *(value.casefold() for value in metric.keywords)]
        exact = 0 if needle in candidates else 1
        prefix = 0 if any(value.startswith(needle) for value in candidates) else 1
        return exact, prefix, metric.id

    matched = [
        metric for metric in list_metrics()
        if (company_type is None or company_type in metric.applicable_company_types)
        and any(needle in value.casefold() for value in (metric.name, metric.id, metric.field, metric.description, *metric.keywords))
    ]
    return tuple(sorted(matched, key=rank)[: max(1, min(limit, 100))])

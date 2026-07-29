"""兼容筛选工作台 contract 的统一财务指标目录投影。"""

from __future__ import annotations

from functools import lru_cache

from app.financial_metrics.catalog import list_metrics


@lru_cache(maxsize=1)
def load_indicator_catalog() -> dict[str, list[dict[str, object]]]:
    metrics = list_metrics()
    category_keys: list[tuple[str, str]] = []
    for metric in metrics:
        key = (metric.dataset, metric.subcategory)
        if key not in category_keys:
            category_keys.append(key)
    categories = [
        {
            "id": f"{dataset}.{subcategory}", "name": f"{next(item.statement_name for item in metrics if item.dataset == dataset)} · {subcategory}",
            "description": subcategory,
            "indicatorCount": sum(1 for item in metrics if item.dataset == dataset and item.subcategory == subcategory),
            "sortOrder": index * 10,
        }
        for index, (dataset, subcategory) in enumerate(category_keys, start=1)
    ]
    items = []
    for index, metric in enumerate(metrics, start=1):
        value_type = "PERCENT" if metric.value_kind == "ratio" else "CURRENCY" if metric.value_kind == "currency" else "NUMBER"
        items.append({
            **metric.to_dict(),
            "categoryId": f"{metric.dataset}.{metric.subcategory}",
            "valueType": value_type,
            "periodScope": "series",
            "retrievalMode": "statement_series",
            "sourceDataset": metric.dataset,
            "sortOrder": index,
        })
    return {"categories": categories, "items": items}

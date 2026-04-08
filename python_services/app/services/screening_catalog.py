"""Indicator catalog loader for the screening workbench."""

from __future__ import annotations

from functools import lru_cache


_CATALOG = {
    "valuation": {
        "name": "估值水平",
        "items": [
            ("pe_ttm", "PE(TTM)", "NUMBER", "latest_only", "latest_only"),
            ("pb", "PB", "NUMBER", "latest_only", "latest_only"),
            ("market_cap", "总市值", "NUMBER", "latest_only", "latest_only"),
            ("float_market_cap", "流通市值", "NUMBER", "latest_only", "latest_only"),
        ],
    },
    "capital": {
        "name": "股本结构",
        "items": [
            ("total_shares", "总股本", "NUMBER", "latest_only", "latest_only"),
            ("float_a_shares", "流通A股", "NUMBER", "latest_only", "latest_only"),
        ],
    },
    "profitability": {
        "name": "盈利能力",
        "items": [
            ("roe_report", "ROE(报告期)", "PERCENT", "series", "statement_series"),
            ("eps_report", "EPS(报告期)", "NUMBER", "series", "statement_series"),
            ("asset_liability_ratio", "资产负债率", "PERCENT", "series", "statement_series"),
        ],
    },
    "growth": {
        "name": "成长质量",
        "items": [
            ("revenue", "营业收入", "NUMBER", "series", "statement_series"),
            ("net_profit_parent", "归母净利润", "NUMBER", "series", "statement_series"),
        ],
    },
}


@lru_cache(maxsize=1)
def load_indicator_catalog() -> dict[str, list[dict[str, object]]]:
    categories: list[dict[str, object]] = []
    items: list[dict[str, object]] = []
    for category_id, payload in _CATALOG.items():
        category_items = payload["items"]
        categories.append(
            {
                "id": category_id,
                "name": payload["name"],
                "indicatorCount": len(category_items),
            }
        )
        for indicator_id, name, value_type, period_scope, retrieval_mode in category_items:
            items.append(
                {
                    "id": indicator_id,
                    "name": name,
                    "categoryId": category_id,
                    "valueType": value_type,
                    "periodScope": period_scope,
                    "retrievalMode": retrieval_mode,
                    "description": payload["name"],
                }
            )
    return {"categories": categories, "items": items}

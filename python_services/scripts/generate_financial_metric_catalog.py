"""从本地 TuShare 文档生成运行时使用的静态财务指标目录。"""

from __future__ import annotations

import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
DOC_ROOT = ROOT / "docs" / "tushare" / "股票数据" / "财务数据"
OUTPUT = ROOT / "python_services" / "app" / "financial_metrics" / "catalog_data.json"

DATASETS = {
    "income": ("利润表.md", "利润表"),
    "balancesheet": ("资产负债表.md", "资产负债表"),
    "cashflow": ("现金流量表.md", "现金流量表"),
}

CONTROL_FIELDS = {
    "ts_code", "ann_date", "f_ann_date", "end_date", "report_type",
    "comp_type", "end_type", "update_flag",
}
PER_SHARE_FIELDS = {
    "basic_eps", "diluted_eps",
}
SHARE_FIELDS = {"total_share"}


def _classification(dataset: str, field: str, description: str) -> tuple[str, str, str]:
    text = f"{field} {description}".lower()
    if field in PER_SHARE_FIELDS or "每股" in description:
        return "per_share", "元/股", "reported_cumulative"
    if field in SHARE_FIELDS or "股本" in description or "股数" in description:
        return "shares", "股", "point_in_time" if dataset == "balancesheet" else "reported_cumulative"
    if any(token in description for token in ("比率", "比例", "收益率", "毛利率", "净利率")):
        return "ratio", "ratio", "reported_cumulative"
    transform = "point_in_time" if dataset == "balancesheet" else "cumulative"
    return "currency", "CNY", transform


def _subcategory(dataset: str, field: str, description: str) -> str:
    text = f"{field} {description}".lower()
    if dataset == "income":
        if any(word in text for word in ("revenue", "income", "收入", "保费")):
            return "收入"
        if any(word in text for word in ("cost", "expense", "exp", "成本", "费用", "支出")):
            return "成本与费用"
        return "利润与综合收益"
    if dataset == "balancesheet":
        if any(word in text for word in ("liab", "payable", "borr", "depos", "负债", "应付", "借款")):
            return "负债"
        if any(word in text for word in ("equity", "hldr", "share", "rese", "权益", "股本", "公积")):
            return "权益"
        return "资产"
    if any(word in text for word in ("inv_act", "invest", "投资")):
        return "投资活动现金流"
    if any(word in text for word in ("fnc_act", "borrow", "bond", "筹资", "融资")):
        return "筹资活动现金流"
    return "经营活动现金流"


def main() -> None:
    items: list[dict[str, object]] = []
    pattern = re.compile(r"^(\w+)\s+(float|int)\s+([YN])\s+(.+?)\s*$")
    for dataset, (filename, statement_name) in DATASETS.items():
        text = (DOC_ROOT / filename).read_text(encoding="utf-8")
        seen: set[str] = set()
        for line in text.splitlines():
            matched = pattern.match(line)
            if not matched:
                continue
            field, _, default_visible, description = matched.groups()
            if field in CONTROL_FIELDS or field in seen:
                continue
            seen.add(field)
            value_kind, unit, transform = _classification(dataset, field, description)
            items.append({
                "id": f"{dataset}.{field}",
                "name": description,
                "description": description,
                "dataset": dataset,
                "field": field,
                "statementName": statement_name,
                "subcategory": _subcategory(dataset, field, description),
                "valueKind": value_kind,
                "canonicalUnit": unit,
                "displayUnit": "亿元" if unit == "CNY" else ("%" if unit == "ratio" else unit),
                "quarterTransform": transform,
                "periodSemantics": "reported_cumulative" if transform == "reported_cumulative" else ("point_in_time" if transform == "point_in_time" else "single_quarter"),
                "applicableCompanyTypes": ["1", "2", "3", "4"],
                "keywords": [field, description, statement_name],
                "defaultVisible": default_visible == "Y",
            })
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"generated {len(items)} metrics -> {OUTPUT}")


if __name__ == "__main__":
    main()

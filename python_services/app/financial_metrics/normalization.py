"""财务报表版本、数值和季度口径标准化。"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

from app.financial_metrics.models import MetricDefinition, MetricWarning, SeriesQuery


CONTROL_COLUMNS = ["ts_code", "end_date", "ann_date", "f_ann_date", "report_type", "comp_type", "update_flag"]


def normalize_statement(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty or "ts_code" not in frame or "end_date" not in frame:
        return pd.DataFrame(columns=CONTROL_COLUMNS)
    result = frame.copy()
    result["ts_code"] = result["ts_code"].astype(str)
    result["stock_code"] = result["ts_code"].str.split(".").str[0]
    result["end_date"] = result["end_date"].astype(str).str.replace("-", "", regex=False)
    if "report_type" in result:
        result = result[result["report_type"].astype(str) == "1"]
    if result.empty:
        return result
    result["_latest"] = result.get("update_flag", pd.Series(index=result.index, dtype=object)).astype(str).eq("1").astype(int)
    for column in ("f_ann_date", "ann_date"):
        if column not in result:
            result[column] = ""
        result[column] = result[column].fillna("").astype(str)
    result = result.sort_values(
        ["stock_code", "end_date", "_latest", "f_ann_date", "ann_date"],
        ascending=[True, True, False, False, False],
    ).drop_duplicates(["stock_code", "end_date"], keep="first")
    return result.drop(columns=["_latest"], errors="ignore").reset_index(drop=True)


def _safe_number(value: Any) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    try:
        number = float(str(value).replace(",", "").strip())
    except ValueError:
        return None
    return number if math.isfinite(number) else None


def _canonical_value(metric: MetricDefinition, value: Any) -> float | None:
    number = _safe_number(value)
    if number is None:
        return None
    if metric.value_kind == "ratio" and abs(number) > 1:
        return number / 100
    return number


def _period_label(end_date: str, period_type: str) -> str:
    if period_type == "ANNUAL":
        return end_date[:4]
    quarter = {"0331": "Q1", "0630": "Q2", "0930": "Q3", "1231": "Q4"}.get(end_date[4:])
    return f"{end_date[:4]}{quarter}" if quarter else end_date


def to_metric_frame(
    frames: list[pd.DataFrame],
    definitions: tuple[MetricDefinition, ...],
    query: SeriesQuery,
) -> tuple[pd.DataFrame, list[MetricWarning]]:
    if not frames:
        return pd.DataFrame(columns=["stock_code", "metric_id", "period", "end_date", "value", "period_semantics"]), []
    raw = normalize_statement(pd.concat(frames, ignore_index=True, sort=False))
    rows: list[dict[str, Any]] = []
    warnings: list[MetricWarning] = []
    requested = set(query.periods)
    for metric in definitions:
        if metric.field not in raw:
            continue
        for stock_code, stock_rows in raw.groupby("stock_code"):
            values = {
                str(row["end_date"]): _canonical_value(metric, row.get(metric.field))
                for _, row in stock_rows.iterrows()
            }
            company_types = {
                str(value) for value in stock_rows.get("comp_type", pd.Series(dtype=object)).dropna().tolist()
            }
            applicable = not company_types or bool(company_types.intersection(metric.applicable_company_types))
            for end_date, reported in values.items():
                period = _period_label(end_date, query.period_type)
                if period not in requested:
                    continue
                value = reported if applicable else None
                semantics = metric.period_semantics
                if query.period_type == "QUARTERLY" and metric.quarter_transform == "cumulative" and end_date[4:] != "0331":
                    previous_suffix = {"0630": "0331", "0930": "0630", "1231": "0930"}.get(end_date[4:])
                    previous = values.get(f"{end_date[:4]}{previous_suffix}") if previous_suffix else None
                    if value is None or previous is None:
                        value = None
                        warnings.append(MetricWarning(
                            code="missing_previous_period",
                            message=f"{metric.name} {period} 缺少季度差分所需前置累计值",
                            dataset=metric.dataset,
                            period=period,
                        ))
                    else:
                        value -= previous
                    semantics = "single_quarter"
                rows.append({
                    "stock_code": stock_code, "metric_id": metric.id, "period": period,
                    "end_date": end_date, "value": value, "period_semantics": semantics,
                })
    warning_map = {(warning.code, warning.dataset, warning.period): warning for warning in warnings}
    return pd.DataFrame(rows), list(warning_map.values())

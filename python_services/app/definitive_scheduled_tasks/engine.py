"""三态条件求值、评分和稳定排名。"""

from __future__ import annotations

from enum import Enum
import math
from typing import Any

import pandas as pd

from app.definitive_scheduled_tasks.schemas import (
    AllCondition,
    AnyCondition,
    AtomicCondition,
    Condition,
    DeterministicExecutionPlan,
    NotCondition,
)


class ConditionStatus(str, Enum):
    MATCHED = "MATCHED"
    NOT_MATCHED = "NOT_MATCHED"
    NOT_EVALUATED = "NOT_EVALUATED"


def _safe_value(value: Any) -> Any:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, (int, float)):
        numeric = float(value)
        return numeric if math.isfinite(numeric) else None
    return value.item() if hasattr(value, "item") else value


def _atomic(condition: AtomicCondition, frames: dict[str, pd.DataFrame]) -> tuple[ConditionStatus, dict[str, Any], str | None]:
    frame = frames.get(condition.timeframe)
    observation_key = f"{condition.timeframe}.{condition.metric}"
    if frame is None or condition.metric not in frame.columns or frame.empty:
        return ConditionStatus.NOT_EVALUATED, {}, "指标数据不存在"
    current = _safe_value(frame.iloc[-1][condition.metric])
    previous = _safe_value(frame.iloc[-2][condition.metric]) if len(frame.index) >= 2 else None
    observation = {observation_key: {"current": current}}
    if condition.operator.startswith("cross_"):
        observation[observation_key]["previous"] = previous
    if current is None or (condition.operator.startswith("cross_") and previous is None):
        return ConditionStatus.NOT_EVALUATED, observation, "指标值不足"
    expected = condition.value
    try:
        matched = {
            "gt": lambda: current > expected,
            "gte": lambda: current >= expected,
            "lt": lambda: current < expected,
            "lte": lambda: current <= expected,
            "eq": lambda: current == expected,
            "ne": lambda: current != expected,
            "between": lambda: expected[0] <= current <= expected[1],
            "cross_above": lambda: previous <= expected < current,
            "cross_below": lambda: previous >= expected > current,
        }[condition.operator]()
    except (TypeError, ValueError, IndexError):
        return ConditionStatus.NOT_EVALUATED, observation, "指标值与目标值类型不兼容"
    return (ConditionStatus.MATCHED if matched else ConditionStatus.NOT_MATCHED), observation, None


def evaluate_condition(condition: Condition, frames: dict[str, pd.DataFrame]) -> tuple[ConditionStatus, dict[str, Any], str | None]:
    if isinstance(condition, AtomicCondition):
        return _atomic(condition, frames)
    if isinstance(condition, NotCondition):
        status, observations, reason = evaluate_condition(condition.not_, frames)
        if status == ConditionStatus.NOT_EVALUATED:
            return status, observations, reason
        return (
            ConditionStatus.NOT_MATCHED if status == ConditionStatus.MATCHED else ConditionStatus.MATCHED,
            observations,
            None,
        )
    children = condition.all if isinstance(condition, AllCondition) else condition.any
    results = [evaluate_condition(child, frames) for child in children]
    observations: dict[str, Any] = {}
    for _, values, _ in results:
        observations.update(values)
    statuses = [item[0] for item in results]
    if isinstance(condition, AllCondition):
        if ConditionStatus.NOT_MATCHED in statuses:
            return ConditionStatus.NOT_MATCHED, observations, None
        if all(status == ConditionStatus.MATCHED for status in statuses):
            return ConditionStatus.MATCHED, observations, None
    else:
        if ConditionStatus.MATCHED in statuses:
            return ConditionStatus.MATCHED, observations, None
        if all(status == ConditionStatus.NOT_MATCHED for status in statuses):
            return ConditionStatus.NOT_MATCHED, observations, None
    reasons = sorted({reason for _, _, reason in results if reason})
    return ConditionStatus.NOT_EVALUATED, observations, "; ".join(reasons) or "子条件未评估"


def score_stock(*, stock_code: str, stock_name: str, frames: dict[str, pd.DataFrame], plan: DeterministicExecutionPlan) -> dict[str, Any]:
    rule_results: dict[str, Any] = {}
    score = 0.0
    evaluated = 0
    for rule in plan.rules:
        status, observations, reason = evaluate_condition(rule.condition, frames)
        awarded = rule.points if status == ConditionStatus.MATCHED else 0.0
        if status != ConditionStatus.NOT_EVALUATED:
            evaluated += 1
        score += awarded
        rule_results[rule.id] = {
            "status": status.value,
            "awardedPoints": awarded,
            "possiblePoints": rule.points,
            "observations": observations,
            **({"reason": reason} if reason else {}),
        }
    evaluation_status = "NONE" if evaluated == 0 else "FULL" if evaluated == len(plan.rules) else "PARTIAL"
    return {
        "stockCode": stock_code,
        "stockName": stock_name,
        "rank": 0,
        "selected": False,
        "evaluationStatus": evaluation_status,
        "score": score,
        "maxScore": sum(rule.points for rule in plan.rules),
        "ruleResults": rule_results,
    }


def rank_and_select(rows: list[dict[str, Any]], plan: DeterministicExecutionPlan) -> list[dict[str, Any]]:
    rows.sort(key=lambda row: (row["evaluationStatus"] == "NONE", -row["score"], row["stockCode"]))
    eligible = 0
    for rank, row in enumerate(rows, start=1):
        row["rank"] = rank
        if row["evaluationStatus"] != "NONE" and row["score"] >= plan.selection.minScore and eligible < plan.selection.limit:
            row["selected"] = True
            eligible += 1
    return rows

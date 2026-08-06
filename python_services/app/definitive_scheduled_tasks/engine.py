"""受控 JSONLogic 三态求值、评分和稳定排名。"""

from __future__ import annotations

from enum import Enum
import math
from typing import Any

import pandas as pd

from app.definitive_scheduled_tasks.schemas import Condition, DeterministicExecutionPlan


class ConditionStatus(str, Enum):
    MATCHED = "MATCHED"
    NOT_MATCHED = "NOT_MATCHED"
    NOT_EVALUATED = "NOT_EVALUATED"


def _safe_value(value: Any) -> Any:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        numeric = float(value)
        return numeric if math.isfinite(numeric) else None
    return value.item() if hasattr(value, "item") else value


def _snapshot(frames: dict[str, pd.DataFrame]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for timeframe, frame in frames.items():
        if frame is None or frame.empty:
            continue
        values: dict[str, Any] = {}
        for column in frame.columns:
            current = _safe_value(frame.iloc[-1][column])
            previous = _safe_value(frame.iloc[-2][column]) if len(frame.index) >= 2 else None
            target = values
            parts = str(column).split(".")
            for part in parts[:-1]:
                target = target.setdefault(part, {})
            target[parts[-1]] = {"current": current, "previous": previous}
        result[timeframe] = values
    return result


def _lookup(snapshot: dict[str, Any], path: str) -> tuple[Any, dict[str, Any]]:
    current: Any = snapshot
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None, {"path": path, "value": None}
        current = current[part]
    return current, {"path": path, "value": current}


def _combine_all(statuses: list[ConditionStatus]) -> ConditionStatus:
    if ConditionStatus.NOT_MATCHED in statuses:
        return ConditionStatus.NOT_MATCHED
    if all(status == ConditionStatus.MATCHED for status in statuses):
        return ConditionStatus.MATCHED
    return ConditionStatus.NOT_EVALUATED


def _combine_any(statuses: list[ConditionStatus]) -> ConditionStatus:
    if ConditionStatus.MATCHED in statuses:
        return ConditionStatus.MATCHED
    if all(status == ConditionStatus.NOT_MATCHED for status in statuses):
        return ConditionStatus.NOT_MATCHED
    return ConditionStatus.NOT_EVALUATED


def _eval(node: Condition, snapshot: dict[str, Any]) -> tuple[ConditionStatus, Any, dict[str, Any], str | None, dict[str, Any]]:
    operator, args = next(iter(node.items()))
    if operator == "var":
        value, observation = _lookup(snapshot, args)
        status = ConditionStatus.NOT_EVALUATED if value is None else ConditionStatus.MATCHED
        return status, value, {args: observation}, "快照值不存在" if value is None else None, {
            "op": "var", "status": status.value, "path": args, "observation": observation,
            **({"reasonCode": "MISSING_SNAPSHOT_VALUE"} if value is None else {}),
        }
    if operator in {"and", "or"}:
        results = [_eval(child, snapshot) for child in args]
        statuses = [result[0] for result in results]
        status = _combine_all(statuses) if operator == "and" else _combine_any(statuses)
        observations: dict[str, Any] = {}
        reasons = []
        children = []
        for child_status, _, child_obs, reason, tree in results:
            observations.update(child_obs)
            if reason:
                reasons.append(reason)
            children.append(tree)
        return status, status == ConditionStatus.MATCHED, observations, "; ".join(sorted(set(reasons))) or None, {
            "op": operator, "status": status.value, "children": children,
        }
    if operator == "!":
        status, value, observations, reason, child = _eval(args[0], snapshot)
        next_status = status if status == ConditionStatus.NOT_EVALUATED else (
            ConditionStatus.NOT_MATCHED if status == ConditionStatus.MATCHED else ConditionStatus.MATCHED
        )
        return next_status, next_status == ConditionStatus.MATCHED, observations, reason, {
            "op": "!", "status": next_status.value, "children": [child],
        }
    if operator in {"cross_above", "cross_below"}:
        left, left_obs = _lookup(snapshot, args[0]["var"])
        if isinstance(args[1], dict):
            right, right_obs = _lookup(snapshot, args[1]["var"])
        else:
            right, right_obs = {"current": args[1], "previous": args[1]}, {"constant": args[1]}
        observations = {"left": left_obs, "right": right_obs}
        if not isinstance(left, dict) or not isinstance(right, dict):
            status = ConditionStatus.NOT_EVALUATED
            reason = "交叉操作数不是序列"
            reason_code = "CROSS_OPERAND_NOT_SERIES"
            matched = False
        else:
            lp, rp = _safe_value(left.get("previous")), _safe_value(right.get("previous"))
            lc, rc = _safe_value(left.get("current")), _safe_value(right.get("current"))
            observations["left"]["previous"] = lp
            observations["left"]["current"] = lc
            observations["right"]["previous"] = rp
            observations["right"]["current"] = rc
            if None in (lp, rp, lc, rc):
                status, reason, reason_code, matched = ConditionStatus.NOT_EVALUATED, "交叉值不足", "CROSS_VALUE_MISSING", False
            else:
                try:
                    matched = lp <= rp < lc if operator == "cross_above" else lp >= rp > lc
                    status, reason, reason_code = (ConditionStatus.MATCHED if matched else ConditionStatus.NOT_MATCHED), None, None
                except TypeError:
                    status, reason, reason_code, matched = ConditionStatus.NOT_EVALUATED, "交叉值类型不兼容", "OPERAND_TYPE_MISMATCH", False
        return status, matched, observations, reason, {
            "op": operator, "status": status.value, "children": [left_obs, right_obs],
            "observations": observations, **({"reason": reason, "reasonCode": reason_code} if reason else {}),
        }
    if operator in {"==", "===", "!=", "!==", "<", "<=", ">", ">=", "in"}:
        values: list[Any] = []
        observations: dict[str, Any] = {}
        reasons: list[str] = []
        for arg in args:
            if isinstance(arg, dict) and "var" in arg:
                value, obs = _lookup(snapshot, arg["var"])
                observations[arg["var"]] = obs
                if value is None:
                    reasons.append("快照值不存在")
                values.append(value)
            else:
                values.append(arg)
        if reasons:
            status, matched, reason, reason_code = ConditionStatus.NOT_EVALUATED, False, "; ".join(sorted(set(reasons))), "MISSING_SNAPSHOT_VALUE"
        else:
            try:
                left, right = values
                matched = {
                    "==": lambda: left == right, "===": lambda: type(left) is type(right) and left == right,
                    "!=": lambda: left != right, "!==": lambda: not (type(left) is type(right) and left == right),
                    "<": lambda: left < right, "<=": lambda: left <= right, ">": lambda: left > right,
                    ">=": lambda: left >= right, "in": lambda: left in right,
                }[operator]()
                status, reason, reason_code = (ConditionStatus.MATCHED if matched else ConditionStatus.NOT_MATCHED), None, None
            except (TypeError, ValueError):
                status, matched, reason, reason_code = ConditionStatus.NOT_EVALUATED, False, "操作数类型不兼容", "OPERAND_TYPE_MISMATCH"
        return status, matched, observations, reason, {
            "op": operator, "status": status.value, "operands": values,
            "observations": observations, **({"reason": reason, "reasonCode": reason_code} if reason else {}),
        }
    raise ValueError(f"不支持的 JSONLogic 操作符: {operator}")


def evaluate_condition(condition: Condition, frames: dict[str, pd.DataFrame]) -> tuple[ConditionStatus, dict[str, Any], str | None]:
    status, _, observations, reason, _ = _eval(condition, _snapshot(frames))
    return status, observations, reason


def evaluate_snapshot_condition(condition: Condition, snapshot: dict[str, Any]) -> tuple[ConditionStatus, dict[str, Any]]:
    """Evaluate shared contract fixtures directly against a normalized snapshot."""
    status, _, _, _, tree = _eval(condition, snapshot)
    return status, tree


def evaluate_condition_tree(condition: Condition, frames: dict[str, pd.DataFrame]) -> dict[str, Any]:
    status, _, observations, reason, tree = _eval(condition, _snapshot(frames))
    tree["status"] = status.value
    tree["observations"] = observations
    if reason:
        tree["reason"] = reason
    return tree


def score_stock(*, stock_code: str, stock_name: str, frames: dict[str, pd.DataFrame], plan: DeterministicExecutionPlan) -> dict[str, Any]:
    rule_results: dict[str, Any] = {}
    score = 0.0
    evaluated = 0
    for rule in plan.rules:
        status, observations, reason = evaluate_condition(rule.condition, frames)
        awarded = rule.scoreDelta if status == ConditionStatus.MATCHED else 0.0
        if status != ConditionStatus.NOT_EVALUATED:
            evaluated += 1
        rule_results[rule.id] = {
            "status": status.value,
            "configuredDelta": rule.scoreDelta,
            "awardedDelta": awarded,
            "observations": observations,
            "conditionTree": evaluate_condition_tree(rule.condition, frames),
            **({"reason": reason} if reason else {}),
        }
        score += awarded
    evaluation_status = "NONE" if evaluated == 0 else "FULL" if evaluated == len(plan.rules) else "PARTIAL"
    return {
        "stockCode": stock_code, "stockName": stock_name, "rank": 0, "selected": False,
        "evaluationStatus": evaluation_status, "score": score,
        "minimumPossibleScore": sum(min(rule.scoreDelta, 0) for rule in plan.rules),
        "maximumPossibleScore": sum(max(rule.scoreDelta, 0) for rule in plan.rules),
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

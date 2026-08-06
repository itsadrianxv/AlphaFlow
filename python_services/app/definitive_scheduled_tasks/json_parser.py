"""JSONLogic 规则语义校验和数据依赖推导。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.definitive_scheduled_tasks.schemas import DeterministicExecutionPlan


BUILTIN_METRICS = {"open", "high", "low", "close", "volume", "amount", "candle.direction"}
INDICATOR_OUTPUTS = {"macd": {"dif", "dea", "histogram"}, "kdj": {"k", "d", "j"}}
TIMEFRAMES = {"daily", "weekly", "monthly"}


@dataclass(frozen=True)
class DataRequirement:
    timeframes: tuple[str, ...]
    lookback_bars: dict[str, int]


class RuleSemanticError(ValueError):
    """JSON 格式正确但业务语义不合法。"""


def _resolve_var(path: str, indicators: dict[str, Any], *, require_series: bool = False) -> tuple[str, str]:
    parts = path.split(".")
    if len(parts) < 2 or parts[0] not in TIMEFRAMES:
        raise RuleSemanticError(f"快照路径无效: {path}")
    timeframe = parts[0]
    metric = ".".join(parts[1:])
    suffix = ""
    if metric.endswith(".current") or metric.endswith(".previous"):
        metric, suffix = metric.rsplit(".", 1)
    if metric in BUILTIN_METRICS:
        if require_series and metric in {"candle.direction"}:
            raise RuleSemanticError(f"快照路径不是数值序列: {path}")
        return timeframe, metric
    metric_parts = metric.split(".")
    if len(metric_parts) != 2 or metric_parts[0] not in indicators:
        raise RuleSemanticError(f"未知指标字段: {path}")
    indicator = indicators[metric_parts[0]]
    if timeframe not in indicator.timeframes:
        raise RuleSemanticError(f"{metric} 未声明 {timeframe} 周期")
    if metric_parts[1] not in INDICATOR_OUTPUTS[indicator.type]:
        raise RuleSemanticError(f"指标输出不存在: {metric}")
    return timeframe, metric


def parse_execution_plan(plan: DeterministicExecutionPlan) -> DataRequirement:
    indicators = {item.id: item for item in plan.indicators}
    timeframes: set[str] = set()
    needs_previous: set[str] = set()
    nodes = 0

    def visit(node: Any, depth: int = 1, *, cross_operand: bool = False) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > 200 or depth > 8:
            raise RuleSemanticError("条件树最多 200 个节点且深度最多 8 层")
        if not isinstance(node, dict) or len(node) != 1:
            raise RuleSemanticError("JSONLogic 节点必须只包含一个操作符")
        operator, args = next(iter(node.items()))
        if operator == "var":
            if not isinstance(args, str):
                raise RuleSemanticError("var 必须引用字符串快照路径")
            timeframe, _ = _resolve_var(args, indicators, require_series=cross_operand)
            timeframes.add(timeframe)
            if cross_operand:
                needs_previous.add(timeframe)
            return
        if operator in {"and", "or"}:
            if not isinstance(args, list):
                raise RuleSemanticError(f"{operator} 参数必须是数组")
            for child in args:
                visit(child, depth + 1)
            return
        if operator == "!":
            visit(args[0], depth + 1)
            return
        if operator in {"cross_above", "cross_below"}:
            left_path = args[0].get("var") if isinstance(args[0], dict) else None
            right_path = args[1].get("var") if isinstance(args[1], dict) else None
            if isinstance(left_path, str) and isinstance(right_path, str):
                left_timeframe, _ = _resolve_var(left_path, indicators, require_series=True)
                right_timeframe, _ = _resolve_var(right_path, indicators, require_series=True)
                if left_timeframe != right_timeframe:
                    raise RuleSemanticError("cross_above/cross_below 只支持同周期序列")
            visit(args[0], depth + 1, cross_operand=True)
            if isinstance(args[1], dict):
                visit(args[1], depth + 1, cross_operand=True)
            elif not isinstance(args[1], (int, float)) or isinstance(args[1], bool):
                raise RuleSemanticError(f"{operator} 右侧必须是序列或数字常量")
            return
        if operator in {"==", "===", "!=", "!==", "<", "<=", ">", ">=", "in"}:
            for child in args:
                if isinstance(child, dict):
                    visit(child, depth + 1)
            return
        raise RuleSemanticError(f"不支持的 JSONLogic 操作符: {operator}")

    for rule in plan.rules:
        visit(rule.condition)

    lookback = {timeframe: 120 + (1 if timeframe in needs_previous else 0) for timeframe in timeframes}
    return DataRequirement(
        timeframes=tuple(value for value in ("daily", "weekly", "monthly") if value in timeframes),
        lookback_bars=lookback,
    )

"""规则语义校验和数据依赖推导。"""

from __future__ import annotations

from dataclasses import dataclass

from app.definitive_scheduled_tasks.schemas import (
    AllCondition,
    AnyCondition,
    AtomicCondition,
    Condition,
    DeterministicExecutionPlan,
    NotCondition,
)


BUILTIN_METRICS = {
    "open", "high", "low", "close", "volume", "amount", "candle.direction"
}
INDICATOR_OUTPUTS = {
    "macd": {"dif", "dea", "histogram"},
    "kdj": {"k", "d", "j"},
}


@dataclass(frozen=True)
class DataRequirement:
    timeframes: tuple[str, ...]
    lookback_bars: dict[str, int]


class RuleSemanticError(ValueError):
    """JSON 格式正确但业务语义不合法。"""


def parse_execution_plan(plan: DeterministicExecutionPlan) -> DataRequirement:
    indicators = {item.id: item for item in plan.indicators}
    timeframes: set[str] = set()
    needs_previous: set[str] = set()
    nodes = 0

    def visit(condition: Condition, depth: int = 1) -> None:
        nonlocal nodes
        nodes += 1
        if nodes > 200 or depth > 8:
            raise RuleSemanticError("条件树最多 200 个节点且深度最多 8 层")
        if isinstance(condition, AtomicCondition):
            timeframes.add(condition.timeframe)
            if condition.operator.startswith("cross_"):
                needs_previous.add(condition.timeframe)
            if condition.metric in BUILTIN_METRICS:
                return
            parts = condition.metric.split(".")
            if len(parts) != 2 or parts[0] not in indicators:
                raise RuleSemanticError(f"未知指标字段: {condition.metric}")
            indicator = indicators[parts[0]]
            if condition.timeframe not in indicator.timeframes:
                raise RuleSemanticError(
                    f"{condition.metric} 未声明 {condition.timeframe} 周期"
                )
            if parts[1] not in INDICATOR_OUTPUTS[indicator.type]:
                raise RuleSemanticError(f"指标输出不存在: {condition.metric}")
            return
        if isinstance(condition, (AllCondition, AnyCondition)):
            children = condition.all if isinstance(condition, AllCondition) else condition.any
            for child in children:
                visit(child, depth + 1)
            return
        if isinstance(condition, NotCondition):
            visit(condition.not_, depth + 1)
            return
        raise RuleSemanticError("不支持的条件节点")

    for rule in plan.rules:
        visit(rule.condition)

    lookback = {timeframe: 120 + (1 if timeframe in needs_previous else 0) for timeframe in timeframes}
    return DataRequirement(
        timeframes=tuple(value for value in ("daily", "weekly", "monthly") if value in timeframes),
        lookback_bars=lookback,
    )

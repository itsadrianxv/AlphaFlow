"""确定性评分 JSON 与执行接口契约。"""

from __future__ import annotations

from typing import Any, Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


Timeframe = Literal["daily", "weekly", "monthly"]
Scalar = str | float | int | bool

JSONLOGIC_STANDARD_OPERATORS = {
    "var", "==", "===", "!=", "!==", "<", "<=", ">", ">=", "and", "or", "!", "in",
}
JSONLOGIC_TECHNICAL_OPERATORS = {"cross_above", "cross_below"}
JSONLOGIC_OPERATORS = JSONLOGIC_STANDARD_OPERATORS | JSONLOGIC_TECHNICAL_OPERATORS


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StocksUniverse(StrictModel):
    type: Literal["stocks"]
    stockCodes: list[str] = Field(min_length=1, max_length=5000)

    @field_validator("stockCodes")
    @classmethod
    def validate_codes(cls, values: list[str]) -> list[str]:
        normalized = [value.strip() for value in values]
        if any(len(value) != 6 or not value.isdigit() for value in normalized):
            raise ValueError("stockCodes 必须是六位股票代码")
        if len(set(normalized)) != len(normalized):
            raise ValueError("stockCodes 不能重复")
        return normalized


class AllSharesUniverse(StrictModel):
    type: Literal["all_a_shares"]


Universe = Annotated[Union[StocksUniverse, AllSharesUniverse], Field(discriminator="type")]


class DataPlan(StrictModel):
    adjustment: Literal["qfq", "hfq", "none"] = "qfq"


class MacdParams(StrictModel):
    fast: int = Field(default=12, ge=2, le=200)
    slow: int = Field(default=26, ge=3, le=400)
    signal: int = Field(default=9, ge=2, le=200)

    @model_validator(mode="after")
    def validate_periods(self):
        if self.fast >= self.slow:
            raise ValueError("MACD fast 必须小于 slow")
        return self


class KdjParams(StrictModel):
    period: int = Field(default=9, ge=2, le=200)
    kSmoothing: int = Field(default=3, ge=1, le=50)
    dSmoothing: int = Field(default=3, ge=1, le=50)


class MacdIndicator(StrictModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    type: Literal["macd"]
    timeframes: list[Timeframe] = Field(min_length=1, max_length=3)
    params: MacdParams = Field(default_factory=MacdParams)


class KdjIndicator(StrictModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    type: Literal["kdj"]
    timeframes: list[Timeframe] = Field(min_length=1, max_length=3)
    params: KdjParams = Field(default_factory=KdjParams)


Indicator = Annotated[Union[MacdIndicator, KdjIndicator], Field(discriminator="type")]


def validate_jsonlogic(
    value: Any, *, path: str = "condition", depth: int = 1,
    nodes: list[int] | None = None, role: Literal["condition", "value", "series"] = "condition",
) -> Any:
    """Validate the closed JSONLogic subset without executing it."""
    counter = nodes if nodes is not None else [0]
    counter[0] += 1
    if counter[0] > 200 or depth > 8:
        raise ValueError("条件树最多 200 个节点且深度最多 8 层")
    if not isinstance(value, dict) or len(value) != 1:
        raise ValueError(f"{path} 必须是只包含一个操作符的 JSONLogic 对象")
    operator, args = next(iter(value.items()))
    if operator not in JSONLOGIC_OPERATORS:
        raise ValueError(f"{path} 不支持操作符: {operator}")
    if role != "condition" and operator != "var":
        raise ValueError(f"{path} 操作数对象只能使用 var")
    if operator == "var":
        if not isinstance(args, str) or not args or "." not in args:
            raise ValueError(f"{path}.var 必须是快照路径字符串")
        if role == "condition":
            raise ValueError(f"{path}.var 不能直接作为条件")
        if role == "series" and (args.endswith(".current") or args.endswith(".previous")):
            raise ValueError(f"{path}.var 必须引用包含 current/previous 的序列对象")
        if role == "value" and not (args.endswith(".current") or args.endswith(".previous")):
            raise ValueError(f"{path}.var 必须引用 current 或 previous 标量值")
        return value
    if operator in {"and", "or"}:
        if not isinstance(args, list) or not 1 <= len(args) <= 20:
            raise ValueError(f"{path}.{operator} 必须包含 1 至 20 个条件")
        for index, child in enumerate(args):
            validate_jsonlogic(child, path=f"{path}.{operator}.{index}", depth=depth + 1, nodes=counter, role="condition")
        return value
    if operator == "!":
        if not isinstance(args, list) or len(args) != 1:
            raise ValueError(f"{path}.! 必须包含一个条件")
        validate_jsonlogic(args[0], path=f"{path}.!.0", depth=depth + 1, nodes=counter, role="condition")
        return value
    if operator in JSONLOGIC_TECHNICAL_OPERATORS:
        if not isinstance(args, list) or len(args) != 2:
            raise ValueError(f"{path}.{operator} 必须包含两个操作数")
        validate_jsonlogic(args[0], path=f"{path}.{operator}.0", depth=depth + 1, nodes=counter, role="series")
        right = args[1]
        if isinstance(right, (int, float)) and not isinstance(right, bool):
            return value
        validate_jsonlogic(right, path=f"{path}.{operator}.1", depth=depth + 1, nodes=counter, role="series")
        return value
    if operator in {"==", "===", "!=", "!==", "<", "<=", ">", ">=", "in"}:
        if not isinstance(args, list) or len(args) != 2:
            raise ValueError(f"{path}.{operator} 必须包含两个操作数")
        for index, child in enumerate(args):
            if isinstance(child, dict):
                validate_jsonlogic(child, path=f"{path}.{operator}.{index}", depth=depth + 1, nodes=counter, role="value")
            elif isinstance(child, (str, int, float, bool, list)) or child is None:
                continue
            else:
                raise ValueError(f"{path}.{operator}.{index} 不是合法 JSON 值")
        return value
    raise ValueError(f"{path} 不支持操作符: {operator}")


Condition = dict[str, Any]


class ScoringRule(StrictModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    name: str = Field(min_length=1, max_length=120)
    condition: Condition
    scoreDelta: float

    @field_validator("scoreDelta")
    @classmethod
    def validate_score_delta(cls, value: float) -> float:
        if not float("-inf") < value < float("inf"):
            raise ValueError("scoreDelta 必须是有限数值")
        return value

    @field_validator("condition")
    @classmethod
    def validate_condition(cls, value: Condition) -> Condition:
        return validate_jsonlogic(value)


class SelectionPlan(StrictModel):
    minScore: float = 0
    limit: int = Field(default=100, ge=1, le=5000)


class DeterministicExecutionPlan(StrictModel):
    schemaVersion: Literal[2]
    type: Literal["deterministic_scoring"]
    universe: Universe
    data: DataPlan = Field(default_factory=DataPlan)
    indicators: list[Indicator] = Field(default_factory=list, max_length=20)
    rules: list[ScoringRule] = Field(min_length=1, max_length=50)
    selection: SelectionPlan = Field(default_factory=SelectionPlan)

    @model_validator(mode="after")
    def validate_unique_ids(self):
        indicator_ids = [item.id for item in self.indicators]
        rule_ids = [item.id for item in self.rules]
        if len(set(indicator_ids)) != len(indicator_ids):
            raise ValueError("指标 id 不能重复")
        if len(set(rule_ids)) != len(rule_ids):
            raise ValueError("规则 id 不能重复")
        return self


class ExecutionRequest(StrictModel):
    schemaVersion: Literal[2]
    executionId: str = Field(min_length=1, max_length=128)
    taskVersionId: str = Field(min_length=1, max_length=128)
    scheduledAt: str
    timezone: str = Field(default="Asia/Shanghai", min_length=1, max_length=80)
    executionPlan: DeterministicExecutionPlan

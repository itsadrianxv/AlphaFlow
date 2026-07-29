"""确定性评分 JSON 与执行接口契约。"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


Timeframe = Literal["daily", "weekly", "monthly"]
Scalar = str | float | int | bool


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


class AtomicCondition(StrictModel):
    timeframe: Timeframe
    metric: str = Field(pattern=r"^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?$")
    operator: Literal[
        "gt", "gte", "lt", "lte", "eq", "ne", "between", "cross_above", "cross_below"
    ]
    value: Scalar | list[float]

    @model_validator(mode="after")
    def validate_value(self):
        if self.operator == "between":
            if not isinstance(self.value, list) or len(self.value) != 2:
                raise ValueError("between 的 value 必须是两个数字")
            if self.value[0] > self.value[1]:
                raise ValueError("between 下界不能大于上界")
        elif isinstance(self.value, list):
            raise ValueError(f"{self.operator} 的 value 不能是数组")
        return self


class AllCondition(StrictModel):
    all: list["Condition"] = Field(min_length=1, max_length=20)


class AnyCondition(StrictModel):
    any: list["Condition"] = Field(min_length=1, max_length=20)


class NotCondition(StrictModel):
    not_: "Condition" = Field(alias="not")


Condition = Union[AtomicCondition, AllCondition, AnyCondition, NotCondition]


class ScoringRule(StrictModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")
    name: str = Field(min_length=1, max_length=120)
    condition: Condition
    points: float = Field(ge=0)


class SelectionPlan(StrictModel):
    minScore: float = Field(default=0, ge=0)
    limit: int = Field(default=100, ge=1, le=5000)


class DeterministicExecutionPlan(StrictModel):
    schemaVersion: Literal[1]
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
    schemaVersion: Literal[1]
    executionId: str = Field(min_length=1, max_length=128)
    taskVersionId: str = Field(min_length=1, max_length=128)
    scheduledAt: str
    timezone: str = Field(default="Asia/Shanghai", min_length=1, max_length=80)
    executionPlan: DeterministicExecutionPlan


AllCondition.model_rebuild()
AnyCondition.model_rebuild()
NotCondition.model_rebuild()

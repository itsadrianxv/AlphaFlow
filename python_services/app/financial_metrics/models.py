"""财务指标领域模型。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

import pandas as pd

Dataset = Literal["income", "balancesheet", "cashflow"]
QuarterTransform = Literal["cumulative", "point_in_time", "already_single", "reported_cumulative"]
PeriodType = Literal["ANNUAL", "QUARTERLY"]
UseCase = Literal["COMPANY_OVERVIEW", "SCREENING"]


@dataclass(frozen=True)
class MetricDefinition:
    id: str
    name: str
    description: str
    dataset: Dataset
    field: str
    statement_name: str
    subcategory: str
    value_kind: str
    canonical_unit: str
    display_unit: str
    quarter_transform: QuarterTransform
    period_semantics: str
    applicable_company_types: tuple[str, ...]
    keywords: tuple[str, ...]
    default_visible: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id, "name": self.name, "description": self.description,
            "dataset": self.dataset, "field": self.field,
            "statementName": self.statement_name, "subcategory": self.subcategory,
            "valueKind": self.value_kind, "canonicalUnit": self.canonical_unit,
            "displayUnit": self.display_unit, "quarterTransform": self.quarter_transform,
            "periodSemantics": self.period_semantics,
            "applicableCompanyTypes": list(self.applicable_company_types),
            "keywords": list(self.keywords), "defaultVisible": self.default_visible,
        }


@dataclass(frozen=True)
class SeriesQuery:
    stock_codes: tuple[str, ...]
    metric_ids: tuple[str, ...]
    periods: tuple[str, ...]
    period_type: PeriodType
    use_case: UseCase


@dataclass(frozen=True)
class MetricValue:
    stock_code: str
    metric_id: str
    period: str
    end_date: str
    value: float | None
    period_semantics: str


@dataclass(frozen=True)
class MetricWarning:
    code: str
    message: str
    dataset: str | None = None
    period: str | None = None

    def to_dict(self) -> dict[str, str | None]:
        return self.__dict__.copy()


@dataclass(frozen=True)
class QueryStep:
    dataset: Dataset
    strategy: Literal["regular", "vip"]
    stock_codes: tuple[str, ...]
    raw_periods: tuple[str, ...]
    fields: tuple[str, ...]


@dataclass(frozen=True)
class QueryPlan:
    steps: tuple[QueryStep, ...]


@dataclass
class MetricSeriesResult:
    definitions: tuple[MetricDefinition, ...]
    periods: tuple[str, ...]
    frame: pd.DataFrame
    warnings: list[MetricWarning] = field(default_factory=list)
    diagnostics: dict[str, Any] = field(default_factory=dict)

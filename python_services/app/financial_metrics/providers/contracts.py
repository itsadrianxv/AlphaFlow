"""财务报表 provider 协议。"""

from typing import Protocol
import pandas as pd

from app.financial_metrics.models import QueryStep


class FinancialStatementProvider(Protocol):
    provider_name: str
    def execute(self, step: QueryStep) -> tuple[list[pd.DataFrame], list[str]]: ...

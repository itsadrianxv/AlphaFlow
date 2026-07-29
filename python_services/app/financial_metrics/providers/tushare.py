"""TuShare 三大财务报表 adapter。"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pandas as pd

from app.data_providers import get_default_data_provider
from app.financial_metrics.models import QueryStep
from app.gateway.common import build_cache_key, gateway_cache
from app.policies.cache_policy import CachePolicy


_VIP_POLICY = CachePolicy(fresh_ttl_seconds=21_600, stale_ttl_seconds=86_400)
_CONTROL_FIELDS = ("ts_code", "end_date", "ann_date", "f_ann_date", "report_type", "comp_type", "update_flag")


class TushareFinancialStatementProvider:
    provider_name = "tushare"

    def __init__(self, provider: Any | None = None) -> None:
        self._provider = provider or get_default_data_provider()

    def execute(self, step: QueryStep) -> tuple[list[pd.DataFrame], list[str]]:
        return self._execute_regular(step) if step.strategy == "regular" else self._execute_vip(step)

    def _raw(self, dataset: str, **params: str) -> pd.DataFrame:
        loader = getattr(self._provider, "get_raw_frame", None)
        if loader is None:
            raise RuntimeError("当前数据 provider 不支持原始财务报表")
        return loader(dataset, **params)

    def _execute_regular(self, step: QueryStep) -> tuple[list[pd.DataFrame], list[str]]:
        fields = ",".join((*_CONTROL_FIELDS, *step.fields))
        frames, warnings = [], []
        start_date, end_date = min(step.raw_periods), max(step.raw_periods)
        for stock_code in step.stock_codes:
            try:
                profile = self._provider.get_stock_profile(stock_code)
                frames.append(self._raw(step.dataset, ts_code=profile.tsCode, start_date=start_date, end_date=end_date, report_type="1", fields=fields))
            except Exception as exc:  # noqa: BLE001
                warnings.append(f"{step.dataset}/{stock_code}: {exc}")
        return frames, warnings

    def _execute_vip(self, step: QueryStep) -> tuple[list[pd.DataFrame], list[str]]:
        fields = ",".join((*_CONTROL_FIELDS, *step.fields))
        frames, warnings = [], []
        for period in step.raw_periods:
            key = build_cache_key(
                dataset="financial_statement_vip", provider=self.provider_name,
                params={"dataset": step.dataset, "period": period, "fields": sorted(step.fields), "schema": 1},
            )
            cached = gateway_cache.get(key, allow_stale=False)
            if cached is not None:
                frames.append(cached.value.copy())
                continue
            stale = gateway_cache.get(key, allow_stale=True)
            try:
                frame = self._raw(f"{step.dataset}_vip", period=period, report_type="1", fields=fields)
                gateway_cache.set(key, frame.copy(), _VIP_POLICY, datetime.now(UTC).isoformat())
                frames.append(frame)
            except Exception as exc:  # noqa: BLE001
                if stale is not None:
                    frames.append(stale.value.copy())
                    warnings.append(f"{step.dataset}/{period}: 上游失败，使用 stale 缓存: {exc}")
                else:
                    warnings.append(f"{step.dataset}/{period}: {exc}")
        if frames and step.stock_codes:
            allowed = set(step.stock_codes)
            frames = [
                frame[frame.get("ts_code", pd.Series(dtype=str)).astype(str).str.split(".").str[0].isin(allowed)].copy()
                if not frame.empty else frame
                for frame in frames
            ]
        return frames, warnings

"""确定性评分任务编排。"""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Any

import pandas as pd

from app.data_providers import DataProvider, get_default_data_provider
from app.definitive_scheduled_tasks.engine import rank_and_select, score_stock
from app.definitive_scheduled_tasks.indicators import calculate_indicators
from app.definitive_scheduled_tasks.json_parser import parse_execution_plan
from app.definitive_scheduled_tasks.schemas import ExecutionRequest
from app.services.screening_stock_universe_store import ScreeningStockUniverseStore


class DefinitiveExecutionError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


class DefinitiveScoringService:
    def __init__(self, provider: DataProvider | None = None, universe_store: ScreeningStockUniverseStore | None = None) -> None:
        self._provider = provider or get_default_data_provider()
        self._universe_store = universe_store or ScreeningStockUniverseStore()

    def execute(self, request: ExecutionRequest) -> dict[str, Any]:
        requirement = parse_execution_plan(request.executionPlan)
        try:
            cutoff = datetime.fromisoformat(request.scheduledAt.replace("Z", "+00:00")).astimezone(ZoneInfo(request.timezone))
        except (ValueError, KeyError) as exc:
            raise DefinitiveExecutionError("INVALID_SCHEDULED_AT", "scheduledAt 或 timezone 无效", retryable=False) from exc

        records = self._resolve_universe(request)
        codes = [record["stockCode"] for record in records]
        adjustment = request.executionPlan.data.adjustment
        daily_lookback = max(requirement.lookback_bars.get("daily", 0), 40)
        batches: dict[str, dict[str, list[Any]]] = {
            "daily": self._load_batch(codes, "daily", daily_lookback, cutoff, adjustment)
        }
        for timeframe in ("weekly", "monthly"):
            if timeframe in requirement.timeframes:
                batches[timeframe] = self._load_batch(
                    codes,
                    timeframe,
                    requirement.lookback_bars[timeframe],
                    cutoff,
                    adjustment,
                )
        rows: list[dict[str, Any]] = []
        warnings: list[dict[str, Any]] = []
        for record in records:
            frames: dict[str, pd.DataFrame] = {}
            try:
                daily = self._bars_to_frame(batches["daily"].get(record["stockCode"], []), daily_lookback)
                if "daily" in requirement.timeframes:
                    frames["daily"] = calculate_indicators(daily, request.executionPlan.indicators, "daily")
                for timeframe in ("weekly", "monthly"):
                    if timeframe not in requirement.timeframes:
                        continue
                    native = self._bars_to_frame(
                        batches[timeframe].get(record["stockCode"], []),
                        requirement.lookback_bars[timeframe],
                    )
                    merged = self._append_partial(native, daily, timeframe)
                    frames[timeframe] = calculate_indicators(merged, request.executionPlan.indicators, timeframe)
            except Exception as exc:  # 单只股票数据失败必须保留审计行
                warnings.append({"stockCode": record["stockCode"], "code": "BARS_UNAVAILABLE", "message": str(exc)})
            rows.append(score_stock(stock_code=record["stockCode"], stock_name=record["stockName"], frames=frames, plan=request.executionPlan))

        rank_and_select(rows, request.executionPlan)
        rules = [{"id": rule.id, "name": rule.name, "points": rule.points, "condition": rule.condition.model_dump(by_alias=True)} for rule in request.executionPlan.rules]
        return {
            "schemaVersion": 1,
            "executionId": request.executionId,
            "status": "SUCCEEDED",
            "asOfDate": cutoff.date().isoformat(),
            "universeCount": len(records),
            "evaluatedCount": sum(row["evaluationStatus"] != "NONE" for row in rows),
            "selectedCount": sum(row["selected"] for row in rows),
            "rules": rules,
            "results": rows,
            "warnings": warnings,
            "diagnostics": {"timeframes": list(requirement.timeframes), "lookbackBars": requirement.lookback_bars},
        }

    def _resolve_universe(self, request: ExecutionRequest) -> list[dict[str, str]]:
        records = self._universe_store.load_records()
        universe = request.executionPlan.universe
        if universe.type == "all_a_shares":
            return records
        wanted = set(universe.stockCodes)
        selected = [record for record in records if record["stockCode"] in wanted]
        found = {record["stockCode"] for record in selected}
        selected.extend({"stockCode": code, "stockName": code, "market": "", "industry": ""} for code in universe.stockCodes if code not in found)
        return selected

    def _load_batch(
        self,
        stock_codes: list[str],
        timeframe: str,
        bars: int,
        cutoff: datetime,
        adjustment: str,
    ) -> dict[str, list[Any]]:
        calendar_days = bars * {"daily": 2, "weekly": 9, "monthly": 40}[timeframe]
        start = (cutoff.date() - timedelta(days=calendar_days)).isoformat()
        return self._provider.get_bars_many(
            stock_codes,
            timeframe=timeframe.upper(),
            start_date=start,
            end_date=cutoff.date().isoformat(),
            adjust="" if adjustment == "none" else adjustment,
            limit_bars=bars,
        )

    @staticmethod
    def _bars_to_frame(values: list[Any], bars: int) -> pd.DataFrame:
        frame = pd.DataFrame(
            [
                {
                    "trade_date": item.tradeDate,
                    "open": item.open,
                    "high": item.high,
                    "low": item.low,
                    "close": item.close,
                    "volume": item.volume,
                    "amount": item.amount,
                }
                for item in values
            ]
        )
        if frame.empty:
            raise ValueError("未获取到 K 线")
        frame["trade_date"] = pd.to_datetime(frame["trade_date"])
        frame = frame.dropna(subset=["open", "high", "low", "close", "volume"]).sort_values("trade_date")
        return frame.tail(bars).reset_index(drop=True)

    @staticmethod
    def _append_partial(native: pd.DataFrame, daily: pd.DataFrame, timeframe: str) -> pd.DataFrame:
        if native.empty or daily.empty:
            return native
        last = daily.iloc[-1]["trade_date"]
        if timeframe == "weekly":
            mask = daily["trade_date"].dt.to_period("W-FRI") == last.to_period("W-FRI")
            same_period = native["trade_date"].dt.to_period("W-FRI") == last.to_period("W-FRI")
        else:
            mask = daily["trade_date"].dt.to_period("M") == last.to_period("M")
            same_period = native["trade_date"].dt.to_period("M") == last.to_period("M")
        current = daily.loc[mask]
        if current.empty:
            return native
        aggregated = pd.DataFrame([{
            "trade_date": current.iloc[-1]["trade_date"],
            "open": current.iloc[0]["open"], "high": current["high"].max(), "low": current["low"].min(),
            "close": current.iloc[-1]["close"], "volume": current["volume"].sum(), "amount": current["amount"].sum(),
        }])
        return pd.concat([native.loc[~same_period], aggregated], ignore_index=True).sort_values("trade_date").reset_index(drop=True)

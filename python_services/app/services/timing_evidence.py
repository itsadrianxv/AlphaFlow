"""择时 v2 规范化特征与审计清单构建。"""

from __future__ import annotations

from datetime import UTC, datetime
import hashlib
import json
from typing import Any

import pandas as pd

from app.contracts.timing import (
    TimingBar,
    TimingDataManifestItem,
    TimingEvidenceData,
    TimingFeatureEvidence,
    TimingTimeframe,
)

FEATURE_VERSION = "timing-features-v2.0.0"


def _json_value(value: Any) -> Any:
    if value is None:
        return None
    try:
        if bool(pd.isna(value)):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, (pd.Timestamp, datetime)):
        return value.isoformat(sep=" ")
    if hasattr(value, "item"):
        return value.item()
    return value


def _records(frame: pd.DataFrame) -> list[dict[str, Any]]:
    if frame.empty:
        return []
    return [
        {key: _json_value(value) for key, value in row.items()}
        for row in frame.to_dict(orient="records")
    ]


def _hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _date_text(value: Any) -> str:
    parsed = pd.to_datetime(value)
    return parsed.strftime("%Y-%m-%d %H:%M:%S" if parsed.time() != datetime.min.time() else "%Y-%m-%d")


def _number(value: Any) -> float | None:
    parsed = pd.to_numeric(value, errors="coerce")
    return None if pd.isna(parsed) else round(float(parsed), 6)


class TimingEvidenceService:
    def build(
        self,
        *,
        stock_code: str,
        stock_name: str,
        as_of_date: str,
        histories: dict[str, pd.DataFrame],
        special_frames: dict[str, pd.DataFrame],
        special_errors: dict[str, str],
        indicator_ids: list[str],
        benchmark_history: pd.DataFrame | None = None,
        tradable: bool = True,
    ) -> TimingEvidenceData:
        features: list[TimingFeatureEvidence] = []
        bars_by_timeframe: dict[str, list[TimingBar]] = {}
        source_rows: dict[str, list[dict[str, Any]]] = {}
        manifest: list[TimingDataManifestItem] = []
        warnings: list[str] = []
        fetched_at = datetime.now(UTC).isoformat()

        for timeframe, frame in histories.items():
            normalized = self._normalize_history(frame, as_of_date)
            bars_by_timeframe[timeframe] = self._bars(normalized)
            rows = _records(normalized)
            source_rows[f"bars:{timeframe}"] = rows
            observation_only = self._unfinished_higher_timeframe(
                timeframe,
                as_of_date,
                normalized.iloc[-1]["trade_date"] if not normalized.empty else None,
            )
            manifest.append(
                TimingDataManifestItem(
                    dataset="bars",
                    source="tushare",
                    timeframe=timeframe,
                    dataDate=_date_text(normalized.iloc[-1]["trade_date"]) if not normalized.empty else None,
                    fetchedAt=fetched_at,
                    completeness=("OBSERVATION_ONLY" if observation_only else "COMPLETE") if rows else "MISSING",
                    degradationReason="未收盘周线/月线仅作观察" if observation_only else None,
                    contentHash=_hash(rows),
                    rowCount=len(rows),
                )
            )
            formal_frame = normalized.iloc[:-1].reset_index(drop=True) if observation_only else normalized
            features.extend(self._bar_features(timeframe, formal_frame, False))

        for dataset, frame in special_frames.items():
            normalized = self._slice_frame(frame, as_of_date)
            rows = _records(normalized)
            source_rows[dataset] = rows
            latest_date = _date_text(normalized.iloc[-1]["trade_date"]) if rows and "trade_date" in normalized else None
            manifest.append(
                TimingDataManifestItem(
                    dataset=dataset,
                    source=f"tushare:{dataset}",
                    dataDate=latest_date,
                    fetchedAt=fetched_at,
                    completeness="COMPLETE" if rows else "MISSING",
                    degradationReason=special_errors.get(dataset),
                    contentHash=_hash(rows),
                    rowCount=len(rows),
                )
            )
            if dataset == "stk_factor_pro":
                features.extend(self._factor_features(normalized))
            elif dataset == "cyq_perf":
                features.extend(self._chip_features(
                    normalized,
                    histories.get("DAILY"),
                    special_frames.get("stk_factor_pro"),
                ))
            elif dataset == "stk_nineturn":
                features.extend(self._nineturn_features(normalized))
            elif dataset == "stk_auction_o":
                features.extend(self._auction_features(
                    normalized,
                    histories.get("DAILY"),
                    special_frames.get("stk_factor_pro"),
                ))

        for dataset, error in special_errors.items():
            if dataset not in special_frames:
                manifest.append(TimingDataManifestItem(
                    dataset=dataset, source=f"tushare:{dataset}", fetchedAt=fetched_at,
                    completeness="MISSING", degradationReason=error, contentHash=_hash([]), rowCount=0,
                ))
            warnings.append(f"{dataset}: {error}")

        features.extend(self._relative_strength_features(histories.get("DAILY"), benchmark_history))
        daily_date = self._latest_date(histories.get("DAILY"), as_of_date)
        features.append(TimingFeatureEvidence(
            indicatorId="market.tradable", timeframe="DAILY", value=tradable,
            asOfDate=daily_date, source="tushare:daily,stk_limit", status="AVAILABLE",
        ))

        if indicator_ids:
            requested = set(indicator_ids)
            features = [item for item in features if item.indicatorId in requested]
            present = {(item.indicatorId, item.timeframe) for item in features}
            for indicator_id in requested:
                if not any(key[0] == indicator_id for key in present):
                    features.append(TimingFeatureEvidence(
                        indicatorId=indicator_id, timeframe="DAILY", value=None,
                        asOfDate=daily_date, source="timing-evidence-v2", status="MISSING",
                        warnings=["指标目录中没有可用输入"],
                    ))

        frozen = {
            "stockCode": stock_code, "asOfDate": as_of_date,
            "featureVersion": FEATURE_VERSION,
            "features": [item.model_dump(mode="json") for item in features],
            "sourceRows": source_rows,
            "dataManifest": [item.model_dump(mode="json") for item in manifest],
        }
        return TimingEvidenceData(
            stockCode=stock_code, stockName=stock_name, asOfDate=daily_date,
            featureVersion=FEATURE_VERSION, features=features,
            barsByTimeframe=bars_by_timeframe, sourceRows=source_rows,
            dataManifest=manifest, warnings=warnings, inputHash=_hash(frozen),
        )

    def _normalize_history(self, frame: pd.DataFrame, as_of_date: str) -> pd.DataFrame:
        if frame.empty:
            return frame.copy()
        normalized = frame.rename(columns={
            "日期": "trade_date", "开盘": "open", "收盘": "close",
            "最高": "high", "最低": "low", "成交量": "volume",
            "成交额": "amount", "换手率": "turnover_rate",
        }).copy()
        normalized["trade_date"] = pd.to_datetime(normalized["trade_date"])
        target = pd.Timestamp(as_of_date).replace(hour=23, minute=59, second=59)
        normalized = normalized[normalized["trade_date"] <= target].sort_values("trade_date")
        for column in ["open", "high", "low", "close", "volume", "amount", "turnover_rate"]:
            if column in normalized:
                normalized[column] = pd.to_numeric(normalized[column], errors="coerce")
        if "amount" not in normalized:
            normalized["amount"] = normalized["close"] * normalized["volume"]
        if "turnover_rate" not in normalized:
            normalized["turnover_rate"] = pd.NA
        return normalized.reset_index(drop=True)

    def _slice_frame(self, frame: pd.DataFrame, as_of_date: str) -> pd.DataFrame:
        if frame.empty or "trade_date" not in frame:
            return frame.copy()
        normalized = frame.copy()
        normalized["trade_date"] = pd.to_datetime(normalized["trade_date"])
        target = pd.Timestamp(as_of_date).replace(hour=23, minute=59, second=59)
        return normalized[normalized["trade_date"] <= target].sort_values("trade_date").reset_index(drop=True)

    def _bars(self, frame: pd.DataFrame) -> list[TimingBar]:
        return [TimingBar(
            tradeDate=_date_text(row.trade_date), open=float(row.open), high=float(row.high),
            low=float(row.low), close=float(row.close), volume=float(row.volume),
            amount=None if pd.isna(row.amount) else float(row.amount),
            turnoverRate=None if pd.isna(row.turnover_rate) else float(row.turnover_rate),
        ) for row in frame.itertuples(index=False)]

    def _bar_features(self, timeframe: str, frame: pd.DataFrame, observation_only: bool) -> list[TimingFeatureEvidence]:
        if len(frame) < 20:
            return []
        close = frame["close"]
        ema5 = close.ewm(span=5, adjust=False).mean()
        ema20 = close.ewm(span=20, adjust=False).mean()
        ema60 = close.ewm(span=60, adjust=False).mean()
        high20 = frame["high"].rolling(20).max().shift(1)
        volume20 = frame["volume"].rolling(20).mean()
        turnover_median = frame["turnover_rate"].rolling(20).median()
        dif = close.ewm(span=12, adjust=False).mean() - close.ewm(span=26, adjust=False).mean()
        dea = dif.ewm(span=9, adjust=False).mean()
        macd = (dif - dea) * 2
        delta = close.diff()
        rsi = 100 - 100 / (1 + delta.clip(lower=0).ewm(alpha=1/12, adjust=False).mean() / (-delta.clip(upper=0).ewm(alpha=1/12, adjust=False).mean()).replace(0, pd.NA))
        date = _date_text(frame.iloc[-1]["trade_date"])
        status = "OBSERVATION_ONLY" if observation_only else "AVAILABLE"
        pullback_recovered = bool(frame["low"].iloc[-1] <= ema20.iloc[-1] * 1.01 and close.iloc[-1] >= ema20.iloc[-1])
        volume_recovery = bool(
            frame["volume"].iloc[-6:-1].mean() < frame["volume"].iloc[-21:-1].mean()
            and frame["volume"].iloc[-1] > frame["volume"].iloc[-6:-1].mean()
        )
        recovery = (close > ema5) & (close.shift(1) <= ema5.shift(1))
        recovery_indexes = [index for index in frame.index[-6:-1] if bool(recovery.iloc[index])]
        new_low_after_confirmation = bool(
            recovery_indexes and frame["low"].iloc[-1] < frame.loc[recovery_indexes, "low"].min()
        )
        values: list[tuple[str, Any, Any, int | None]] = [
            ("trend.close_above_ema5", close.iloc[-1] > ema5.iloc[-1], close.iloc[-2] > ema5.iloc[-2], self._consecutive(close > ema5)),
            ("trend.close_above_ema20", close.iloc[-1] > ema20.iloc[-1], close.iloc[-2] > ema20.iloc[-2], self._consecutive(close > ema20)),
            ("trend.ema20_above_ema60", ema20.iloc[-1] > ema60.iloc[-1], ema20.iloc[-2] > ema60.iloc[-2], self._consecutive(ema20 > ema60)),
            ("trend.close_below_ema60", close.iloc[-1] < ema60.iloc[-1], close.iloc[-2] < ema60.iloc[-2], self._consecutive(close < ema60)),
            ("breakout.close_above_prior_high_20", close.iloc[-1] > high20.iloc[-1], close.iloc[-2] > high20.iloc[-2], self._consecutive(close > high20)),
            ("liquidity.volume_ratio_20", close.iloc[-1] * 0 + frame["volume"].iloc[-1] / volume20.iloc[-1], None, None),
            ("liquidity.turnover_above_median_20", frame["turnover_rate"].iloc[-1] > turnover_median.iloc[-1], None, None),
            ("momentum.rsi12", rsi.iloc[-1], rsi.iloc[-2], None),
            ("momentum.macd_histogram", macd.iloc[-1], macd.iloc[-2], None),
            ("momentum.macd_histogram_rising", macd.iloc[-1] > macd.iloc[-2], macd.iloc[-2] > macd.iloc[-3], self._consecutive(macd.diff() > 0)),
            ("breakout.failed_within_2", self._failed_breakout(close, high20), None, None),
            ("pullback.recovered_ema20_or_cost50", pullback_recovered, None, 1),
            ("pullback.volume_recovery", volume_recovery, None, 1),
            ("reversal.new_low_after_confirmation", new_low_after_confirmation, None, 1),
        ]
        return [TimingFeatureEvidence(
            indicatorId=key, timeframe=timeframe, value=_json_value(value), previousValue=_json_value(previous),
            consecutiveBars=consecutive, asOfDate=date, source="tushare:bars+timing-evidence-v2", status=status,
            inputValues={"close": _number(close.iloc[-1]), "ema5": _number(ema5.iloc[-1]), "ema20": _number(ema20.iloc[-1]), "ema60": _number(ema60.iloc[-1])},
        ) for key, value, previous, consecutive in values]

    def _factor_features(self, frame: pd.DataFrame) -> list[TimingFeatureEvidence]:
        if frame.empty:
            return []
        row = frame.iloc[-1]
        date = _date_text(row["trade_date"])
        mapping = {
            "trend.adx": "dmi_adx_qfq", "momentum.rsi12": "rsi_qfq_12",
            "momentum.macd_histogram": "macd_qfq", "liquidity.volume_ratio_20": "volume_ratio",
        }
        return [TimingFeatureEvidence(
            indicatorId=indicator, timeframe="DAILY", value=_number(row.get(column)),
            asOfDate=date, source="tushare:stk_factor_pro", status="AVAILABLE" if _number(row.get(column)) is not None else "MISSING",
            rawValue=_number(row.get(column)), normalizedValue=_number(row.get(column)),
        ) for indicator, column in mapping.items()]

    def _chip_features(
        self,
        frame: pd.DataFrame,
        daily: pd.DataFrame | None,
        factor_frame: pd.DataFrame | None,
    ) -> list[TimingFeatureEvidence]:
        if frame.empty or daily is None or daily.empty:
            return []
        row = frame.iloc[-1]
        normalized_daily = self._normalize_history(daily, _date_text(row["trade_date"])[:10])
        price_row = normalized_daily.iloc[-1]
        adjusted_close = _number(price_row["close"])
        factor_row = self._latest_factor_row(factor_frame, row["trade_date"])
        raw_close = _number(factor_row.get("close")) if factor_row is not None else adjusted_close
        qfq_close = _number(factor_row.get("close_qfq")) if factor_row is not None else adjusted_close
        factor = 1.0 if not raw_close else float(qfq_close or adjusted_close or raw_close) / raw_close
        cost50_raw, cost15_raw, weighted_raw = (_number(row.get(key)) for key in ("cost_50pct", "cost_15pct", "weight_avg"))
        cost50 = None if cost50_raw is None else cost50_raw * factor
        cost15 = None if cost15_raw is None else cost15_raw * factor
        weighted = None if weighted_raw is None else weighted_raw * factor
        date = _date_text(row["trade_date"])
        close_value = adjusted_close or 0
        ema20 = normalized_daily["close"].ewm(span=20, adjust=False).mean().iloc[-1]
        ema_recovered = bool(price_row["low"] <= ema20 * 1.01 and close_value >= ema20)
        values = [
            ("chip.close_above_weighted_cost", weighted is not None and close_value >= weighted, weighted_raw, weighted),
            ("chip.close_below_cost15", cost15 is not None and close_value < cost15, cost15_raw, cost15),
            ("chip.oversold_zone", (_number(row.get("winner_rate")) or 100) <= 10 or (cost15 is not None and close_value <= cost15 * 1.03), _number(row.get("winner_rate")), _number(row.get("winner_rate"))),
            ("pullback.recovered_ema20_or_cost50", ema_recovered or (cost50 is not None and close_value >= cost50), cost50_raw, cost50),
        ]
        return [TimingFeatureEvidence(
            indicatorId=indicator, timeframe="DAILY", value=value, asOfDate=date,
            source="tushare:cyq_perf+adj_factor", status="AVAILABLE", rawValue=raw, normalizedValue=normalized,
            inputValues={"rawPrice": raw_close, "adjustedPrice": adjusted_close, "adjustmentRatio": factor},
        ) for indicator, value, raw, normalized in values]

    def _nineturn_features(self, frame: pd.DataFrame) -> list[TimingFeatureEvidence]:
        if frame.empty:
            return []
        row = frame.iloc[-1]
        return [TimingFeatureEvidence(
            indicatorId="reversal.nine_down_count", timeframe="DAILY", value=_number(row.get("down_count")),
            asOfDate=_date_text(row["trade_date"]), source="tushare:stk_nineturn", status="AVAILABLE",
        )]

    def _auction_features(
        self,
        frame: pd.DataFrame,
        daily: pd.DataFrame | None,
        factor_frame: pd.DataFrame | None,
    ) -> list[TimingFeatureEvidence]:
        if frame.empty:
            return []
        row = frame.iloc[-1]
        close_raw, vwap_raw = _number(row.get("close")), _number(row.get("vwap"))
        factor = 1.0
        factor_row = self._latest_factor_row(factor_frame, row["trade_date"])
        if factor_row is not None:
            raw_daily_close = _number(factor_row.get("close"))
            qfq_daily_close = _number(factor_row.get("close_qfq"))
            if raw_daily_close and qfq_daily_close:
                factor = qfq_daily_close / raw_daily_close
        normalized_close = None if close_raw is None else close_raw * factor
        return [TimingFeatureEvidence(
            indicatorId="auction.close_above_vwap", timeframe="DAILY",
            value=close_raw is not None and vwap_raw is not None and close_raw >= vwap_raw,
            asOfDate=_date_text(row["trade_date"]), source="tushare:stk_auction_o", status="AVAILABLE",
            rawValue=close_raw, normalizedValue=normalized_close,
            inputValues={"rawClose": close_raw, "rawVwap": vwap_raw, "normalizedClose": normalized_close, "normalizedVwap": None if vwap_raw is None else vwap_raw * factor},
            warnings=["盘后开盘质量证据，不代表盘前实时竞价"],
        )]

    def _relative_strength_features(self, daily: pd.DataFrame | None, benchmark: pd.DataFrame | None) -> list[TimingFeatureEvidence]:
        if daily is None or benchmark is None or daily.empty or benchmark.empty:
            return []
        stock = self._normalize_history(daily, "2999-12-31")
        base = self._normalize_history(benchmark, "2999-12-31")
        if len(stock) < 21 or len(base) < 21:
            return []
        value = (stock["close"].iloc[-1] / stock["close"].iloc[-21] - 1) - (base["close"].iloc[-1] / base["close"].iloc[-21] - 1)
        return [TimingFeatureEvidence(
            indicatorId="relative_strength.return_20d", timeframe="DAILY", value=round(float(value) * 100, 6),
            asOfDate=_date_text(stock.iloc[-1]["trade_date"]), source="tushare:daily+benchmark", status="AVAILABLE",
        )]

    def _unfinished_higher_timeframe(
        self,
        timeframe: str,
        as_of_date: str,
        latest_date: Any,
    ) -> bool:
        if latest_date is None:
            return False
        date = pd.Timestamp(as_of_date)
        latest = pd.Timestamp(latest_date)
        same_week = latest.to_period("W") == date.to_period("W")
        same_month = latest.to_period("M") == date.to_period("M")
        return (
            timeframe == "WEEKLY" and same_week and date.weekday() < 4
        ) or (
            timeframe == "MONTHLY"
            and same_month
            and date.month == (date + pd.Timedelta(days=1)).month
        )

    def _latest_factor_row(self, frame: pd.DataFrame | None, target_date: Any):
        if frame is None or frame.empty or "trade_date" not in frame:
            return None
        normalized = frame.copy()
        normalized["trade_date"] = pd.to_datetime(normalized["trade_date"])
        eligible = normalized[normalized["trade_date"] <= pd.Timestamp(target_date)].sort_values("trade_date")
        return None if eligible.empty else eligible.iloc[-1]

    def _latest_date(self, frame: pd.DataFrame | None, fallback: str) -> str:
        if frame is None or frame.empty:
            return fallback
        normalized = self._normalize_history(frame, fallback)
        return fallback if normalized.empty else _date_text(normalized.iloc[-1]["trade_date"])

    def _consecutive(self, values: pd.Series) -> int:
        count = 0
        for value in reversed(values.fillna(False).tolist()):
            if not bool(value): break
            count += 1
        return count

    def _failed_breakout(self, close: pd.Series, prior_high: pd.Series) -> bool:
        if len(close) < 3:
            return False
        return any(close.iloc[index] > prior_high.iloc[index] for index in (-3, -2)) and close.iloc[-1] < prior_high.iloc[-1]


timing_evidence_service = TimingEvidenceService()

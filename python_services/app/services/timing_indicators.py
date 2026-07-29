"""Deterministic daily timing indicators and multi-engine signal context builders."""

from __future__ import annotations

import math
from datetime import datetime

import numpy as np
import pandas as pd

from app.contracts.timing import (
    TimingBar,
    TimingBollinger,
    TimingIndicators,
    TimingMacd,
    TimingObv,
    TimingRsi,
    TimingSignalComposite,
    TimingSignalContext,
    TimingSignalData,
    TimingSignalEngineResult,
)
from app.gateway.common import GatewayError


ENGINE_WEIGHTS = {
    "multiTimeframeAlignment": 0.24,
    "relativeStrength": 0.20,
    "volatilityPercentile": 0.14,
    "liquidityStructure": 0.14,
    "breakoutFailure": 0.14,
    "gapVolumeQuality": 0.14,
}


def _finite_float(value: object) -> float | None:
    """将任意数值规范化为可安全序列化的有限浮点数。"""
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if math.isfinite(numeric) else None


class TimingIndicatorsService:
    minimum_lookback_days = 240

    def build_signal(
        self,
        *,
        stock_code: str,
        stock_name: str,
        history: pd.DataFrame,
        benchmark_histories: dict[str, pd.DataFrame] | None = None,
        as_of_date: str | None = None,
        include_bars: bool = False,
        timeframe_histories: dict[str, pd.DataFrame] | None = None,
        timeframe_warnings: dict[str, str] | None = None,
        bar_histories: dict[str, pd.DataFrame] | None = None,
    ) -> TimingSignalData:
        normalized = self.normalize_history(history)
        effective = self.slice_as_of(normalized, as_of_date)

        if len(effective.index) < 120:
            raise GatewayError(
                code="insufficient_history",
                message=f"{stock_code} 可用历史数据不足，无法计算择时上下文",
                status_code=422,
                provider="timing",
            )

        enriched = self.calculate_indicators(effective)
        latest = enriched.iloc[-1]

        indicators = TimingIndicators(
            close=self._round_float(latest["close"]),
            macd=TimingMacd(
                dif=self._round_float(latest["macd_dif"]),
                dea=self._round_float(latest["macd_dea"]),
                histogram=self._round_float(latest["macd_hist"]),
            ),
            rsi=TimingRsi(value=self._round_float(latest["rsi14"])),
            bollinger=TimingBollinger(
                upper=self._round_float(latest["boll_upper"]),
                middle=self._round_float(latest["boll_middle"]),
                lower=self._round_float(latest["boll_lower"]),
                closePosition=self._clamp_close_position(latest["boll_position"]),
            ),
            obv=TimingObv(
                value=self._round_float(latest["obv"]),
                slope=self._round_float(latest["obv_slope"]),
            ),
            ema5=self._round_float(latest["ema5"]),
            ema20=self._round_float(latest["ema20"]),
            ema60=self._round_float(latest["ema60"]),
            ema120=self._round_float(latest["ema120"]),
            atr14=self._round_float(latest["atr14"]),
            volumeRatio20=self._round_float(latest["volume_ratio20"]),
            realizedVol20=self._round_float(latest["realized_vol20"]),
            realizedVol120=self._round_float(latest["realized_vol120"]),
            amount=None
            if pd.isna(latest["amount"])
            else self._round_float(latest["amount"]),
            turnoverRate=None
            if pd.isna(latest["turnover_rate"])
            else self._round_float(latest["turnover_rate"]),
        )

        normalized_timeframes: dict[str, pd.DataFrame] = {"DAILY": enriched}
        for timeframe, frame in (timeframe_histories or {}).items():
            if timeframe == "DAILY":
                continue
            try:
                sliced = self.slice_as_of(self.normalize_history(frame), as_of_date)
                if len(sliced.index) >= 60:
                    normalized_timeframes[timeframe] = self.calculate_indicators(sliced)
            except (GatewayError, KeyError, ValueError):
                continue

        signal_context = self.build_signal_context(
            stock_history=enriched,
            benchmark_histories=benchmark_histories or {},
            as_of_date=as_of_date,
            timeframe_histories=normalized_timeframes,
            timeframe_warnings=timeframe_warnings or {},
        )

        bars_by_timeframe = None
        if include_bars:
            bars_by_timeframe = {
                timeframe: self.build_bars(frame)
                for timeframe, frame in (bar_histories or normalized_timeframes).items()
            }

        return TimingSignalData(
            stockCode=stock_code,
            stockName=stock_name,
            asOfDate=latest["trade_date"].strftime("%Y-%m-%d"),
            barsCount=len(effective.index),
            bars=self.build_bars(effective) if include_bars else None,
            barsByTimeframe=bars_by_timeframe,
            indicators=indicators,
            signalContext=signal_context,
        )

    def build_bars(self, history: pd.DataFrame) -> list[TimingBar]:
        bars: list[TimingBar] = []
        for row in history.itertuples(index=False):
            required_values = {
                "open": _finite_float(row.open),
                "high": _finite_float(row.high),
                "low": _finite_float(row.low),
                "close": _finite_float(row.close),
                "volume": _finite_float(row.volume),
            }
            if any(value is None for value in required_values.values()):
                continue

            bars.append(
                TimingBar(
                    tradeDate=(
                        row.trade_date.strftime("%Y-%m-%d %H:%M:%S")
                        if isinstance(row.trade_date, (datetime, pd.Timestamp))
                        else row.trade_date.strftime("%Y-%m-%d")
                    ),
                    open=round(required_values["open"], 4),
                    high=round(required_values["high"], 4),
                    low=round(required_values["low"], 4),
                    close=round(required_values["close"], 4),
                    volume=round(required_values["volume"], 4),
                    amount=self._optional_bar_value(row.amount),
                    turnoverRate=self._optional_bar_value(row.turnover_rate),
                ),
            )
        return bars

    def normalize_history(self, history: pd.DataFrame) -> pd.DataFrame:
        if history.empty:
            raise GatewayError(
                code="bars_not_found",
                message="未获取到可用日线数据",
                status_code=404,
                provider="timing",
            )

        renamed = history.rename(
            columns={
                "日期": "trade_date",
                "开盘": "open",
                "收盘": "close",
                "最高": "high",
                "最低": "low",
                "成交量": "volume",
                "成交额": "amount",
                "换手率": "turnover_rate",
            },
        )

        missing = [
            column
            for column in ["trade_date", "open", "high", "low", "close", "volume"]
            if column not in renamed.columns
        ]
        if missing:
            raise GatewayError(
                code="bars_schema_invalid",
                message=f"日线数据缺少必要字段: {', '.join(missing)}",
                status_code=502,
                provider="timing",
            )

        frame = renamed.copy()
        parsed_dates = pd.to_datetime(frame["trade_date"])
        has_intraday_time = bool(
            (
                (parsed_dates.dt.hour != 0)
                | (parsed_dates.dt.minute != 0)
                | (parsed_dates.dt.second != 0)
            ).any()
        )
        frame["trade_date"] = parsed_dates if has_intraday_time else parsed_dates.dt.date
        for column in [
            "open",
            "high",
            "low",
            "close",
            "volume",
            "amount",
            "turnover_rate",
        ]:
            if column in frame.columns:
                frame[column] = pd.to_numeric(frame[column], errors="coerce")

        if "amount" not in frame.columns:
            frame["amount"] = frame["close"] * frame["volume"]
        if "turnover_rate" not in frame.columns:
            frame["turnover_rate"] = np.nan

        numeric_columns = [
            "open",
            "high",
            "low",
            "close",
            "volume",
            "amount",
            "turnover_rate",
        ]
        frame[numeric_columns] = frame[numeric_columns].replace(
            [np.inf, -np.inf],
            np.nan,
        )
        frame = frame.dropna(subset=["trade_date", "open", "high", "low", "close", "volume"])
        frame = frame.sort_values("trade_date").reset_index(drop=True)

        if frame.empty:
            raise GatewayError(
                code="bars_not_found",
                message="未获取到可用日线数据",
                status_code=404,
                provider="timing",
            )

        return frame

    def slice_as_of(
        self,
        history: pd.DataFrame,
        as_of_date: str | None,
    ) -> pd.DataFrame:
        if as_of_date is None:
            return history

        try:
            target_date = datetime.strptime(as_of_date, "%Y-%m-%d").date()
        except ValueError as exc:
            raise GatewayError(
                code="invalid_as_of_date",
                message=f"无效的 asOfDate: {as_of_date}",
                status_code=400,
                provider="gateway",
            ) from exc

        comparison_target = (
            pd.Timestamp(target_date).replace(hour=23, minute=59, second=59)
            if pd.api.types.is_datetime64_any_dtype(history["trade_date"])
            else target_date
        )
        filtered = history[history["trade_date"] <= comparison_target].reset_index(drop=True)
        if filtered.empty:
            raise GatewayError(
                code="bars_not_found",
                message=f"{as_of_date} 之前没有可用行情数据",
                status_code=404,
                provider="timing",
            )

        return filtered

    def calculate_indicators(self, history: pd.DataFrame) -> pd.DataFrame:
        frame = history.copy()
        close = frame["close"]
        high = frame["high"]
        low = frame["low"]
        volume = frame["volume"]

        frame["ema5"] = close.ewm(span=5, adjust=False).mean()
        frame["ema20"] = close.ewm(span=20, adjust=False).mean()
        frame["ema60"] = close.ewm(span=60, adjust=False).mean()
        frame["ema120"] = close.ewm(span=120, adjust=False).mean()

        ema12 = close.ewm(span=12, adjust=False).mean()
        ema26 = close.ewm(span=26, adjust=False).mean()
        frame["macd_dif"] = ema12 - ema26
        frame["macd_dea"] = frame["macd_dif"].ewm(span=9, adjust=False).mean()
        frame["macd_hist"] = (frame["macd_dif"] - frame["macd_dea"]) * 2

        delta = close.diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        average_gain = gain.ewm(alpha=1 / 14, adjust=False).mean()
        average_loss = loss.ewm(alpha=1 / 14, adjust=False).mean()
        rs = average_gain / average_loss.replace(0, float("nan"))
        frame["rsi14"] = (100 - (100 / (1 + rs))).astype(float).fillna(50)

        frame["boll_middle"] = close.rolling(window=20, min_periods=20).mean()
        boll_std = close.rolling(window=20, min_periods=20).std(ddof=0)
        frame["boll_upper"] = frame["boll_middle"] + (boll_std * 2)
        frame["boll_lower"] = frame["boll_middle"] - (boll_std * 2)
        spread = (frame["boll_upper"] - frame["boll_lower"]).replace(0, pd.NA)
        frame["boll_position"] = ((close - frame["boll_lower"]) / spread).fillna(0.5)

        direction = close.diff().fillna(0)
        signed_volume = volume.where(direction >= 0, -volume)
        frame["obv"] = signed_volume.cumsum()
        frame["obv_slope"] = frame["obv"].diff(periods=5).fillna(0)

        previous_close = close.shift(1)
        true_range = pd.concat(
            [
                high - low,
                (high - previous_close).abs(),
                (low - previous_close).abs(),
            ],
            axis=1,
        ).max(axis=1)
        frame["atr14"] = true_range.rolling(window=14, min_periods=14).mean()

        average_volume20 = volume.rolling(window=20, min_periods=20).mean()
        frame["volume_ratio20"] = (volume / average_volume20).fillna(1)

        returns = close.pct_change()
        frame["return_1d"] = returns.fillna(0)
        frame["return_5d"] = close.pct_change(5).fillna(0)
        frame["return_10d"] = close.pct_change(10).fillna(0)
        frame["return_20d"] = close.pct_change(20).fillna(0)
        frame["return_60d"] = close.pct_change(60).fillna(0)
        frame["realized_vol20"] = returns.rolling(window=20, min_periods=20).std() * math.sqrt(252)
        frame["realized_vol120"] = returns.rolling(window=120, min_periods=120).std() * math.sqrt(252)

        return frame.ffill().bfill()

    def build_signal_context(
        self,
        *,
        stock_history: pd.DataFrame,
        benchmark_histories: dict[str, pd.DataFrame],
        as_of_date: str | None,
        timeframe_histories: dict[str, pd.DataFrame] | None = None,
        timeframe_warnings: dict[str, str] | None = None,
    ) -> TimingSignalContext:
        normalized_benchmarks: dict[str, pd.DataFrame] = {}
        for code, frame in benchmark_histories.items():
            normalized = self.normalize_history(frame)
            sliced = self.slice_as_of(normalized, as_of_date)
            if len(sliced.index) >= 120:
                normalized_benchmarks[code] = self.calculate_indicators(sliced)

        engines = [
            self._build_multi_timeframe_alignment(
                stock_history,
                timeframe_histories=timeframe_histories or {"DAILY": stock_history},
                timeframe_warnings=timeframe_warnings or {},
            ),
            self._build_relative_strength(stock_history, normalized_benchmarks),
            self._build_volatility_percentile(stock_history),
            self._build_liquidity_structure(stock_history),
            self._build_breakout_failure(stock_history),
            self._build_gap_volume_quality(stock_history),
        ]

        weighted_sum = 0.0
        total_confidence = 0.0
        for engine in engines:
            weight_conf = engine.weight * engine.confidence
            weighted_sum += engine.score * weight_conf
            total_confidence += weight_conf

        composite_score = 0.0 if total_confidence <= 0 else weighted_sum / total_confidence
        composite_score = self._clamp(composite_score, -100, 100)
        composite_confidence = self._clamp(
            sum(engine.weight * engine.confidence for engine in engines),
            0,
            1,
        )
        direction = self._direction_from_score(composite_score)

        return TimingSignalContext(
            engines=engines,
            composite=TimingSignalComposite(
                score=self._round_float(composite_score),
                confidence=self._round_probability(composite_confidence),
                direction=direction,
                signalStrength=self._round_float(abs(composite_score)),
                participatingEngines=len([engine for engine in engines if engine.confidence > 0]),
            ),
        )

    def _build_multi_timeframe_alignment(
        self,
        history: pd.DataFrame,
        *,
        timeframe_histories: dict[str, pd.DataFrame],
        timeframe_warnings: dict[str, str],
    ) -> TimingSignalEngineResult:
        timeframe_weights = {"DAILY": 0.5, "WEEKLY": 0.3, "MONTHLY": 0.2}
        scores: dict[str, float] = {}
        directions: dict[str, str] = {}
        metrics: dict[str, float | str | bool | None] = {}
        warnings: list[str] = []
        weighted_score = 0.0
        available_weight = 0.0

        for timeframe, frame in timeframe_histories.items():
            if len(frame.index) < 60:
                warnings.append(f"{timeframe} 历史数据不足，未参与多周期评分。")
                continue
            latest = frame.iloc[-1]
            previous = frame.iloc[-6] if len(frame.index) >= 6 else frame.iloc[0]
            bullish_checks = [
                latest["close"] > latest["ema5"],
                latest["ema5"] > latest["ema20"],
                latest["ema20"] > latest["ema60"],
                latest["ema60"] > latest["ema120"],
                latest["ema20"] > previous["ema20"],
                latest["ema60"] > previous["ema60"],
                latest["return_20d"] > 0,
            ]
            bearish_checks = [
                latest["close"] < latest["ema5"],
                latest["ema5"] < latest["ema20"],
                latest["ema20"] < latest["ema60"],
                latest["ema60"] < latest["ema120"],
                latest["ema20"] < previous["ema20"],
                latest["ema60"] < previous["ema60"],
                latest["return_20d"] < 0,
            ]
            balance = sum(1 for value in bullish_checks if value) - sum(
                1 for value in bearish_checks if value
            )
            timeframe_score = self._clamp(
                (balance / len(bullish_checks)) * 100,
                -100,
                100,
            )
            scores[timeframe] = timeframe_score
            directions[timeframe] = self._direction_from_score(timeframe_score)
            weight = timeframe_weights.get(timeframe, 0.0)
            weighted_score += timeframe_score * weight
            available_weight += weight
            metrics[f"{timeframe.lower()}Score"] = self._round_float(timeframe_score)
            metrics[f"{timeframe.lower()}Close"] = self._round_float(latest["close"])
            metrics[f"{timeframe.lower()}Direction"] = directions[timeframe]

        if timeframe_warnings:
            warnings.extend(
                f"{timeframe} 数据不可用：{message}"
                for timeframe, message in timeframe_warnings.items()
            )

        daily = timeframe_histories.get("DAILY", history).iloc[-1]
        score = self._clamp(
            weighted_score / max(available_weight, 0.0001),
            -100,
            100,
        )
        confidence = self._clamp(
            (abs(score) / 100) * min(1.0, available_weight / 0.5),
            0.35,
            1,
        )
        direction = self._direction_from_score(score)

        return TimingSignalEngineResult(
            key="multiTimeframeAlignment",
            label="多周期一致性",
            direction=direction,
            score=self._round_float(score),
            confidence=self._round_probability(confidence),
            weight=ENGINE_WEIGHTS["multiTimeframeAlignment"],
            detail="按日线、周线、月线的 5/20/60/120 根均线结构和中期收益率计算一致性。",
            metrics={
                **metrics,
                "close": self._round_float(daily["close"]),
                "ema5": self._round_float(daily["ema5"]),
                "ema20": self._round_float(daily["ema20"]),
                "ema60": self._round_float(daily["ema60"]),
                "ema120": self._round_float(daily["ema120"]),
                "availableTimeframes": len(scores),
                "dailyWeight": 0.5 if "DAILY" in scores else 0.0,
                "weeklyWeight": 0.3 if "WEEKLY" in scores else 0.0,
                "monthlyWeight": 0.2 if "MONTHLY" in scores else 0.0,
            },
            warnings=warnings,
        )

    def _build_relative_strength(
        self,
        stock_history: pd.DataFrame,
        benchmark_histories: dict[str, pd.DataFrame],
    ) -> TimingSignalEngineResult:
        latest = stock_history.iloc[-1]
        benchmark_returns20: list[float] = []
        benchmark_returns60: list[float] = []
        for frame in benchmark_histories.values():
            benchmark_latest = frame.iloc[-1]
            benchmark_returns20.append(float(benchmark_latest["return_20d"]))
            benchmark_returns60.append(float(benchmark_latest["return_60d"]))

        if not benchmark_returns20 or not benchmark_returns60:
            return TimingSignalEngineResult(
                key="relativeStrength",
                label="相对强弱",
                direction="neutral",
                score=0,
                confidence=0.35,
                weight=ENGINE_WEIGHTS["relativeStrength"],
                detail="缺少可用基准序列，相对强弱回退为中性。",
                metrics={},
                warnings=["WEAK_RELATIVE_STRENGTH"],
            )

        excess20 = float(latest["return_20d"]) - (sum(benchmark_returns20) / len(benchmark_returns20))
        excess60 = float(latest["return_60d"]) - (sum(benchmark_returns60) / len(benchmark_returns60))
        score = self._clamp((excess20 * 700) + (excess60 * 500), -100, 100)
        alignment_bonus = 0.2 if (excess20 >= 0 and excess60 >= 0) or (excess20 <= 0 and excess60 <= 0) else 0
        confidence = self._clamp(
            min(1, abs(excess20) * 6 + abs(excess60) * 3 + alignment_bonus),
            0.35,
            1,
        )
        direction = self._direction_from_score(score)
        warnings = ["WEAK_RELATIVE_STRENGTH"] if score <= -20 else []

        return TimingSignalEngineResult(
            key="relativeStrength",
            label="相对强弱",
            direction=direction,
            score=self._round_float(score),
            confidence=self._round_probability(confidence),
            weight=ENGINE_WEIGHTS["relativeStrength"],
            detail="比较个股相对沪深核心指数代理的 20/60 日超额收益。",
            metrics={
                "stockReturn20d": self._round_float(latest["return_20d"] * 100),
                "stockReturn60d": self._round_float(latest["return_60d"] * 100),
                "excess20d": self._round_float(excess20 * 100),
                "excess60d": self._round_float(excess60 * 100),
            },
            warnings=warnings,
        )

    def _build_volatility_percentile(
        self,
        history: pd.DataFrame,
    ) -> TimingSignalEngineResult:
        latest = history.iloc[-1]
        vol_window = history.tail(120)
        atr_ratio_series = (vol_window["atr14"] / vol_window["close"].replace(0, np.nan)).replace(np.nan, 0)
        atr_ratio = float(latest["atr14"] / max(latest["close"], 0.0001))
        vol_pct = self._percentile_rank(vol_window["realized_vol20"], latest["realized_vol20"])
        atr_pct = self._percentile_rank(atr_ratio_series, atr_ratio)

        score = 0.0
        if vol_pct >= 80 or atr_pct >= 80:
            score -= 60
        elif vol_pct <= 30 and latest["close"] >= latest["ema20"]:
            score += 35
        elif vol_pct <= 30:
            score += 10

        if latest["close"] < latest["ema20"]:
            score -= 15
        if latest["close"] > latest["ema20"] and atr_pct <= 50:
            score += 10

        score = self._clamp(score, -100, 100)
        confidence = self._clamp((abs(score) / 100) + 0.3, 0.35, 1)
        direction = self._direction_from_score(score)
        warnings = ["HIGH_VOLATILITY"] if score <= -20 else []

        return TimingSignalEngineResult(
            key="volatilityPercentile",
            label="波动率分位",
            direction=direction,
            score=self._round_float(score),
            confidence=self._round_probability(confidence),
            weight=ENGINE_WEIGHTS["volatilityPercentile"],
            detail="使用 ATR 比例与 20 日实现波动率在 120 日窗口中的分位判断波动环境。",
            metrics={
                "atrRatio": self._round_float(atr_ratio * 100),
                "atrPercentile": self._round_float(atr_pct),
                "realizedVol20": self._round_float(latest["realized_vol20"] * 100),
                "volatilityPercentile": self._round_float(vol_pct),
            },
            warnings=warnings,
        )

    def _build_liquidity_structure(
        self,
        history: pd.DataFrame,
    ) -> TimingSignalEngineResult:
        latest = history.iloc[-1]
        amount_series = history.tail(120)["amount"].fillna(history.tail(120)["close"] * history.tail(120)["volume"])
        turnover_series = history.tail(120)["turnover_rate"].dropna()
        volume_ratio_window = history.tail(20)["volume_ratio20"]

        amount_percentile = self._percentile_rank(amount_series, latest["amount"])
        turnover_percentile = self._percentile_rank(
            turnover_series if not turnover_series.empty else pd.Series([50.0]),
            latest["turnover_rate"] if not pd.isna(latest["turnover_rate"]) else 50,
        )

        score = 0.0
        volume_ratio = float(latest["volume_ratio20"])
        if volume_ratio >= 1.1:
            score += 25
        elif volume_ratio <= 0.85:
            score -= 20

        if amount_percentile >= 55:
            score += 20
        elif amount_percentile <= 25:
            score -= 12

        turnover_rate = None if pd.isna(latest["turnover_rate"]) else float(latest["turnover_rate"])
        if turnover_rate is not None:
            if 0.8 <= turnover_rate <= 6:
                score += 18
            elif turnover_rate < 0.4:
                score -= 15
            elif turnover_rate > 12:
                score -= 12

        if volume_ratio_window.std() <= 0.35 and volume_ratio >= 0.95:
            score += 12

        score = self._clamp(score, -100, 100)
        confidence = self._clamp((abs(score) / 100) + 0.35, 0.35, 1)
        direction = self._direction_from_score(score)
        warnings = ["THIN_LIQUIDITY"] if score <= -20 else []

        return TimingSignalEngineResult(
            key="liquidityStructure",
            label="流动性/换手结构",
            direction=direction,
            score=self._round_float(score),
            confidence=self._round_probability(confidence),
            weight=ENGINE_WEIGHTS["liquidityStructure"],
            detail="衡量量比、成交额分位与换手结构，识别是否有足够承接与放量质量。",
            metrics={
                "volumeRatio20": self._round_float(volume_ratio),
                "amountPercentile": self._round_float(amount_percentile),
                "turnoverRate": None if turnover_rate is None else self._round_float(turnover_rate),
                "turnoverPercentile": self._round_float(turnover_percentile),
            },
            warnings=warnings,
        )

    def _build_breakout_failure(
        self,
        history: pd.DataFrame,
    ) -> TimingSignalEngineResult:
        close = history["close"].reset_index(drop=True)
        failures: list[int] = []
        for lookback in (60, 120):
            for idx in range(lookback, len(close) - 5):
                previous_high = float(close.iloc[idx - lookback : idx].max())
                current_close = float(close.iloc[idx])
                if current_close < previous_high * 1.005:
                    continue

                future_window = close.iloc[idx + 1 : idx + 6]
                failed = int(float(future_window.min()) < previous_high)
                failures.append(failed)

        fail_rate = 0.5 if not failures else sum(failures) / len(failures)
        latest_close = float(close.iloc[-1])
        rolling_high60 = float(close.tail(60).max())
        distance_to_high = ((latest_close / max(rolling_high60, 0.0001)) - 1) * 100

        score = (0.5 - fail_rate) * 120
        if latest_close >= rolling_high60 * 0.98:
            score += 15
        if latest_close < history.iloc[-1]["ema20"]:
            score -= 10

        score = self._clamp(score, -100, 100)
        confidence = self._clamp((abs(0.5 - fail_rate) * 1.2) + 0.35, 0.35, 1)
        direction = self._direction_from_score(score)
        warnings = ["FAILED_BREAKOUT"] if fail_rate >= 0.55 else []

        return TimingSignalEngineResult(
            key="breakoutFailure",
            label="突破失败率",
            direction=direction,
            score=self._round_float(score),
            confidence=self._round_probability(confidence),
            weight=ENGINE_WEIGHTS["breakoutFailure"],
            detail="统计近 60/120 日突破后 5 日内跌回前高下方的失败概率。",
            metrics={
                "failureRate": self._round_float(fail_rate * 100),
                "sampleSize": len(failures),
                "distanceTo60dHighPct": self._round_float(distance_to_high),
            },
            warnings=warnings,
        )

    def _build_gap_volume_quality(
        self,
        history: pd.DataFrame,
    ) -> TimingSignalEngineResult:
        lows = history["low"].reset_index(drop=True)
        highs = history["high"].reset_index(drop=True)
        previous_high = highs.shift(1)
        previous_low = lows.shift(1)
        volume_ratio = history["volume_ratio20"].reset_index(drop=True)

        gap_events: list[dict[str, float | bool]] = []
        for idx in range(1, len(history.index) - 5):
            gap_up = float(lows.iloc[idx]) > float(previous_high.iloc[idx]) * 1.005
            gap_down = float(highs.iloc[idx]) < float(previous_low.iloc[idx]) * 0.995
            if not gap_up and not gap_down:
                continue

            future = history.iloc[idx + 1 : idx + 6]
            filled = (
                float(future["low"].min()) <= float(previous_high.iloc[idx])
                if gap_up
                else float(future["high"].max()) >= float(previous_low.iloc[idx])
            )
            gap_events.append(
                {
                    "gap_up": gap_up,
                    "filled": filled,
                    "volume_ratio": float(volume_ratio.iloc[idx]),
                },
            )

        recent_events = gap_events[-3:]
        score = 0.0
        for event in recent_events:
            if event["gap_up"] and not event["filled"] and event["volume_ratio"] >= 1.15:
                score += 30
            elif event["gap_up"] and event["filled"]:
                score -= 20
            elif (not event["gap_up"]) and not event["filled"]:
                score -= 28
            else:
                score += 5

        confidence = 0.35 if not recent_events else self._clamp(0.35 + (abs(score) / 100), 0.35, 1)
        score = self._clamp(score, -100, 100)
        direction = self._direction_from_score(score)
        warnings = ["FAILED_BREAKOUT"] if score <= -20 else []

        return TimingSignalEngineResult(
            key="gapVolumeQuality",
            label="缺口与放量质量",
            direction=direction,
            score=self._round_float(score),
            confidence=self._round_probability(confidence),
            weight=ENGINE_WEIGHTS["gapVolumeQuality"],
            detail="跟踪近期跳空后的回补与放量质量，识别有效缺口还是情绪脉冲。",
            metrics={
                "recentGapCount": len(recent_events),
                "latestVolumeRatio20": self._round_float(volume_ratio.iloc[-1]),
            },
            warnings=warnings,
        )

    def _percentile_rank(self, series: pd.Series, value: float) -> float:
        cleaned = pd.to_numeric(series, errors="coerce").dropna()
        if cleaned.empty:
            return 50.0

        rank = float((cleaned <= value).sum()) / float(len(cleaned))
        return self._round_float(rank * 100)

    def _direction_from_score(self, score: float) -> str:
        if score > 20:
            return "bullish"
        if score < -20:
            return "bearish"
        return "neutral"

    def _clamp_close_position(self, value: float) -> float:
        return round(max(0.0, min(1.0, float(value))), 4)

    def _clamp(self, value: float, min_value: float, max_value: float) -> float:
        return max(min_value, min(max_value, float(value)))

    def _round_float(self, value: float) -> float:
        numeric = _finite_float(value)
        if numeric is None:
            return 0.0
        return round(numeric, 4)

    def _optional_bar_value(self, value: object) -> float | None:
        numeric = _finite_float(value)
        return None if numeric is None else round(numeric, 4)

    def _round_probability(self, value: float) -> float:
        return round(self._clamp(value, 0.0, 1.0), 4)


timing_indicators_service = TimingIndicatorsService()

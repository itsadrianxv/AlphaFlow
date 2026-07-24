from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
import importlib
import os
from pathlib import Path
import sys
from typing import Any

import pandas as pd

from kronos_service.contracts import KronosBar, KronosTimeframe

MIN_LOOKBACK_DAYS = 120


class KronosForecastError(Exception):
    def __init__(self, *, code: str, message: str, stock_code: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.stock_code = stock_code


def _read_int_env(name: str, fallback: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return fallback
    try:
        parsed = int(raw)
    except ValueError:
        return fallback
    return parsed if parsed > 0 else fallback


@dataclass(frozen=True)
class KronosSettings:
    model_name: str = os.getenv("KRONOS_MODEL_NAME", "NeoQuasar/Kronos-base")
    tokenizer_name: str = os.getenv(
        "KRONOS_TOKENIZER_NAME",
        "NeoQuasar/Kronos-Tokenizer-base",
    )
    device: str = os.getenv("KRONOS_DEVICE", "auto")
    max_context: int = _read_int_env("KRONOS_MAX_CONTEXT", 512)
    default_prediction_length: int = _read_int_env(
        "KRONOS_DEFAULT_PREDICTION_LENGTH",
        60,
    )
    kronos_repo_path: str | None = os.getenv("KRONOS_REPO_PATH")


def resolve_device(device: str) -> str:
    if device != "auto":
        return device

    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:  # noqa: BLE001
        return "cpu"


def normalize_bars(
    bars: list[KronosBar],
    max_context: int,
    timeframe: KronosTimeframe = "DAILY",
) -> list[KronosBar]:
    if len(bars) < MIN_LOOKBACK_DAYS:
        raise KronosForecastError(
            code="insufficient_history",
            message=f"Kronos forecast requires at least {MIN_LOOKBACK_DAYS} {timeframe.lower()} bars",
        )
    return bars[-max_context:]


def future_business_dates(as_of_date: str, prediction_length: int) -> list[str]:
    # 首版使用自然工作日近似未来交易日；后续可替换为交易所交易日历。
    current = date.fromisoformat(as_of_date)
    result: list[str] = []
    while len(result) < prediction_length:
        current += timedelta(days=1)
        if current.weekday() < 5:
            result.append(current.isoformat())
    return result


def future_period_dates(
    as_of_date: str,
    prediction_length: int,
    timeframe: KronosTimeframe,
) -> list[str]:
    if timeframe == "DAILY":
        return future_business_dates(as_of_date, prediction_length)

    if timeframe.startswith("MINUTE_"):
        interval_minutes = {
            "MINUTE_60": 60,
            "MINUTE_30": 30,
            "MINUTE_15": 15,
            "MINUTE_1": 1,
        }[timeframe]
        current = pd.Timestamp(as_of_date) + pd.Timedelta(minutes=interval_minutes)
        dates: list[pd.Timestamp] = []
        while len(dates) < prediction_length:
            if current.weekday() >= 5:
                current = (current + pd.Timedelta(days=7 - current.weekday())).replace(
                    hour=9,
                    minute=30,
                    second=0,
                )
                continue
            if current.time() < pd.Timestamp("09:30").time():
                current = current.replace(hour=9, minute=30, second=0)
            elif current.time() > pd.Timestamp("11:30").time() and current.time() < pd.Timestamp("13:00").time():
                current = current.replace(hour=13, minute=0, second=0)
            elif current.time() > pd.Timestamp("15:00").time():
                current = (current + pd.Timedelta(days=1)).replace(
                    hour=9,
                    minute=30,
                    second=0,
                )
                continue
            dates.append(current)
            current = current + pd.Timedelta(minutes=interval_minutes)
        return [item.strftime("%Y-%m-%d %H:%M:%S") for item in dates]

    current = pd.Timestamp(as_of_date)
    dates: list[pd.Timestamp] = []
    offset = (
        pd.offsets.Week(weekday=4)
        if timeframe == "WEEKLY"
        else pd.offsets.BMonthEnd()
    )
    while len(dates) < prediction_length:
        current = current + offset
        dates.append(current)
    return [item.strftime("%Y-%m-%d") for item in dates]


def bars_to_frame(bars: list[KronosBar]) -> pd.DataFrame:
    return pd.DataFrame(
        [
            {
                "open": bar.open,
                "high": bar.high,
                "low": bar.low,
                "close": bar.close,
                "volume": bar.volume or 0,
                "amount": bar.amount or 0,
            }
            for bar in bars
        ],
    )


def summarize_forecast(
    *,
    last_close: float,
    forecast_frame: pd.DataFrame,
) -> dict[str, float | str]:
    closes = forecast_frame["close"].astype(float).tolist()
    highs = forecast_frame["high"].astype(float).tolist()
    lows = forecast_frame["low"].astype(float).tolist()
    final_close = closes[-1] if closes else last_close
    expected_return = ((final_close / max(last_close, 0.0001)) - 1) * 100
    upside = ((max(highs or [last_close]) / max(last_close, 0.0001)) - 1) * 100

    peak = last_close
    max_drawdown = 0.0
    for value in lows:
        peak = max(peak, value)
        drawdown = ((value / max(peak, 0.0001)) - 1) * 100
        max_drawdown = min(max_drawdown, drawdown)

    returns = pd.Series(closes).pct_change().dropna()
    volatility_proxy = float(returns.std()) if len(returns.index) > 0 else 0.0
    if expected_return >= 3 and max_drawdown > -10:
        direction = "bullish"
    elif expected_return <= -3 or max_drawdown <= -12:
        direction = "bearish"
    else:
        direction = "neutral"

    confidence = min(
        0.9,
        max(0.3, abs(expected_return) / 15 + max(0, 0.35 - volatility_proxy)),
    )

    return {
        "expectedReturnPct": round(expected_return, 4),
        "maxDrawdownPct": round(max_drawdown, 4),
        "upsidePct": round(upside, 4),
        "volatilityProxy": round(volatility_proxy, 6),
        "direction": direction,
        "confidence": round(confidence, 4),
    }


class KronosModelForecaster:
    def __init__(self, settings: KronosSettings | None = None) -> None:
        self.settings = settings or KronosSettings()
        self.model_name = self.settings.model_name
        self.tokenizer_name = self.settings.tokenizer_name
        self.model_version = self.settings.model_name
        self.max_context = self.settings.max_context
        self.default_prediction_length = self.settings.default_prediction_length
        self.device = resolve_device(self.settings.device)
        self._predictor: Any | None = None
        self._load_error: str | None = None

    @property
    def is_loaded(self) -> bool:
        return self._predictor is not None

    def health(self) -> dict[str, str | bool | int]:
        if self._predictor is None and self._load_error is None:
            try:
                self._load_predictor()
            except KronosForecastError as error:
                self._load_error = error.message

        return {
            "status": "healthy" if self._load_error is None else "degraded",
            "modelLoaded": self.is_loaded,
            "modelName": self.model_name,
            "tokenizerName": self.tokenizer_name,
            "modelVersion": self.model_version,
            "device": self.device,
            "maxContext": self.max_context,
            "defaultPredictionLength": self.default_prediction_length,
        }

    def forecast(
        self,
        *,
        stock_code: str,
        timeframe: KronosTimeframe = "DAILY",
        bars: list[KronosBar],
        prediction_length: int | None,
    ) -> dict[str, Any]:
        normalized = normalize_bars(bars, self.max_context, timeframe)
        effective_prediction_length = prediction_length or self._default_prediction_length(timeframe)
        predictor = self._load_predictor()
        x_df = bars_to_frame(normalized)
        x_timestamp = pd.Series(pd.to_datetime([bar.tradeDate for bar in normalized]))
        y_dates = future_period_dates(
            normalized[-1].tradeDate,
            effective_prediction_length,
            timeframe,
        )
        y_timestamp = pd.Series(pd.to_datetime(y_dates))

        pred_df = predictor.predict(
            df=x_df,
            x_timestamp=x_timestamp,
            y_timestamp=y_timestamp,
            pred_len=effective_prediction_length,
            T=1.0,
            top_p=0.9,
            sample_count=1,
        )
        pred_df = pred_df.reset_index(drop=True)
        pred_df["tradeDate"] = y_dates

        return self._format_response(
            stock_code=stock_code,
            timeframe=timeframe,
            bars=normalized,
            prediction_length=effective_prediction_length,
            pred_df=pred_df,
            warnings=[],
        )

    def forecast_batch(
        self,
        *,
        items: list[tuple[str, KronosTimeframe, list[KronosBar]]],
        prediction_length: int | None,
    ) -> list[dict[str, Any]]:
        if not items:
            return []

        normalized_items = [
            (stock_code, timeframe, normalize_bars(bars, self.max_context, timeframe))
            for stock_code, timeframe, bars in items
        ]
        lengths = {len(bars) for _stock_code, _timeframe, bars in normalized_items}
        if len(lengths) > 1:
            raise KronosForecastError(
                code="batch_lookback_mismatch",
                message="batch forecast requires a uniform lookback length",
            )

        effective_prediction_length = prediction_length or self._default_prediction_length(
            normalized_items[0][1]
        )
        predictor = self._load_predictor()
        df_list = [bars_to_frame(bars) for _stock_code, _timeframe, bars in normalized_items]
        x_timestamp_list = [
            pd.Series(pd.to_datetime([bar.tradeDate for bar in bars]))
            for _stock_code, _timeframe, bars in normalized_items
        ]
        y_date_list = [
            future_period_dates(bars[-1].tradeDate, effective_prediction_length, timeframe)
            for _stock_code, timeframe, bars in normalized_items
        ]
        y_timestamp_list = [
            pd.Series(pd.to_datetime(dates)) for dates in y_date_list
        ]

        pred_df_list = predictor.predict_batch(
            df_list=df_list,
            x_timestamp_list=x_timestamp_list,
            y_timestamp_list=y_timestamp_list,
            pred_len=effective_prediction_length,
            T=1.0,
            top_p=0.9,
            sample_count=1,
            verbose=False,
        )

        responses: list[dict[str, Any]] = []
        for index, (stock_code, timeframe, bars) in enumerate(normalized_items):
            pred_df = pred_df_list[index].reset_index(drop=True)
            pred_df["tradeDate"] = y_date_list[index]
            responses.append(
                self._format_response(
                    stock_code=stock_code,
                    timeframe=timeframe,
                    bars=bars,
                    prediction_length=effective_prediction_length,
                    pred_df=pred_df,
                    warnings=[],
                )
            )
        return responses

    def _default_prediction_length(self, timeframe: KronosTimeframe) -> int:
        return {
            "DAILY": self.default_prediction_length,
            "WEEKLY": 12,
            "MONTHLY": 6,
            "MINUTE_60": 60,
            "MINUTE_30": 60,
            "MINUTE_15": 60,
            "MINUTE_1": 60,
        }[timeframe]

    def _format_response(
        self,
        *,
        stock_code: str,
        timeframe: KronosTimeframe,
        bars: list[KronosBar],
        prediction_length: int,
        pred_df: pd.DataFrame,
        warnings: list[str],
    ) -> dict[str, Any]:
        points = []
        for row in pred_df.to_dict(orient="records"):
            points.append(
                {
                    "tradeDate": str(row["tradeDate"])[:10],
                    "open": round(float(row["open"]), 4),
                    "high": round(float(row["high"]), 4),
                    "low": round(float(row["low"]), 4),
                    "close": round(float(row["close"]), 4),
                    "volume": round(float(row.get("volume") or 0), 4),
                    "amount": round(float(row.get("amount") or 0), 4),
                }
            )

        return {
            "stockCode": stock_code,
            "timeframe": timeframe,
            "asOfDate": bars[-1].tradeDate,
            "modelName": self.model_name,
            "modelVersion": self.model_version,
            "lookbackDays": len(bars),
            "lookbackBars": len(bars),
            "predictionLength": prediction_length,
            "device": self.device,
            "points": points,
            "summary": summarize_forecast(
                last_close=bars[-1].close,
                forecast_frame=pd.DataFrame(points),
            ),
            "warnings": warnings,
        }

    def _load_predictor(self) -> Any:
        if self._predictor is not None:
            return self._predictor

        if self.settings.kronos_repo_path:
            repo_path = Path(self.settings.kronos_repo_path)
            if repo_path.exists():
                sys.path.insert(0, str(repo_path))

        try:
            model_module = importlib.import_module("model")
            Kronos = getattr(model_module, "Kronos")
            KronosTokenizer = getattr(model_module, "KronosTokenizer")
            KronosPredictor = getattr(model_module, "KronosPredictor")
        except Exception as exc:  # noqa: BLE001
            raise KronosForecastError(
                code="kronos_import_failed",
                message=f"Unable to import Kronos model package: {exc}",
            ) from exc

        tokenizer = KronosTokenizer.from_pretrained(self.tokenizer_name)
        model = Kronos.from_pretrained(self.model_name)
        if hasattr(model, "to"):
            model = model.to(self.device)
        if hasattr(model, "eval"):
            model.eval()
        self._predictor = KronosPredictor(
            model,
            tokenizer,
            max_context=self.max_context,
            device=self.device,
        )
        return self._predictor

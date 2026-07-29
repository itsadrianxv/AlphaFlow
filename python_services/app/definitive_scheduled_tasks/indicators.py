"""确定性评分使用的技术指标。"""

from __future__ import annotations

import pandas as pd

from app.definitive_scheduled_tasks.schemas import Indicator


def calculate_indicators(frame: pd.DataFrame, indicators: list[Indicator], timeframe: str) -> pd.DataFrame:
    result = frame.copy()
    result["candle.direction"] = "doji"
    result.loc[result["close"] > result["open"], "candle.direction"] = "bullish"
    result.loc[result["close"] < result["open"], "candle.direction"] = "bearish"

    for indicator in indicators:
        if timeframe not in indicator.timeframes:
            continue
        if indicator.type == "macd":
            close = result["close"]
            dif = close.ewm(span=indicator.params.fast, adjust=False).mean() - close.ewm(
                span=indicator.params.slow, adjust=False
            ).mean()
            dea = dif.ewm(span=indicator.params.signal, adjust=False).mean()
            result[f"{indicator.id}.dif"] = dif
            result[f"{indicator.id}.dea"] = dea
            result[f"{indicator.id}.histogram"] = (dif - dea) * 2
        elif indicator.type == "kdj":
            low = result["low"].rolling(indicator.params.period, min_periods=indicator.params.period).min()
            high = result["high"].rolling(indicator.params.period, min_periods=indicator.params.period).max()
            spread = (high - low).replace(0, pd.NA)
            rsv = ((result["close"] - low) / spread * 100).fillna(50.0)
            k = rsv.ewm(alpha=1 / indicator.params.kSmoothing, adjust=False).mean()
            d = k.ewm(alpha=1 / indicator.params.dSmoothing, adjust=False).mean()
            result[f"{indicator.id}.k"] = k
            result[f"{indicator.id}.d"] = d
            result[f"{indicator.id}.j"] = 3 * k - 2 * d
    return result

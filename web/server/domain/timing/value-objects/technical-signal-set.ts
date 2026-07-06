import type { TimingIndicators } from "~/server/domain/timing/types";

function assertFiniteNumber(value: number, fieldName: string) {
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName} 必须是有限数字`);
  }
}

export class TechnicalSignalSet {
  private constructor(private readonly indicators: TimingIndicators) {}

  static create(indicators: TimingIndicators) {
    assertFiniteNumber(indicators.close, "close");
    assertFiniteNumber(indicators.ema5, "ema5");
    assertFiniteNumber(indicators.ema20, "ema20");
    assertFiniteNumber(indicators.ema60, "ema60");
    assertFiniteNumber(indicators.ema120, "ema120");
    assertFiniteNumber(indicators.atr14, "atr14");
    assertFiniteNumber(indicators.volumeRatio20, "volumeRatio20");
    assertFiniteNumber(indicators.realizedVol20, "realizedVol20");
    assertFiniteNumber(indicators.realizedVol120, "realizedVol120");
    assertFiniteNumber(indicators.macd.dif, "macd.dif");
    assertFiniteNumber(indicators.macd.dea, "macd.dea");
    assertFiniteNumber(indicators.macd.histogram, "macd.histogram");
    assertFiniteNumber(indicators.rsi.value, "rsi.value");
    assertFiniteNumber(indicators.bollinger.upper, "bollinger.upper");
    assertFiniteNumber(indicators.bollinger.middle, "bollinger.middle");
    assertFiniteNumber(indicators.bollinger.lower, "bollinger.lower");
    assertFiniteNumber(
      indicators.bollinger.closePosition,
      "bollinger.closePosition",
    );
    assertFiniteNumber(indicators.obv.value, "obv.value");
    assertFiniteNumber(indicators.obv.slope, "obv.slope");

    return new TechnicalSignalSet(indicators);
  }

  toObject(): TimingIndicators {
    return this.indicators;
  }
}

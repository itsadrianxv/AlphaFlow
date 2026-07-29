import {
  KRONOS_MIN_LOOKBACK_BARS,
  KRONOS_PREDICTION_LENGTHS,
} from "~/server/application/timing/kronos-forecast-policy";
import type {
  TimingKronosForecast,
  TimingTimeframe,
} from "~/server/domain/timing/types";
import type { KronosForecastClient } from "~/server/infrastructure/timing/kronos-forecast-client";
import type { PythonTimingDataClient } from "~/server/infrastructure/timing/python-timing-data-client";

export type KronosForecastQueryResult = {
  forecast: TimingKronosForecast | null;
  warnings: string[];
};

export class KronosForecastQueryService {
  constructor(
    private readonly deps: {
      timingDataClient: Pick<PythonTimingDataClient, "getBars">;
      kronosClient: Pick<KronosForecastClient, "forecastBatch">;
    },
  ) {}

  async getForecast(params: {
    stockCode: string;
    timeframe: TimingTimeframe;
    adjust?: "qfq" | "hfq" | "";
  }): Promise<KronosForecastQueryResult> {
    const barsData = await this.deps.timingDataClient.getBars({
      stockCode: params.stockCode,
      timeframe: params.timeframe,
      adjust: params.adjust ?? "qfq",
    });

    if (barsData.bars.length < KRONOS_MIN_LOOKBACK_BARS) {
      return {
        forecast: null,
        warnings: [
          `Kronos 预测至少需要 ${KRONOS_MIN_LOOKBACK_BARS} 根 K 线，当前仅有 ${barsData.bars.length} 根。`,
        ],
      };
    }

    try {
      const result = await this.deps.kronosClient.forecastBatch({
        items: [
          {
            stockCode: params.stockCode,
            timeframe: params.timeframe,
            bars: barsData.bars,
          },
        ],
        predictionLength: KRONOS_PREDICTION_LENGTHS[params.timeframe],
      });
      const forecast =
        result.items.find(
          (item) =>
            item.stockCode === params.stockCode &&
            item.timeframe === params.timeframe,
        ) ?? null;
      const warnings = [
        ...result.errors.map((error) => error.message),
        ...(forecast?.warnings ?? []),
      ];

      if (!forecast && warnings.length === 0) {
        warnings.push("Kronos 服务未返回当前股票和周期的预测结果。");
      }

      return { forecast, warnings };
    } catch (error) {
      return {
        forecast: null,
        warnings: [`Kronos 预测暂不可用：${(error as Error).message}`],
      };
    }
  }
}

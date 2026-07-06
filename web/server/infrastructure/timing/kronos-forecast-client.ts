import { env } from "~/env";
import type {
  TimingBar,
  TimingKronosForecast,
} from "~/server/domain/timing/types";

export type KronosForecastBatchError = {
  stockCode: string;
  code: string;
  message: string;
};

export type KronosForecastBatchResult = {
  items: TimingKronosForecast[];
  errors: KronosForecastBatchError[];
};

export type KronosForecastClientConfig = {
  baseUrl?: string;
  timeoutMs?: number;
  enabled?: boolean;
  defaultPredictionLength?: number;
};

function normalizeBaseUrl(value: string) {
  return value.replace(/\/$/, "");
}

export class KronosForecastClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly enabled: boolean;
  private readonly defaultPredictionLength: number;

  constructor(config?: KronosForecastClientConfig) {
    this.baseUrl = normalizeBaseUrl(config?.baseUrl ?? env.KRONOS_SERVICE_URL);
    this.timeoutMs = config?.timeoutMs ?? env.KRONOS_SERVICE_TIMEOUT_MS;
    this.enabled = config?.enabled ?? env.KRONOS_FORECAST_ENABLED;
    this.defaultPredictionLength =
      config?.defaultPredictionLength ?? env.KRONOS_DEFAULT_PREDICTION_LENGTH;
  }

  async forecastBatch(params: {
    items: Array<{ stockCode: string; bars: TimingBar[] }>;
    predictionLength?: number;
  }): Promise<KronosForecastBatchResult> {
    if (!this.enabled) {
      return {
        items: [],
        errors: params.items.map((item) => ({
          stockCode: item.stockCode,
          code: "kronos_disabled",
          message: "Kronos forecast is disabled.",
        })),
      };
    }

    if (params.items.length === 0) {
      return { items: [], errors: [] };
    }

    return this.request<KronosForecastBatchResult>(
      "/api/v1/kronos/forecast/batch",
      {
        method: "POST",
        body: JSON.stringify({
          items: params.items,
          predictionLength:
            params.predictionLength ?? this.defaultPredictionLength,
        }),
      },
    );
  }

  async forecast(params: {
    stockCode: string;
    bars: TimingBar[];
    predictionLength?: number;
  }): Promise<TimingKronosForecast> {
    return this.request<TimingKronosForecast>("/api/v1/kronos/forecast", {
      method: "POST",
      body: JSON.stringify({
        stockCode: params.stockCode,
        bars: params.bars,
        predictionLength:
          params.predictionLength ?? this.defaultPredictionLength,
      }),
    });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...init.headers,
        },
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "Kronos service error");
        throw new Error(`Kronos service failed (${response.status}): ${text}`);
      }

      return (await response.json()) as T;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new Error(
          `Kronos service request timed out (${this.timeoutMs}ms)`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

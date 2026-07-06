import { afterEach, describe, expect, it, vi } from "vitest";

async function loadClient() {
  vi.resetModules();
  process.env.SKIP_ENV_VALIDATION = "1";
  process.env.DATABASE_URL ??= "https://example.com/db";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  process.env.KRONOS_SERVICE_URL = "http://127.0.0.1:8010";
  process.env.KRONOS_SERVICE_TIMEOUT_MS = "1234";
  process.env.KRONOS_FORECAST_ENABLED ??= "true";
  process.env.KRONOS_DEFAULT_PREDICTION_LENGTH = "60";

  const module = await import(
    "~/server/infrastructure/timing/kronos-forecast-client"
  );
  return module.KronosForecastClient;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const bars = Array.from({ length: 130 }, (_value, index) => ({
  tradeDate: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
  open: 10 + index,
  high: 11 + index,
  low: 9 + index,
  close: 10.5 + index,
  volume: 1000 + index,
  amount: 10000 + index,
}));

describe("KronosForecastClient", () => {
  it("posts batch forecast requests to the independent Kronos service", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            stockCode: "600519",
            asOfDate: "2026-03-06",
            modelName: "NeoQuasar/Kronos-base",
            modelVersion: "NeoQuasar/Kronos-base",
            lookbackDays: 130,
            predictionLength: 60,
            device: "cpu",
            points: [],
            summary: {
              expectedReturnPct: 6.2,
              maxDrawdownPct: -2.8,
              upsidePct: 7,
              volatilityProxy: 0.2,
              direction: "bullish",
              confidence: 0.7,
            },
            warnings: [],
          },
        ],
        errors: [],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const KronosForecastClient = await loadClient();
    const client = new KronosForecastClient();

    const result = await client.forecastBatch({
      items: [{ stockCode: "600519", bars }],
      predictionLength: 60,
    });

    expect(result.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8010/api/v1/kronos/forecast/batch",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          items: [{ stockCode: "600519", bars }],
          predictionLength: 60,
        }),
      }),
    );
  });

  it("returns disabled warnings without calling the service", async () => {
    process.env.KRONOS_FORECAST_ENABLED = "false";
    vi.stubGlobal("fetch", vi.fn());

    const KronosForecastClient = await loadClient();
    const client = new KronosForecastClient();

    const result = await client.forecastBatch({
      items: [{ stockCode: "600519", bars }],
    });

    expect(result.items).toEqual([]);
    expect(result.errors[0]?.code).toBe("kronos_disabled");
    expect(fetch).not.toHaveBeenCalled();
  });
});

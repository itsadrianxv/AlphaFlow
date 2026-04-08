import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_ERROR_CODES } from "~/server/domain/workflow/errors";

const originalPythonServiceTimeoutMs = process.env.PYTHON_SERVICE_TIMEOUT_MS;

async function loadClient(options?: {
  pythonServiceTimeoutMs?: string;
  reloadModules?: boolean;
}) {
  if (options?.reloadModules) {
    vi.resetModules();
  }
  process.env.SKIP_ENV_VALIDATION = "1";
  process.env.DATABASE_URL ??= "https://example.com/db";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  process.env.PYTHON_SERVICE_URL ??= "http://127.0.0.1:8000";
  if (options?.pythonServiceTimeoutMs === undefined) {
    delete process.env.PYTHON_SERVICE_TIMEOUT_MS;
  } else {
    process.env.PYTHON_SERVICE_TIMEOUT_MS = options.pythonServiceTimeoutMs;
  }

  const module = await import(
    "~/server/infrastructure/timing/python-timing-data-client"
  );

  return module.PythonTimingDataClient;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();

  if (originalPythonServiceTimeoutMs === undefined) {
    delete process.env.PYTHON_SERVICE_TIMEOUT_MS;
  } else {
    process.env.PYTHON_SERVICE_TIMEOUT_MS = originalPythonServiceTimeoutMs;
  }
});

function sampleSignalPayload() {
  return {
    stockCode: "600519",
    stockName: "贵州茅台",
    asOfDate: "2026-03-06",
    barsCount: 240,
    indicators: {
      close: 1500,
      macd: { dif: 1, dea: 0.8, histogram: 0.4 },
      rsi: { value: 61 },
      bollinger: {
        upper: 1520,
        middle: 1490,
        lower: 1460,
        closePosition: 0.68,
      },
      obv: { value: 1000, slope: 15 },
      ema5: 1492,
      ema20: 1480,
      ema60: 1420,
      ema120: 1360,
      atr14: 32,
      volumeRatio20: 1.24,
      realizedVol20: 0.28,
      realizedVol120: 0.24,
      amount: 1000000000,
      turnoverRate: 2.2,
    },
    signalContext: {
      engines: [],
      composite: {
        score: 76,
        confidence: 0.82,
        direction: "bullish",
        signalStrength: 76,
        participatingEngines: 6,
      },
    },
  };
}

describe("PythonTimingDataClient", () => {
  it("uses PYTHON_SERVICE_TIMEOUT_MS for request timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input, init) => {
        const signal = init?.signal as AbortSignal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const abortError = new Error("aborted");
            abortError.name = "AbortError";
            reject(abortError);
          });
        });
      }),
    );

    const PythonTimingDataClient = await loadClient({
      pythonServiceTimeoutMs: "1234",
      reloadModules: true,
    });
    const client = new PythonTimingDataClient({
      baseUrl: "http://127.0.0.1:8000",
    });

    let settled = false;
    let rejection: unknown;
    const request = client.getSignal({ stockCode: "600519" }).then(
      () => {
        settled = true;
      },
      (error) => {
        settled = true;
        rejection = error;
      },
    );

    try {
      await vi.advanceTimersByTimeAsync(1234);

      expect(settled).toBe(true);
      expect(rejection).toMatchObject({
        name: "WorkflowDomainError",
        message: expect.stringContaining("1234ms"),
        code: WORKFLOW_ERROR_CODES.TIMING_DATA_UNAVAILABLE,
      });
    } finally {
      await vi.runAllTimersAsync();
      await request;
      vi.useRealTimers();
    }
  });

  it("unwraps gateway response payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: sampleSignalPayload(),
        }),
      }),
    );

    const PythonTimingDataClient = await loadClient();
    const client = new PythonTimingDataClient({
      baseUrl: "http://127.0.0.1:8000",
      timeoutMs: 500,
    });

    const payload = await client.getSignal({ stockCode: "600519" });

    expect(payload.stockCode).toBe("600519");
    expect(payload.signalContext.composite.direction).toBe("bullish");
  });

  it("supports base URLs that already include /api", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: sampleSignalPayload(),
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const PythonTimingDataClient = await loadClient();
    const client = new PythonTimingDataClient({
      baseUrl: "http://127.0.0.1:8000/api",
      timeoutMs: 500,
    });

    await client.getSignal({ stockCode: "600519" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/v1/timing/stocks/600519/signals",
      expect.anything(),
    );
  });

  it("throws workflow domain error when gateway fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () =>
          JSON.stringify({
            error: {
              code: "bars_unavailable",
              message: "upstream down",
            },
          }),
      }),
    );

    const PythonTimingDataClient = await loadClient();
    const client = new PythonTimingDataClient({
      baseUrl: "http://127.0.0.1:8000",
      timeoutMs: 500,
    });

    await expect(
      client.getSignal({ stockCode: "600519" }),
    ).rejects.toMatchObject({
      name: "WorkflowDomainError",
      code: WORKFLOW_ERROR_CODES.TIMING_DATA_UNAVAILABLE,
    });
  });

  it("unwraps market context payloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            asOfDate: "2026-03-06",
            indexes: [
              {
                code: "510300",
                name: "CSI 300 ETF",
                close: 4.1,
                changePct: 0.8,
                return5d: 2.6,
                return10d: 4.1,
                ema20: 4,
                ema60: 3.8,
                aboveEma20: true,
                aboveEma60: true,
                atrRatio: 0.021,
                signalDirection: "bullish",
              },
            ],
            latestBreadth: {
              asOfDate: "2026-03-06",
              totalCount: 10,
              advancingCount: 6,
              decliningCount: 3,
              flatCount: 1,
              positiveRatio: 0.6,
              aboveThreePctRatio: 0.2,
              belowThreePctRatio: 0.1,
              medianChangePct: 0.8,
              averageTurnoverRate: 1.2,
            },
            latestVolatility: {
              asOfDate: "2026-03-06",
              highVolatilityCount: 1,
              highVolatilityRatio: 0.1,
              limitDownLikeCount: 0,
              indexAtrRatio: 0.02,
            },
            latestLeadership: {
              asOfDate: "2026-03-06",
              leaderCode: "510300",
              leaderName: "CSI 300 ETF",
              ranking5d: ["510300"],
              ranking10d: ["510300"],
              switched: false,
              previousLeaderCode: "510300",
            },
            breadthSeries: [],
            volatilitySeries: [],
            leadershipSeries: [],
            features: {
              benchmarkStrength: 72,
              breadthScore: 64,
              riskScore: 28,
              stateScore: 68,
            },
          },
        }),
      }),
    );

    const PythonTimingDataClient = await loadClient();
    const client = new PythonTimingDataClient({
      baseUrl: "http://127.0.0.1:8000",
      timeoutMs: 500,
    });

    const payload = await client.getMarketContext();

    expect(payload.asOfDate).toBe("2026-03-06");
    expect(payload.indexes).toHaveLength(1);
    expect(payload.features.benchmarkStrength).toBe(72);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkflowDomainError } from "~/server/domain/workflow/errors";

const originalPythonServiceTimeoutMs = process.env.PYTHON_SERVICE_TIMEOUT_MS;

async function loadClient(options?: { pythonServiceTimeoutMs?: string }) {
  process.env.SKIP_ENV_VALIDATION = "1";
  process.env.DATABASE_URL ??= "https://example.com/db";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  process.env.PYTHON_SERVICE_URL ??= "http://127.0.0.1:8000";
  if (options?.pythonServiceTimeoutMs === undefined) {
    delete process.env.PYTHON_SERVICE_TIMEOUT_MS;
  } else {
    process.env.PYTHON_SERVICE_TIMEOUT_MS = options.pythonServiceTimeoutMs;
  }
  process.env.PYTHON_INTELLIGENCE_SERVICE_URL ??= "http://127.0.0.1:8000";
  process.env.PYTHON_INTELLIGENCE_SERVICE_TIMEOUT_MS ??= "300000";

  const module = await import(
    "~/server/infrastructure/capabilities/python-capability-gateway-client"
  );

  return module.PythonCapabilityGatewayClient;
}

async function loadFreshClient(options?: { pythonServiceTimeoutMs?: string }) {
  vi.resetModules();
  return loadClient(options);
}

describe("PythonCapabilityGatewayClient", () => {
  afterEach(() => {
    if (originalPythonServiceTimeoutMs === undefined) {
      delete process.env.PYTHON_SERVICE_TIMEOUT_MS;
    } else {
      process.env.PYTHON_SERVICE_TIMEOUT_MS = originalPythonServiceTimeoutMs;
    }
  });

  it("uses the capability screening endpoint for dataset queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        meta: {
          traceId: "req-screening",
          provider: "tushare",
          capability: "screening",
          operation: "query_dataset",
        },
        data: {
          periods: ["2024"],
          indicatorMeta: [],
          rows: [],
          latestSnapshotRows: [],
          warnings: [],
          dataStatus: "READY",
          provider: "tushare",
        },
      }),
    });

    vi.stubGlobal("fetch", fetchMock);

    const PythonCapabilityGatewayClient = await loadClient({
      pythonServiceTimeoutMs: "60000",
    });
    const client = new PythonCapabilityGatewayClient({
      baseUrl: "http://127.0.0.1:8000/api",
      screeningTimeoutMs: 500,
      intelligenceTimeoutMs: 500,
    });

    const payload = await client.queryScreeningDataset({
      stockCodes: ["600519"],
      indicators: [],
      formulas: [],
      timeConfig: {
        periodType: "ANNUAL",
        rangeMode: "PRESET",
        presetKey: "1Y",
      },
    });

    expect(payload.provider).toBe("tushare");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/api/v1/capabilities/screening/query-dataset",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("raises workflow error with traceId from capability envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        text: async () =>
          JSON.stringify({
            error: {
              traceId: "req-web-1",
              provider: "tavily",
              capability: "web",
              operation: "search",
              code: "tavily_search_failed",
              message: "Tavily upstream failed",
              retryable: true,
              failurePhase: "request",
              diagnostics: {
                endpoint: "https://api.tavily.com/search",
              },
            },
          }),
      }),
    );

    const PythonCapabilityGatewayClient = await loadClient({
      pythonServiceTimeoutMs: "60000",
    });
    const client = new PythonCapabilityGatewayClient({
      baseUrl: "http://127.0.0.1:8000",
      screeningTimeoutMs: 500,
      intelligenceTimeoutMs: 500,
    });

    await expect(
      client.searchWeb({
        queries: ["算力"],
        limit: 5,
      }),
    ).rejects.toBeInstanceOf(WorkflowDomainError);

    await expect(
      client.searchWeb({
        queries: ["算力"],
        limit: 5,
      }),
    ).rejects.toThrow("traceId=req-web-1");
  });

  it("falls back to the default screening timeout when the env var is missing", async () => {
    const PythonCapabilityGatewayClient = await loadFreshClient();
    const client = new PythonCapabilityGatewayClient();

    expect(Reflect.get(client, "screeningTimeoutMs")).toBe(60_000);
  });

  it("accepts invalid formula validation responses with null normalizedExpression", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          valid: false,
          normalizedExpression: null,
          referencedMetrics: [],
          errors: ["unsupported syntax: List"],
        }),
      }),
    );

    const PythonCapabilityGatewayClient = await loadClient({
      pythonServiceTimeoutMs: "60000",
    });
    const client = new PythonCapabilityGatewayClient({
      baseUrl: "http://127.0.0.1:8000",
      screeningTimeoutMs: 500,
      intelligenceTimeoutMs: 500,
    });

    await expect(
      client.validateFormula({
        expression: "[ROE(TTM)] + [EPS(TTM)]",
        targetIndicators: ["roe_ttm", "eps_ttm"],
      }),
    ).resolves.toMatchObject({
      valid: false,
      normalizedExpression: null,
      errors: ["unsupported syntax: List"],
    });
  });
});

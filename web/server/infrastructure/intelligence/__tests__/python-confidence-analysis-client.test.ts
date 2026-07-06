import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_ERROR_CODES } from "~/server/domain/workflow/errors";

const originalTimeoutMs = process.env.PYTHON_INTELLIGENCE_SERVICE_TIMEOUT_MS;

async function loadClient() {
  vi.resetModules();
  process.env.SKIP_ENV_VALIDATION = "1";
  process.env.DATABASE_URL ??= "https://example.com/db";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  process.env.PYTHON_INTELLIGENCE_SERVICE_URL ??= "http://127.0.0.1:8000";

  const module = await import(
    "~/server/infrastructure/intelligence/python-confidence-analysis-client"
  );

  return module.PythonConfidenceAnalysisClient;
}

afterEach(() => {
  if (originalTimeoutMs === undefined) {
    delete process.env.PYTHON_INTELLIGENCE_SERVICE_TIMEOUT_MS;
  } else {
    process.env.PYTHON_INTELLIGENCE_SERVICE_TIMEOUT_MS = originalTimeoutMs;
  }
  vi.unstubAllGlobals();
});

describe("PythonConfidenceAnalysisClient", () => {
  it("uses PYTHON_INTELLIGENCE_SERVICE_TIMEOUT_MS for request timeout", async () => {
    process.env.PYTHON_INTELLIGENCE_SERVICE_TIMEOUT_MS = "5";

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const abortError = new Error("Aborted");
              abortError.name = "AbortError";
              reject(abortError);
            });
          }),
      ),
    );

    const PythonConfidenceAnalysisClient = await loadClient();
    const client = new PythonConfidenceAnalysisClient();

    await expect(
      client.check({
        module: "screening_insight",
        responseText: "summary",
        referenceItems: [],
      }),
    ).rejects.toMatchObject({
      code: WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
      name: "WorkflowDomainError",
    });
    await expect(
      client.check({
        module: "screening_insight",
        responseText: "summary",
        referenceItems: [],
      }),
    ).rejects.toThrow("timed out (5ms)");
  });
});

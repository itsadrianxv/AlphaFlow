import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKFLOW_ERROR_CODES } from "~/server/domain/workflow/errors";

const ORIGINAL_ENV = { ...process.env };

function restoreProcessEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

async function loadDeepSeekClient() {
  vi.resetModules();
  process.env.SKIP_ENV_VALIDATION = "1";
  process.env.DATABASE_URL ??= "https://example.com/db";
  process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
  process.env.PYTHON_SERVICE_URL ??= "http://127.0.0.1:8000";
  process.env.PYTHON_INTELLIGENCE_SERVICE_URL ??= "http://127.0.0.1:8000";
  process.env.DEEPSEEK_API_KEY ??= "test-key";

  const module = await import(
    "~/server/infrastructure/intelligence/deepseek-client"
  );

  return module.DeepSeekClient;
}

afterEach(() => {
  restoreProcessEnv();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DeepSeekClient", () => {
  it("extends timeout budget for deepseek-reasoner beyond the default client timeout", async () => {
    process.env.DEEPSEEK_TIMEOUT_MS = "15000";
    vi.useFakeTimers();

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

    const DeepSeekClient = await loadDeepSeekClient();
    const client = new DeepSeekClient();

    let settled = false;
    const request = client.complete(
      [{ role: "user", content: "Write a research brief." }],
      "fallback",
      { model: "deepseek-reasoner" },
    );
    void request.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.resolve();

    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(30_000);

    await expect(request).rejects.toMatchObject({
      code: WORKFLOW_ERROR_CODES.INTELLIGENCE_DATA_UNAVAILABLE,
      name: "WorkflowDomainError",
    });
    await expect(request).rejects.toThrow("45000ms");
  });
});

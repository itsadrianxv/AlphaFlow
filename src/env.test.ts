import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("env defaults", () => {
  afterEach(() => {
    restoreProcessEnv();
    vi.resetModules();
  });

  it("preserves DeepSeek defaults when env validation is skipped", async () => {
    process.env.SKIP_ENV_VALIDATION = "1";
    delete process.env.DEEPSEEK_BASE_URL;
    delete process.env.DEEPSEEK_TIMEOUT_MS;

    vi.resetModules();
    const { env } = await import("~/env");

    expect(env.DEEPSEEK_BASE_URL).toBe("https://api.deepseek.com");
    expect(env.DEEPSEEK_TIMEOUT_MS).toBe(15_000);
  });
});

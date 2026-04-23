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
    const { env } = await import("~/platform/env");

    expect(env.DEEPSEEK_BASE_URL).toBe("https://api.deepseek.com");
    expect(env.DEEPSEEK_TIMEOUT_MS).toBe(45_000);
  });

  it("preserves voice defaults when env validation is skipped", async () => {
    process.env.SKIP_ENV_VALIDATION = "1";
    delete process.env.VOICE_MAX_DURATION_SECONDS;
    delete process.env.VOICE_MAX_UPLOAD_BYTES;
    delete process.env.VOICE_TRANSCRIBE_TIMEOUT_MS;
    delete process.env.VOICE_PRIMARY_ONLY_CONFIDENCE;
    delete process.env.VOICE_FIELD_AUTOFILL_CONFIDENCE;
    delete process.env.VOICE_COMPANY_AUTOFILL_CONFIDENCE;
    delete process.env.VOICE_HOTWORD_LIMIT;

    vi.resetModules();
    const { env } = await import("~/platform/env");

    expect(env.VOICE_MAX_DURATION_SECONDS).toBe(90);
    expect(env.VOICE_MAX_UPLOAD_BYTES).toBe(10_485_760);
    expect(env.VOICE_TRANSCRIBE_TIMEOUT_MS).toBe(60_000);
    expect(env.VOICE_PRIMARY_ONLY_CONFIDENCE).toBe(0.75);
    expect(env.VOICE_FIELD_AUTOFILL_CONFIDENCE).toBe(0.85);
    expect(env.VOICE_COMPANY_AUTOFILL_CONFIDENCE).toBe(0.9);
    expect(env.VOICE_HOTWORD_LIMIT).toBe(128);
  });
});

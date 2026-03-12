import { describe, expect, it } from "vitest";

import {
  AUTH_SECRET_EXAMPLE_VALUE,
  collectAuthSecrets,
  isSecretRotationErrorMessage,
  validatePrimaryAuthSecret,
} from "./secret-utils";

describe("collectAuthSecrets", () => {
  it("deduplicates and preserves rotation order", () => {
    expect(
      collectAuthSecrets({
        authSecret: "current-secret",
        authSecret1: "previous-secret",
        authSecret2: "current-secret",
        authSecret3: "older-secret",
        nextAuthSecret: "previous-secret",
      }),
    ).toEqual(["current-secret", "previous-secret", "older-secret"]);
  });
});

describe("validatePrimaryAuthSecret", () => {
  it("allows missing secrets outside production", () => {
    expect(
      validatePrimaryAuthSecret({
        nodeEnv: "development",
      }),
    ).toBeNull();
  });

  it("rejects the Docker example placeholder in production", () => {
    expect(
      validatePrimaryAuthSecret({
        nodeEnv: "production",
        authSecret: AUTH_SECRET_EXAMPLE_VALUE,
      }),
    ).toContain("example placeholder");
  });

  it("accepts NEXTAUTH_SECRET as a legacy fallback", () => {
    expect(
      validatePrimaryAuthSecret({
        nodeEnv: "production",
        nextAuthSecret: "12345678901234567890123456789012",
      }),
    ).toBeNull();
  });
});

describe("isSecretRotationErrorMessage", () => {
  it("recognizes Auth.js decryption mismatch errors", () => {
    expect(isSecretRotationErrorMessage("no matching decryption secret")).toBe(
      true,
    );
    expect(isSecretRotationErrorMessage("another error")).toBe(false);
  });
});

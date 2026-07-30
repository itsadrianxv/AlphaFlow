import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  hashPassword: vi.fn(),
  consumeRegistrationAttempt: vi.fn(),
  signIn: vi.fn(),
  AuthRateLimitError: class AuthRateLimitError extends Error {},
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ "x-forwarded-for": "203.0.113.4" })),
}));
vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {},
}));
vi.mock("~/server/db", () => ({ db: { user: { create: mocks.create } } }));
vi.mock("~/server/auth/password", () => ({ hashPassword: mocks.hashPassword }));
vi.mock("~/server/auth/rate-limit", () => ({
  AuthRateLimitError: mocks.AuthRateLimitError,
  consumeRegistrationAttempt: mocks.consumeRegistrationAttempt,
}));
vi.mock("~/server/auth", () => ({ signIn: mocks.signIn }));

import { registerWithCredentials } from "~/app/register/actions";
import { AuthRateLimitError } from "~/server/auth/rate-limit";

function registrationForm(overrides?: Record<string, string>) {
  const form = new FormData();
  form.set("identifier", overrides?.identifier ?? "User@Example.com");
  form.set("password", overrides?.password ?? "Strong#1");
  form.set("confirmPassword", overrides?.confirmPassword ?? "Strong#1");
  form.set("redirectTo", "/screening");
  return form;
}

describe("注册 Server Action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeRegistrationAttempt.mockResolvedValue(undefined);
    mocks.hashPassword.mockResolvedValue("argon2-hash");
    mocks.create.mockResolvedValue({ id: "user-1" });
    mocks.signIn.mockResolvedValue(undefined);
  });

  it("规范化账号、只保存哈希并自动登录", async () => {
    await expect(
      registerWithCredentials({ error: null }, registrationForm()),
    ).resolves.toEqual({ error: null });

    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        loginIdentifier: "user@example.com",
        loginIdentifierType: "EMAIL",
        passwordHash: "argon2-hash",
      }),
    });
    expect(mocks.create.mock.calls[0]?.[0].data).not.toHaveProperty("password");
    expect(mocks.signIn).toHaveBeenCalledWith(
      "local-credentials",
      expect.objectContaining({ identifier: "user@example.com" }),
    );
  });

  it("唯一键冲突统一显示账号已存在", async () => {
    mocks.create.mockRejectedValue({ code: "P2002" });
    await expect(
      registerWithCredentials({ error: null }, registrationForm()),
    ).resolves.toEqual({ error: "该账号已存在。" });
  });

  it("弱密码和两次密码不一致不会访问基础设施", async () => {
    await expect(
      registerWithCredentials(
        { error: null },
        registrationForm({ password: "weak", confirmPassword: "weak" }),
      ),
    ).resolves.toEqual({ error: "密码不符合安全要求。" });
    expect(mocks.consumeRegistrationAttempt).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("注册限流返回稍后重试", async () => {
    mocks.consumeRegistrationAttempt.mockRejectedValue(new AuthRateLimitError());
    await expect(
      registerWithCredentials({ error: null }, registrationForm()),
    ).resolves.toEqual({ error: "请求过于频繁，请稍后重试。" });
  });
});

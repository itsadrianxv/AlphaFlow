import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
  verifyPassword: vi.fn(),
  verifyDummyPassword: vi.fn(),
  assertLoginAllowed: vi.fn(),
  recordLoginFailure: vi.fn(),
  clearLoginFailures: vi.fn(),
}));

vi.mock("~/env", () => ({
  env: {
    AUTH_CREDENTIALS_USERNAME: undefined,
    AUTH_CREDENTIALS_PASSWORD: undefined,
  },
}));
vi.mock("~/server/db", () => ({
  db: { user: { findUnique: mocks.findUnique, upsert: mocks.upsert } },
}));
vi.mock("~/server/auth/password", () => ({
  verifyPassword: mocks.verifyPassword,
  verifyDummyPassword: mocks.verifyDummyPassword,
}));
vi.mock("~/server/auth/rate-limit", () => ({
  assertLoginAllowed: mocks.assertLoginAllowed,
  recordLoginFailure: mocks.recordLoginFailure,
  clearLoginFailures: mocks.clearLoginFailures,
}));

import { authenticateCredentials } from "~/server/auth/credential-service";

const requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.9" });

describe("账号密码认证", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertLoginAllowed.mockResolvedValue(undefined);
    mocks.recordLoginFailure.mockResolvedValue(undefined);
    mocks.clearLoginFailures.mockResolvedValue(undefined);
    mocks.verifyDummyPassword.mockResolvedValue(false);
  });

  it("保留固定开发管理员登录", async () => {
    mocks.upsert.mockResolvedValue({
      id: "admin-user",
      name: "admin",
      email: "local-user@alphaflow.local",
      sessionVersion: 0,
    });

    await expect(
      authenticateCredentials(
        { identifier: "admin", password: "admin123456" },
        requestHeaders,
      ),
    ).resolves.toMatchObject({ id: "admin-user", sessionVersion: 0 });
    expect(mocks.clearLoginFailures).toHaveBeenCalledWith("admin");
  });

  it("规范化邮箱并验证数据库密码", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "user-1",
      name: "user@example.com",
      email: null,
      passwordHash: "stored-hash",
      sessionVersion: 2,
      status: "ACTIVE",
    });
    mocks.verifyPassword.mockResolvedValue(true);

    const user = await authenticateCredentials(
      { identifier: " User@Example.COM ", password: "Strong#1" },
      requestHeaders,
    );

    expect(mocks.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { loginIdentifier: "user@example.com" },
      }),
    );
    expect(user).toMatchObject({ id: "user-1", sessionVersion: 2 });
  });

  it("不存在账号时执行虚拟哈希并记录失败", async () => {
    mocks.findUnique.mockResolvedValue(null);

    await expect(
      authenticateCredentials(
        { identifier: "missing@example.com", password: "Strong#1" },
        requestHeaders,
      ),
    ).resolves.toBeNull();
    expect(mocks.verifyDummyPassword).toHaveBeenCalledWith("Strong#1");
    expect(mocks.recordLoginFailure).toHaveBeenCalledWith(
      "missing@example.com",
      "203.0.113.9",
    );
  });

  it("禁用账号即使密码正确也返回相同失败结果", async () => {
    mocks.findUnique.mockResolvedValue({
      id: "user-1",
      passwordHash: "stored-hash",
      sessionVersion: 0,
      status: "DISABLED",
    });
    mocks.verifyPassword.mockResolvedValue(true);

    await expect(
      authenticateCredentials(
        { identifier: "user@example.com", password: "Strong#1" },
        requestHeaders,
      ),
    ).resolves.toBeNull();
    expect(mocks.recordLoginFailure).toHaveBeenCalledOnce();
  });
});

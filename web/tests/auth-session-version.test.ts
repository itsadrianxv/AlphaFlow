import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn() }));

vi.mock("next-auth", () => ({
  AuthError: class AuthError extends Error {
    type = "AuthError";
  },
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: vi.fn((options) => ({ id: "local-credentials", ...options })),
}));
vi.mock("next-auth/providers/wechat", () => ({ default: vi.fn() }));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn(() => ({})) }));
vi.mock("~/server/auth/credential-service", () => ({
  authenticateCredentials: vi.fn(),
}));
vi.mock("~/server/db", () => ({
  db: { user: { findUnique: mocks.findUnique } },
}));
vi.mock("~/env", () => ({
  env: {
    AUTH_SECRET: "test-secret",
    AUTH_SECRET_1: undefined,
    AUTH_SECRET_2: undefined,
    AUTH_SECRET_3: undefined,
    NEXTAUTH_SECRET: undefined,
    AUTH_WECHAT_ID: undefined,
    AUTH_WECHAT_SECRET: undefined,
    AUTH_QQ_ID: undefined,
    AUTH_QQ_SECRET: undefined,
  },
}));

import { authConfig } from "~/server/auth/config";

describe("JWT 会话版本", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("登录时将数据库会话版本写入 JWT", async () => {
    mocks.findUnique.mockResolvedValue({ sessionVersion: 3, status: "ACTIVE" });
    const token = await authConfig.callbacks.jwt({
      token: {},
      user: { id: "user-1" },
      account: null,
    } as never);

    expect(token).toMatchObject({
      sub: "user-1",
      sessionVersion: 3,
      authInvalid: false,
    });
  });

  it("密码修改导致版本变化后将旧会话标记为无效", async () => {
    mocks.findUnique.mockResolvedValue({ sessionVersion: 4, status: "ACTIVE" });
    const token = await authConfig.callbacks.jwt({
      token: { sub: "user-1", sessionVersion: 3 },
      user: undefined,
      account: null,
    } as never);
    const session = await authConfig.callbacks.session({
      session: { user: {}, expires: new Date(Date.now() + 60_000).toISOString() },
      token,
    } as never);

    expect(token.authInvalid).toBe(true);
    expect(session.user?.id).toBe("");
  });

  it("禁用账号的 JWT 不再生成有效用户 ID", async () => {
    mocks.findUnique.mockResolvedValue({ sessionVersion: 0, status: "DISABLED" });
    const token = await authConfig.callbacks.jwt({
      token: { sub: "user-1", sessionVersion: 0 },
      user: undefined,
      account: null,
    } as never);

    expect(token.authInvalid).toBe(true);
  });
});

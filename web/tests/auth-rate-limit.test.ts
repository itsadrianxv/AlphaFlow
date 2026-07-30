import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const counters = new Map<string, number>();
  const redis = {
    status: "ready",
    connect: vi.fn(async () => undefined),
    get: vi.fn(async (key: string) =>
      counters.has(key) ? String(counters.get(key)) : null,
    ),
    del: vi.fn(async (key: string) => (counters.delete(key) ? 1 : 0)),
    eval: vi.fn(async (_script: string, _keys: number, key: string) => {
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return count;
    }),
  };
  return { counters, redis };
});

vi.mock("ioredis", () => ({
  default: class RedisMock {
    constructor() {
      return mocks.redis;
    }
  },
}));
vi.mock("~/env", () => ({ env: { REDIS_URL: "redis://test" } }));

import {
  assertLoginAllowed,
  AuthRateLimitError,
  clearLoginFailures,
  consumeRegistrationAttempt,
  recordLoginFailure,
} from "~/server/auth/rate-limit";

describe("认证 Redis 限流", () => {
  beforeEach(() => {
    mocks.counters.clear();
    vi.clearAllMocks();
    mocks.redis.status = "ready";
  });

  it("账号或 IP 累计十次失败后拒绝继续登录", async () => {
    for (let index = 0; index < 10; index += 1) {
      await recordLoginFailure("user@example.com", "203.0.113.8");
    }

    await expect(
      assertLoginAllowed("user@example.com", "203.0.113.8"),
    ).rejects.toBeInstanceOf(AuthRateLimitError);
  });

  it("成功登录后清除账号维度失败计数", async () => {
    await recordLoginFailure("user@example.com", "203.0.113.8");
    await clearLoginFailures("user@example.com");
    await expect(
      assertLoginAllowed("user@example.com", "198.51.100.3"),
    ).resolves.toBeUndefined();
  });

  it("同一 IP 每小时只允许五次注册尝试", async () => {
    for (let index = 0; index < 5; index += 1) {
      await consumeRegistrationAttempt("203.0.113.8");
    }
    await expect(
      consumeRegistrationAttempt("203.0.113.8"),
    ).rejects.toBeInstanceOf(AuthRateLimitError);
  });

  it("Redis 读取失败时拒绝认证", async () => {
    mocks.redis.get.mockRejectedValueOnce(new Error("redis unavailable"));
    await expect(
      assertLoginAllowed("user@example.com", "203.0.113.8"),
    ).rejects.toThrow("redis unavailable");
  });
});

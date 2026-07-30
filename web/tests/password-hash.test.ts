import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  hashPassword,
  verifyDummyPassword,
  verifyPassword,
} from "~/server/auth/password";

describe("Argon2id 密码哈希", () => {
  it("同一密码生成不同盐值且均可验证", async () => {
    const first = await hashPassword("Strong#1");
    const second = await hashPassword("Strong#1");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    await expect(verifyPassword(first, "Strong#1")).resolves.toBe(true);
    await expect(verifyPassword(first, "Wrong#1A")).resolves.toBe(false);
    expect(first).not.toContain("Strong#1");
  });

  it("不存在账号的固定虚拟哈希会执行完整验证", async () => {
    await expect(verifyDummyPassword("any-password")).resolves.toBe(false);
  });
});

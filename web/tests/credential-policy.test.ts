import { describe, expect, it } from "vitest";

import {
  getPasswordRequirements,
  isPasswordValid,
  normalizeLoginIdentifier,
} from "~/server/auth/credential-policy";

describe("登录账号规范化", () => {
  it("接受中国大陆手机号并保持原值", () => {
    expect(normalizeLoginIdentifier(" 13800138000 ")).toEqual({
      value: "13800138000",
      type: "PHONE",
    });
  });

  it("规范化邮箱首尾空格和大小写", () => {
    expect(normalizeLoginIdentifier(" User.Name@Example.COM ")).toEqual({
      value: "user.name@example.com",
      type: "EMAIL",
    });
  });

  it.each([
    "12800138000",
    "1380013800",
    "+8613800138000",
    "not-an-email",
    `a@${"b".repeat(250)}.com`,
  ])("拒绝非法账号：%s", (identifier) => {
    expect(normalizeLoginIdentifier(identifier)).toBeNull();
  });
});

describe("密码复杂度", () => {
  it("要求长度、大小写字母、数字和特殊字符全部满足", () => {
    expect(isPasswordValid("Strong#1")).toBe(true);
    expect(getPasswordRequirements("Strong#1")).toEqual({
      length: true,
      uppercase: true,
      lowercase: true,
      number: true,
      special: true,
    });
  });

  it.each([
    "Short#1",
    "lowercase#1",
    "UPPERCASE#1",
    "NoNumber#",
    "NoSpecial1",
    `${"A".repeat(126)}a1#`,
  ])("拒绝不符合要求的密码", (password) => {
    expect(isPasswordValid(password)).toBe(false);
  });

  it("密码不做 trim，空格可作为特殊字符", () => {
    expect(isPasswordValid("Strong 1")).toBe(true);
  });
});

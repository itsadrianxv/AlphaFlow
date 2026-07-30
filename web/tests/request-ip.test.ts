import { describe, expect, it } from "vitest";

import { resolveClientIp } from "~/server/auth/request-ip";

describe("客户端 IP 解析", () => {
  it("使用转发链中的第一个地址", () => {
    expect(
      resolveClientIp(
        new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.2" }),
      ),
    ).toBe("203.0.113.5");
  });

  it("缺少代理头时使用稳定占位值", () => {
    expect(resolveClientIp(new Headers())).toBe("unknown");
  });
});

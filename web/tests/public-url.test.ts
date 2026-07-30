import { describe, expect, it } from "vitest";

import { resolvePublicBaseUrl } from "~/shared/public-url";

describe("resolvePublicBaseUrl", () => {
  it("优先使用配置的公开访问地址并移除末尾斜杠", () => {
    expect(
      resolvePublicBaseUrl({
        authUrl: "http://47.119.126.86:3000/",
        vercelUrl: "alphaflow.vercel.app",
      }),
    ).toBe("http://47.119.126.86:3000");
  });

  it("没有 AUTH_URL 时支持 Vercel 地址", () => {
    expect(resolvePublicBaseUrl({ vercelUrl: "alphaflow.vercel.app" })).toBe(
      "https://alphaflow.vercel.app",
    );
  });

  it("没有服务端公开地址时拒绝生成链接", () => {
    expect(() => resolvePublicBaseUrl({})).toThrow("请设置 AUTH_URL");
  });
});

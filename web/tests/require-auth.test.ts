import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
}));

vi.mock("~/server/auth", () => ({ auth: mocks.auth }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { buildLoginHref, requireAuth } from "~/server/auth/require-auth";

describe("requireAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("将未登录用户立即重定向到登录页并保留原始路径", async () => {
    mocks.auth.mockResolvedValue(null);

    await expect(requireAuth("/screening?workspaceId=workspace-1")).rejects.toThrow(
      "NEXT_REDIRECT:/login?redirectTo=%2Fscreening%3FworkspaceId%3Dworkspace-1",
    );
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/login?redirectTo=%2Fscreening%3FworkspaceId%3Dworkspace-1",
    );
  });

  it("不允许把登录成功后的回跳地址指向外部站点", () => {
    expect(buildLoginHref("https://example.com/private")).toBe(
      "/login?redirectTo=%2Fprivate",
    );
  });

  it("登录用户继续访问原页面", async () => {
    const session = { user: { id: "user-1" } };
    mocks.auth.mockResolvedValue(session);

    await expect(requireAuth("/")).resolves.toEqual(session);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
